const crypto = require("crypto");
const path = require("path");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const db = new sqlite3.Database(path.join(__dirname, "pmt.db"));
const PORT = Number(process.env.PORT) || 3001;
const SESSION_DAYS = 7;
const STATUSES = new Set(["todo", "in_progress", "done"]);

app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
    if (/^\/(?:pmt\.db(?:-(?:shm|wal))?|server\.js|package(?:-lock)?\.json|README\.md|\.gitignore|\.npm-cache|node_modules|\.git)(?:\/|$)/i.test(req.path)) {
        return res.sendStatus(404);
    }
    next();
});
app.use(express.static(__dirname));

function dbRun(sql, values = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, values, function (error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbGet(sql, values = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, values, (error, row) => error ? reject(error) : resolve(row));
    });
}

function dbAll(sql, values = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, values, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

const databaseReady = (async () => {
    await dbRun("PRAGMA foreign_keys = ON");
    await dbRun(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        owner_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS project_members (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
        joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (project_id, user_id)
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
        assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        creator_id INTEGER NOT NULL REFERENCES users(id),
        due_date TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await dbRun("CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id)");
})();

function readCookie(req, name) {
    const cookies = (req.headers.cookie || "").split(";");
    for (const cookie of cookies) {
        const [key, ...value] = cookie.trim().split("=");
        if (key === name) return decodeURIComponent(value.join("="));
    }
    return "";
}

function setSessionCookie(res, token) {
    const maxAge = SESSION_DAYS * 24 * 60 * 60;
    res.setHeader("Set-Cookie", `pmt_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", "pmt_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function makePassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return { salt, hash };
}

function passwordMatches(password, salt, expectedHash) {
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function createSession(userId, res) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    await dbRun("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [hashToken(token), userId, expiresAt]);
    setSessionCookie(res, token);
}

async function currentUser(req) {
    const token = readCookie(req, "pmt_session");
    if (!token) return null;
    return (await dbGet(
        `SELECT users.id, users.name, users.email
         FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
        [hashToken(token), Date.now()]
    )) || null;
}

async function requireUser(req, res) {
    const user = await currentUser(req);
    if (!user) {
        res.status(401).json({ error: "Please sign in to continue." });
        return null;
    }
    return user;
}

async function projectAccess(projectId, userId) {
    return dbGet(
        `SELECT projects.id, projects.name, projects.description, projects.owner_id,
                project_members.role
         FROM projects JOIN project_members ON project_members.project_id = projects.id
         WHERE projects.id = ? AND project_members.user_id = ?`,
        [projectId, userId]
    );
}

function cleanText(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

app.post("/api/auth/register", async (req, res) => {
    const name = cleanText(req.body?.name, 100);
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 128) {
        return res.status(400).json({ error: "Enter your name, a valid email, and a password of at least 8 characters." });
    }
    try {
        const { salt, hash } = makePassword(password);
        const result = await dbRun(
            "INSERT INTO users (name, email, password_hash, salt) VALUES (?, ?, ?, ?)",
            [name, email, hash, salt]
        );
        await createSession(result.lastID, res);
        res.status(201).json({ user: { id: result.lastID, name, email } });
    } catch (error) {
        if (error.message.includes("UNIQUE constraint failed")) {
            return res.status(409).json({ error: "An account with that email already exists. Sign in instead." });
        }
        console.error("Account registration failed:", error);
        res.status(500).json({ error: "Could not create your account." });
    }
});

app.post("/api/auth/login", async (req, res) => {
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    try {
        const user = await dbGet("SELECT id, name, email, password_hash, salt FROM users WHERE email = ?", [email]);
        if (!user || !passwordMatches(password, user.salt, user.password_hash)) {
            return res.status(401).json({ error: "Email or password is incorrect." });
        }
        await createSession(user.id, res);
        res.json({ user: { id: user.id, name: user.name, email: user.email } });
    } catch (error) {
        console.error("Sign in failed:", error);
        res.status(500).json({ error: "Could not sign in." });
    }
});

app.get("/api/auth/me", async (req, res) => {
    try {
        const user = await currentUser(req);
        if (!user) return res.status(401).json({ error: "Not signed in." });
        res.json({ user });
    } catch (error) {
        console.error("Account lookup failed:", error);
        res.status(500).json({ error: "Could not load your account." });
    }
});

app.post("/api/auth/logout", async (req, res) => {
    try {
        const token = readCookie(req, "pmt_session");
        if (token) await dbRun("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
        clearSessionCookie(res);
        res.json({ success: true });
    } catch (error) {
        console.error("Sign out failed:", error);
        res.status(500).json({ error: "Could not sign out." });
    }
});

app.get("/api/projects", async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const projects = await dbAll(
            `SELECT projects.id, projects.name, projects.description, projects.owner_id,
                    project_members.role,
                    (SELECT COUNT(*) FROM project_members m WHERE m.project_id = projects.id) AS member_count
             FROM projects JOIN project_members ON project_members.project_id = projects.id
             WHERE project_members.user_id = ? ORDER BY projects.created_at DESC`,
            [user.id]
        );
        res.json({ projects });
    } catch (error) {
        console.error("Could not load projects:", error);
        res.status(500).json({ error: "Could not load projects." });
    }
});

app.post("/api/projects", async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const name = cleanText(req.body?.name, 120);
        const description = cleanText(req.body?.description, 500);
        if (!name) return res.status(400).json({ error: "Give your project a name." });
        const result = await dbRun("INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)", [name, description, user.id]);
        await dbRun("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')", [result.lastID, user.id]);
        res.status(201).json({ project: { id: result.lastID, name, description, owner_id: user.id, role: "owner", member_count: 1 } });
    } catch (error) {
        console.error("Could not create project:", error);
        res.status(500).json({ error: "Could not create project." });
    }
});

