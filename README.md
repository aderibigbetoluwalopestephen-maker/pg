# Provost Office Management & Correspondence System

A blue-and-gold Provost Office management system with a persistent **Node.js + SQLite backend**.

## What is included
- Existing Provost Office UI preserved.
- Persistent SQLite database in `data/provost-office.db`.
- Server-side authentication and role enforcement.
- Four configured users:
  - Provost — Superadmin
  - Staff 1 — Staff
  - Staff 2 — Staff
  - IT Student — mail input/routing and meetings only
- Mail creation, editing, status updates and read state are saved to the database.
- Meeting creation and cancellation are saved to the database.
- User-specific settings, including dark mode, are saved to the database.
- Notifications are stored in the database.
- Subtle page, panel, modal and toast animations were added without changing the existing UI structure.
- Postgraduate College, University of Ibadan branding remains in the interface.

## Run locally
Requires **Node.js 22.5+** because the project uses Node's built-in SQLite support.

```bash
npm start
```

Then open:

`http://localhost:3000`

## Demo accounts
All four seeded accounts use the password:

`password`

- `provost@university.edu`
- `staff1@university.edu`
- `staff2@university.edu`
- `itstudent@university.edu`

Change these credentials before production deployment.

## Database
The database is SQLite and is stored at:

`data/provost-office.db`

The server creates the database and required tables automatically if the database is missing.

## Production notes
For a real institutional deployment, run behind HTTPS and use strong unique passwords, secure cookie settings, backups, server access controls, audit logging and a managed server/hosting environment. The seeded demo password should be changed before real use.
