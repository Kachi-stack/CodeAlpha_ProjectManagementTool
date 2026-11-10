const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const authMessage = document.getElementById("auth-message");
const authTitle = document.getElementById("auth-title");
const authIntro = document.getElementById("auth-intro");
const authSwitchCopy = document.getElementById("auth-switch-copy");
const authSwitchButton = document.getElementById("auth-switch-button");
const projectList = document.getElementById("project-list");
const welcomePanel = document.getElementById("welcome-panel");
const projectPanel = document.getElementById("project-panel");
const projectDialog = document.getElementById("project-dialog");
const taskDialog = document.getElementById("task-dialog");
const inviteDialog = document.getElementById("invite-dialog");
const taskDetailsDialog = document.getElementById("task-details-dialog");
const projectFormMessage = document.getElementById("project-form-message");
const taskFormMessage = document.getElementById("task-form-message");
const inviteFormMessage = document.getElementById("invite-form-message");
const boardMessage = document.getElementById("board-message");

let currentUser = null;
let projects = [];
let activeProject = null;
let activeTask = null;
let authMode = "login";

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });
    const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The request could not be completed.");
    return result;
}

function setMessage(element, text, isError = false) {
    element.textContent = text;
    element.classList.toggle("error", isError);
}

function switchAuthMode(mode) {
    authMode = mode;
    const isRegister = mode === "register";
    loginForm.hidden = isRegister;
    registerForm.hidden = !isRegister;
    authTitle.textContent = isRegister ? "Create your account" : "Welcome back";
    authIntro.textContent = isRegister
        ? "Create an account to start working with your team."
        : "Sign in to continue to your workspace.";
    authSwitchCopy.textContent = isRegister ? "Already have an account?" : "Don't have an account?";
    authSwitchButton.textContent = isRegister ? "Sign in" : "Create one";
    setMessage(authMessage, "");
}

function showWorkspace(user) {
    currentUser = user;
    authScreen.hidden = true;
    appScreen.hidden = false;
    document.getElementById("current-user").textContent = `${user.name} · ${user.email}`;
}

function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function showModal(dialog, messageElement) {
    if (messageElement) setMessage(messageElement, "");
    dialog.showModal();
}

document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => document.getElementById(button.dataset.close).close());
});

authSwitchButton.addEventListener("click", () => switchAuthMode(authMode === "login" ? "register" : "login"));