app.get("/api/projects/:id", async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const projectId = Number(req.params.id);
        const project = await projectAccess(projectId, user.id);
        if (!project) return res.status(404).json({ error: "Project not found." });
        const members = await dbAll(
            `SELECT users.id, users.name, users.email, project_members.role
             FROM project_members JOIN users ON users.id = project_members.user_id
             WHERE project_members.project_id = ? ORDER BY project_members.role DESC, users.name`,
            [projectId]
        );
        const tasks = await dbAll(
            `SELECT tasks.id, tasks.project_id, tasks.title, tasks.description, tasks.status,
                    tasks.assignee_id, tasks.creator_id, tasks.due_date, tasks.created_at,
                    assignee.name AS assignee_name,
                    (SELECT COUNT(*) FROM comments WHERE comments.task_id = tasks.id) AS comment_count
             FROM tasks LEFT JOIN users AS assignee ON assignee.id = tasks.assignee_id
             WHERE tasks.project_id = ? ORDER BY tasks.created_at DESC`,
            [projectId]
        );
        res.json({ project, members, tasks });
    } catch (error) {
        console.error("Could not load project:", error);
        res.status(500).json({ error: "Could not load project." });
    }
});

app.post("/api/projects/:id/members", async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const projectId = Number(req.params.id);
        const project = await projectAccess(projectId, user.id);
        if (!project) return res.status(404).json({ error: "Project not found." });
        if (project.role !== "owner") return res.status(403).json({ error: "Only the project owner can add teammates." });
        const email = cleanText(req.body?.email, 254).toLowerCase();
        if (!email) return res.status(400).json({ error: "Enter the teammate's account email." });
        const teammate = await dbGet("SELECT id, name, email FROM users WHERE email = ?", [email]);
        if (!teammate) return res.status(404).json({ error: "That person needs to create an account before you can add them." });
        await dbRun("INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')", [projectId, teammate.id]);
        const members = await dbAll(
            `SELECT users.id, users.name, users.email, project_members.role
             FROM project_members JOIN users ON users.id = project_members.user_id
             WHERE project_members.project_id = ? ORDER BY project_members.role DESC, users.name`,
            [projectId]
        );
        res.status(201).json({ members });
    } catch (error) {
        console.error("Could not add teammate:", error);
        res.status(500).json({ error: "Could not add teammate." });
    }
});

