# Flowboard — Project Management Tool

Flowboard is a small collaborative project board built for CodeAlpha Full Stack Development Task 3. It uses HTML, CSS, JavaScript, Express, and SQLite.

## Features

- Register, sign in, and sign out
- Create group projects and invite registered teammates by email
- Add task cards with details, assignees, and due dates
- Move work between To do, In progress, and Done
- Comment on tasks and follow the discussion
- Store users, sessions, projects, memberships, tasks, and comments in SQLite

## Run locally

1. Install [Node.js](https://nodejs.org/).
2. Open PowerShell in this project folder.
3. Install dependencies:

   ```powershell
   npm install
   ```

4. Start the app:

   ```powershell
   node server.js
   ```

5. Open <http://localhost:3001> in your browser and create an account.

The SQLite database is created automatically as `pmt.db` the first time the server starts. It is excluded from Git by `.gitignore`.

## Invite a teammate

Ask the teammate to create an account first. Open a project, choose **Invite teammate**, and enter the email address used for their account. They will then see that project after signing in.

## Security notes

Passwords are stored as salted scrypt hashes. Login sessions use random tokens; only their SHA-256 hashes are stored in the database. Do not commit local database files or secrets.
