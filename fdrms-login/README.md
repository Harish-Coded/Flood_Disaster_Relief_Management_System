# FDRMS — Module 1: Login & Authentication

Flood Disaster Relief Management System — Login & Authentication module,
built to match the SPP/SRS you shared (Node.js backend, SQL database, role-based access
for Administrator, Disaster Management Officer, Volunteer, and Citizen).

## What's included

- **Role-based login** — one login form, four roles (Administrator, Disaster
  Management Officer, Volunteer, Citizen). The account's stored role must match
  the selected role tab to sign in.
- **Citizen / Volunteer self-registration** — matches the SRS access model,
  where Admin and Officer accounts are provisioned internally rather than
  self-registered.
- **Secure password storage** — passwords are hashed with bcrypt, never stored
  or logged in plain text.
- **Session-based authentication** — `express-session` cookies, 4-hour expiry,
  `httpOnly` cookies.
- **Login audit trail** — every login attempt (success or failure) is recorded
  in a `login_audit` table with timestamp and IP, useful for the SRS's
  "Secure authentication" non-functional requirement.
- **Role-protected routes** — each dashboard route checks the session role
  before rendering; a citizen cannot open the admin dashboard URL directly.
- **Placeholder dashboard** — a simple authenticated landing page per role,
  ready for Modules 2–9 (Disaster Reporting, Victim Registration, Relief Camp
  Management, Rescue Teams, Resource Allocation, Donations, Notifications,
  Reports) to be built on top of.

## Tech stack

| Layer      | Choice                                   |
|------------|-------------------------------------------|
| Backend    | Node.js + Express                         |
| Database   | SQLite (via `better-sqlite3`)             |
| Auth       | `express-session` + `bcryptjs`            |
| Frontend   | Static HTML/CSS/JS (no framework needed)  |

> The SRS lists MySQL as the target database. This module uses SQLite so it
> runs anywhere with zero external setup — the schema in `db/init.js` maps
> directly onto a `users` table you can recreate in MySQL for the full
> project (see **Moving to MySQL** below).

## Folder structure

```
fdrms-login/
├── db/
│   └── init.js          # creates + seeds the SQLite database
├── public/
│   ├── login.html        # login page
│   ├── register.html     # citizen/volunteer sign-up page
│   ├── css/styles.css    # shared styling
│   └── js/
│       ├── login.js
│       └── register.js
├── views/
│   └── dashboard.html    # shared placeholder dashboard (role-aware)
├── server.js              # Express app: routes, auth logic, session handling
├── package.json
└── README.md
```

## Setup

Requires **Node.js 18+**.

```bash
cd fdrms-login
npm install          # installs express, better-sqlite3, bcryptjs, express-session
npm run initdb        # creates db/fdrms.db and seeds demo accounts (safe to re-run)
npm start              # starts the server on http://localhost:3000
```

Then open **http://localhost:3000** in a browser — it redirects to the login page.

## Demo accounts (seeded automatically)

| Role                          | Email                        | Password       |
|--------------------------------|-------------------------------|-----------------|
| Administrator                  | admin@fdrms.gov.in            | Admin@123       |
| Disaster Management Officer    | officer@fdrms.gov.in          | Officer@123     |
| Volunteer                      | volunteer@fdrms.gov.in        | Volunteer@123   |
| Citizen                        | citizen@fdrms.gov.in          | Citizen@123     |

Select the matching role tab on the login page before signing in — the module
checks that the account's actual role matches the tab you selected.

To test self-registration, use **Create an account** on the login page (Citizen
or Volunteer only, matching the SRS's public-facing roles).

## How the pieces map to your SRS

- **5. Functional Requirements → Login** (all four roles) → `POST /api/login`
- **6. Non-Functional Requirements → Secure authentication** → bcrypt hashing,
  `httpOnly` session cookies, login audit table
- **6. Non-Functional Requirements → Fast response time** → SQLite lookups are
  sub-millisecond; no external calls in the auth path
- **9. WBS → Development → Login Module** → this entire package

## Moving to MySQL later

The `users` table in `db/init.js` is written in plain SQL and maps directly:

```sql
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  phone         VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','officer','volunteer','citizen') NOT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login    TIMESTAMP NULL
);
```

Swap `better-sqlite3` for `mysql2`, replace the `db.prepare(...).run/get()` calls
in `server.js` with `mysql2` query equivalents, and the rest of the module
(routes, sessions, hashing, validation) stays the same.

## Notes for your report / viva

- Passwords are never stored in plain text (bcrypt, salt rounds = 10).
- Sessions expire after 4 hours of inactivity by default (`cookie.maxAge`).
- Every login attempt — successful or not — is written to `login_audit` for
  traceability, addressing the SRS's disaster-response accountability needs.
- Role selection is enforced server-side, not just hidden in the UI, so a
  citizen account cannot be used to reach the admin dashboard even by guessing
  the URL.