app.post("/api/projects/:id/tasks", async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const projectId = Number(req.params.id);
        if (!await projectAccess(projectId, user.id)) return res.status(404).json({ error: "Project not found." });
        const title = cleanText(req.body?.title, 160);
        const description = cleanText(req.body?.description, 2000);
        const rawAssignee = req.body?.assigneeId;
        const assigneeId = rawAssignee ? Number(rawAssignee) : null;
        const dueDate = cleanText(req.body?.dueDate, 10) || null;
        if (!title) return res.status(400).json({ error: "Give your task a title." });
        if (assigneeId && !await dbGet("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?", [projectId, assigneeId])) {
            return res.status(400).json({ error: "Choose a teammate on this project." });
        }
        const result = await dbRun(
            "INSERT INTO tasks (project_id, title, description, assignee_id, creator_id, due_date) VALUES (?, ?, ?, ?, ?, ?)",
            [projectId, title, description, assigneeId, user.id, dueDate]
        );
        res.status(201).json({ taskId: result.lastID });
    } catch (error) {
        console.error("Could not create task:", error);
        res.status(500).json({ error: "Could not create task." });
    }
});

app.patch("/api/tasks/:id", async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const task = await dbGet("SELECT id, project_id FROM tasks WHERE id = ?", [Number(req.params.id)]);
        if (!task || !await projectAccess(task.project_id, user.id)) return res.status(404).json({ error: "Task not found." });
        const status = req.body?.status;
        const rawAssignee = req.body?.assigneeId;
        const assigneeId = rawAssignee ? Number(rawAssignee) : null;
        const dueDate = cleanText(req.body?.dueDate, 10) || null;
        if (!STATUSES.has(status)) return res.status(400).json({ error: "Choose a valid task status." });
        if (assigneeId && !await dbGet("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?", [task.project_id, assigneeId])) {
            return res.status(400).json({ error: "Choose a teammate on this project." });
        }
        await dbRun("UPDATE tasks SET status = ?, assignee_id = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, assigneeId, dueDate, task.id]);
        res.json({ success: true });
    } catch (error) {
        console.error("Could not update task:", error);
        res.status(500).json({ error: "Could not update task." });
    }
});

app.delete("/api/tasks/:id", async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const task = await dbGet("SELECT id, project_id FROM tasks WHERE id = ?", [Number(req.params.id)]);
        if (!task || !await projectAccess(task.project_id, user.id)) return res.status(404).json({ error: "Task not found." });
        await dbRun("DELETE FROM tasks WHERE id = ?", [task.id]);
        res.json({ success: true });
    } catch (error) {
        console.error("Could not delete task:", error);
        res.status(500).json({ error: "Could not delete task." });
    }
});

app.get("/api/tasks/:id/comments", async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const task = await dbGet("SELECT id, project_id FROM tasks WHERE id = ?", [Number(req.params.id)]);
        if (!task || !await projectAccess(task.project_id, user.id)) return res.status(404).json({ error: "Task not found." });
        const comments = await dbAll(
            `SELECT comments.id, comments.body, comments.created_at, users.id AS user_id, users.name
             FROM comments JOIN users ON users.id = comments.user_id
             WHERE comments.task_id = ? ORDER BY comments.created_at ASC`,
            [task.id]
        );
        res.json({ comments });
    } catch (error) {
        console.error("Could not load comments:", error);
        res.status(500).json({ error: "Could not load comments." });
    }
});

app.post("/api/tasks/:id/comments", async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const task = await dbGet("SELECT id, project_id FROM tasks WHERE id = ?", [Number(req.params.id)]);
        if (!task || !await projectAccess(task.project_id, user.id)) return res.status(404).json({ error: "Task not found." });
        const body = cleanText(req.body?.body, 2000);
        if (!body) return res.status(400).json({ error: "Write a comment first." });
        const result = await dbRun("INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)", [task.id, user.id, body]);
        res.status(201).json({ comment: { id: result.lastID, body, name: user.name, created_at: new Date().toISOString() } });
    } catch (error) {
        console.error("Could not post comment:", error);
        res.status(500).json({ error: "Could not post comment." });
    }
});

app.use((error, req, res, next) => {
    console.error("Request failed:", error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
});

databaseReady.then(() => {
    app.listen(PORT, () => console.log(`Flowboard is running at http://localhost:${PORT}`));
}).catch(error => {
    console.error("Could not initialize the database:", error);
    process.exitCode = 1;
});
