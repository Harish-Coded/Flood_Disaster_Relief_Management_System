# Flood Disaster Relief Management System

Demonstration system built with Node.js, Express, SQLite and static HTML. It includes role-based login and reports, plus operational modules for flood incidents, victims, camps, rescue teams, resources and allocations, donations, emergency requests, notifications and volunteer field activity.

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
- **Role-specific operations dashboard** — each role has a tailored module list and live summary counts.
- **Operational APIs** — role-checked record creation and status updates, citizen-owned incident/request views, safe stock allocation, rescue assignment, victim camp assignment with capacity checks, notifications and field activities.
- **Admin database backup** — `GET /api/backup` downloads a consistent SQLite backup.
- **Demo data** — initialization creates sample camps, incidents, victims, rescue teams, resources, donations, a request, notifications and activity when the operational tables are empty.
- **Reports (Module 9)** — Administrator/Officer-only dashboard at
  `/dashboard/reports.html`:
  - Summary cards: total/active/deactivated users, total login attempts,
    failed attempts, login success rate.
  - Users-by-role breakdown (bar chart, built from live data).
  - Full login audit trail (who, when, which role, success/fail, IP).
  - Registered user roster (name, email, phone, role, status, join date, last
    login).
  - Volunteers and Citizens get a `403 Forbidden` if they hit the Reports URL
    or API directly — access is enforced server-side, not just hidden in the
    UI.

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
│   ├── css/styles.css    # shared styling (login, dashboard, reports)
│   └── js/
│       ├── login.js
│       ├── register.js
│       └── reports.js    # Module 9 client logic
├── views/
│   ├── dashboard.html    # shared placeholder dashboard (role-aware)
│   └── reports.html      # Module 9 Reports dashboard
├── server.js              # Express app: routes, auth logic, session handling, reports API
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

## Operational modules and access

Administrators and Officers manage operational records. Citizens can report incidents and request help, and can view public camps. Volunteers can submit field activities and see notifications. API role checks run on the server. Operational list and create endpoints use `/api/modules/:module` with module names `incidents`, `victims`, `camps`, `teams`, `resources`, `donations`, `requests`, `activities` and `notifications`. Admin/Officer allocation and assignment endpoints are `/api/allocate`, `/api/assign-team` and `/api/assign-victim`.

## Trying the Reports module

1. Log in as `admin@fdrms.gov.in` / `Admin@123` (or the Officer account).
2. On the dashboard, click **Open Reports →**.
3. You'll see summary stats, a users-by-role breakdown, the full login audit
   trail, and the registered-user roster, all pulled live from the same
   SQLite database as Module 1.
4. Log in as the Volunteer or Citizen demo account and try opening
   `/dashboard/reports.html` directly — you'll get a `403 Forbidden`, since
   Reports access is role-checked on the server, not just hidden in the UI.

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