async function handleAuthSubmit(event, mode) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    setMessage(authMessage, "");
    try {
        const result = await api(`/api/auth/${mode}`, {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        form.reset();
        showWorkspace(result.user);
        await loadProjects();
    } catch (error) {
        setMessage(authMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
}

loginForm.addEventListener("submit", event => handleAuthSubmit(event, "login"));
registerForm.addEventListener("submit", event => handleAuthSubmit(event, "register"));

async function loadProjects(selectId = null) {
    const result = await api("/api/projects");
    projects = result.projects;
    renderProjectList();
    const projectToSelect = projects.find(project => project.id === Number(selectId)) ||
        projects.find(project => activeProject && project.id === activeProject.id) ||
        projects[0];
    if (projectToSelect) {
        await loadProject(projectToSelect.id);
    } else {
        activeProject = null;
        projectPanel.hidden = true;
        welcomePanel.hidden = false;
    }
}

function renderProjectList() {
    projectList.replaceChildren();
    if (projects.length === 0) {
        const empty = document.createElement("p");
        empty.className = "sidebar-empty";
        empty.textContent = "Your projects will appear here.";
        projectList.appendChild(empty);
        return;
    }
    projects.forEach(project => {
        const button = document.createElement("button");
        button.type = "button";
        button.classList.toggle("active", activeProject?.id === project.id);
        const dot = document.createElement("span");
        dot.className = "project-dot";
        const name = document.createElement("span");
        name.textContent = project.name;
        button.append(dot, name);
        button.addEventListener("click", () => loadProject(project.id));
        projectList.appendChild(button);
    });
}

async function loadProject(projectId) {
    try {
        const result = await api(`/api/projects/${projectId}`);
        activeProject = result;
        welcomePanel.hidden = true;
        projectPanel.hidden = false;
        document.getElementById("project-title").textContent = result.project.name;
        document.getElementById("project-description").textContent = result.project.description || "A shared space for your team's work.";
        document.getElementById("member-count").textContent = `${result.members.length} ${result.members.length === 1 ? "member" : "members"}`;
        renderProjectList();
        renderBoard();
        setMessage(boardMessage, "");
        return result;
    } catch (error) {
        setMessage(boardMessage, error.message, true);
    }
}

function renderBoard() {
    const board = document.getElementById("task-board");
    board.replaceChildren();
    const columns = [
        { id: "todo", label: "To do" },
        { id: "in_progress", label: "In progress" },
        { id: "done", label: "Done" }
    ];
    columns.forEach(column => {
        const tasks = activeProject.tasks.filter(task => task.status === column.id);
        const section = document.createElement("section");
        section.className = "task-column";
        const heading = document.createElement("div");
        heading.className = "column-heading";
        const label = document.createElement("span");
        label.textContent = column.label;
        const count = document.createElement("span");
        count.className = "column-count";
        count.textContent = tasks.length;
        heading.append(label, count);
        section.appendChild(heading);
        if (tasks.length === 0) {
            const empty = document.createElement("p");
            empty.className = "column-empty";
            empty.textContent = "No tasks here yet.";
            section.appendChild(empty);
        }
        tasks.forEach(task => section.appendChild(createTaskCard(task)));
        board.appendChild(section);
    });
}

function createTaskCard(task) {
    const card = document.createElement("article");
    card.className = "task-card";
    const title = document.createElement("button");
    title.className = "task-card-title";
    title.type = "button";
    title.textContent = task.title;
    title.addEventListener("click", () => openTaskDetails(task.id));
    card.appendChild(title);
    if (task.description) {
        const description = document.createElement("div");
        description.className = "task-card-description";
        description.textContent = task.description;
        card.appendChild(description);
    }
    const meta = document.createElement("div");
    meta.className = "task-meta";
    const assignee = document.createElement("span");
    assignee.className = "task-assignee";
    if (task.assignee_name) {
        const avatar = document.createElement("span");
        avatar.className = "avatar";
        avatar.textContent = initials(task.assignee_name);
        const person = document.createElement("span");
        person.textContent = task.assignee_name;
        assignee.append(avatar, person);
    } else {
        assignee.textContent = "Unassigned";
    }
    const dateAndComments = document.createElement("span");
    const date = task.due_date ? formatDate(task.due_date) : "";
    dateAndComments.textContent = `${date ? `${date} · ` : ""}☰ ${task.comment_count}`;
    if (task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== "done") {
        dateAndComments.classList.add("task-due", "overdue");
    }
    meta.append(assignee, dateAndComments);
    card.appendChild(meta);
    return card;
}

function formatDate(dateString) {
    if (!dateString) return "";
    const date = new Date(`${dateString}T00:00:00`);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fillAssigneeOptions(select, selectedId = "") {
    select.replaceChildren();
    const unassigned = document.createElement("option");
    unassigned.value = "";
    unassigned.textContent = "Unassigned";
    select.appendChild(unassigned);
    activeProject.members.forEach(member => {
        const option = document.createElement("option");
        option.value = member.id;
        option.textContent = member.name;
        option.selected = Number(selectedId) === member.id;
        select.appendChild(option);
    });
}

function openTaskDialog() {
    document.getElementById("task-form").reset();
    fillAssigneeOptions(document.getElementById("task-assignee"));
    showModal(taskDialog, taskFormMessage);
    document.getElementById("task-title").focus();
}

async function openTaskDetails(taskId) {
    activeTask = activeProject.tasks.find(task => task.id === taskId);
    if (!activeTask) return;
    document.getElementById("detail-task-title").textContent = activeTask.title;
    document.getElementById("detail-task-description").textContent = activeTask.description || "No extra details for this task.";
    document.getElementById("detail-task-status").value = activeTask.status;
    fillAssigneeOptions(document.getElementById("detail-task-assignee"), activeTask.assignee_id || "");
    document.getElementById("detail-task-due").textContent = activeTask.due_date ? formatDate(activeTask.due_date) : "No due date";
    document.getElementById("comment-input").value = "";
    await loadComments();
    taskDetailsDialog.showModal();
}

async function loadComments() {
    const commentList = document.getElementById("comment-list");
    commentList.replaceChildren();
    try {
        const result = await api(`/api/tasks/${activeTask.id}/comments`);
        if (result.comments.length === 0) {
            const empty = document.createElement("p");
            empty.className = "comments-empty";
            empty.textContent = "No comments yet. Start the conversation.";
            commentList.appendChild(empty);
            return;
        }
        result.comments.forEach(comment => {
            const item = document.createElement("article");
            item.className = "comment";
            const avatar = document.createElement("span");
            avatar.className = "avatar";
            avatar.textContent = initials(comment.name);
            const body = document.createElement("div");
            body.className = "comment-body";
            const head = document.createElement("div");
            head.className = "comment-head";
            const author = document.createElement("span");
            author.textContent = comment.name;
            const time = document.createElement("time");
            time.textContent = new Date(comment.created_at.replace(" ", "T") + "Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            head.append(author, time);
            const text = document.createElement("div");
            text.className = "comment-text";
            text.textContent = comment.body;
            body.append(head, text);
            item.append(avatar, body);
            commentList.appendChild(item);
        });
        commentList.scrollTop = commentList.scrollHeight;
    } catch (error) {
        const failure = document.createElement("p");
        failure.className = "comments-empty";
        failure.textContent = error.message;
        commentList.appendChild(failure);
    }
}

async function updateTaskDetails() {
    if (!activeTask) return;
    const status = document.getElementById("detail-task-status").value;
    const assigneeId = document.getElementById("detail-task-assignee").value;
    try {
        await api(`/api/tasks/${activeTask.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status, assigneeId, dueDate: activeTask.due_date || "" })
        });
        const taskId = activeTask.id;
        await loadProject(activeProject.project.id);
        activeTask = activeProject.tasks.find(task => task.id === taskId);
    } catch (error) {
        setMessage(boardMessage, error.message, true);
    }
}

document.getElementById("detail-task-status").addEventListener("change", updateTaskDetails);
document.getElementById("detail-task-assignee").addEventListener("change", updateTaskDetails);

document.getElementById("new-project-button").addEventListener("click", () => showModal(projectDialog, projectFormMessage));
document.getElementById("welcome-create-button").addEventListener("click", () => showModal(projectDialog, projectFormMessage));
document.getElementById("new-task-button").addEventListener("click", openTaskDialog);
document.getElementById("invite-button").addEventListener("click", () => {
    document.getElementById("invite-form").reset();
    showModal(inviteDialog, inviteFormMessage);
});

document.getElementById("project-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const result = await api("/api/projects", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        form.reset();
        projectDialog.close();
        await loadProjects(result.project.id);
    } catch (error) {
        setMessage(projectFormMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

document.getElementById("task-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        await api(`/api/projects/${activeProject.project.id}/tasks`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        form.reset();
        taskDialog.close();
        await loadProject(activeProject.project.id);
    } catch (error) {
        setMessage(taskFormMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

document.getElementById("invite-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        await api(`/api/projects/${activeProject.project.id}/members`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        form.reset();
        inviteDialog.close();
        await loadProject(activeProject.project.id);
    } catch (error) {
        setMessage(inviteFormMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

document.getElementById("comment-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        await api(`/api/tasks/${activeTask.id}/comments`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        form.reset();
        await loadComments();
        await loadProject(activeProject.project.id);
        activeTask = activeProject.tasks.find(task => task.id === activeTask.id);
    } catch (error) {
        setMessage(boardMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

document.getElementById("delete-task-button").addEventListener("click", async () => {
    if (!activeTask || !window.confirm(`Delete “${activeTask.title}”? This also deletes its comments.`)) return;
    const projectId = activeProject.project.id;
    try {
        await api(`/api/tasks/${activeTask.id}`, { method: "DELETE" });
        taskDetailsDialog.close();
        activeTask = null;
        await loadProject(projectId);
    } catch (error) {
        setMessage(boardMessage, error.message, true);
    }
});

document.getElementById("logout-button").addEventListener("click", async () => {
    try {
        await api("/api/auth/logout", { method: "POST" });
    } finally {
        currentUser = null;
        projects = [];
        activeProject = null;
        appScreen.hidden = true;
        authScreen.hidden = false;
        switchAuthMode("login");
    }
});

async function startApp() {
    try {
        const result = await api("/api/auth/me");
        showWorkspace(result.user);
        await loadProjects();
    } catch {
        authScreen.hidden = false;
        appScreen.hidden = true;
    }
}

startApp();
