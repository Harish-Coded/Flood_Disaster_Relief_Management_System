# Flood Disaster Relief Management System

Node.js and Express application for role-based access, flood response operations, notifications, and reporting. It uses SQLite through `better-sqlite3` and serves a static HTML/CSS/JavaScript interface.

## Architecture

```
module1_login/             Login, registration, and browser scripts
module2_dashboard/         Shared role-aware operations dashboard and styles
module3_user_management/   User management scope (user roster is in Reports)
module4_inventory/         Inventory and resource allocation API scope
module5_orders/            Relief/emergency request API scope
module6_billing/           Donations API scope
module7_notifications/      Notifications and volunteer activity API scope
module8_reports/            Administrator/Officer reports page and browser logic
db/                         Shared SQLite initialization and database file
server.js                   Express entry point, shared middleware and API routes
package.json                Dependencies and npm commands
```

The existing application implements authentication, the shared operations dashboard, and reports as complete features. Operational records (incidents, victims, camps, rescue teams, resources, donations, emergency requests, activities, and notifications) use the role-checked `/api/modules/:module` endpoints in `server.js`; specialized allocation and assignment endpoints are also registered there. Modules 3–7 are represented by these API capabilities and dashboard sections; they do not yet have standalone page bundles.

Static assets are stored with their owning UI module and mounted by Express in `server.js`. The database initializer and database location remain shared at the root `db/` level. `FDRMS_DB_PATH` can override the default SQLite file path. `FDRMS_SESSION_SECRET` can override the development session secret, and `PORT` can override the default port `3000`.

## Start the application

Requires Node.js 18 or newer.

```bash
npm install
npm run initdb
npm start
```

Open <http://localhost:3000>. The initializer is safe to rerun and creates demo accounts and operational sample data when needed.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@fdrms.gov.in` | `Admin@123` |
| Disaster Management Officer | `officer@fdrms.gov.in` | `Officer@123` |
| Volunteer | `volunteer@fdrms.gov.in` | `Volunteer@123` |
| Citizen | `citizen@fdrms.gov.in` | `Citizen@123` |

Choose the matching role on the login screen. Citizens and Volunteers can self-register; Administrator and Officer accounts are provisioned internally.

## Main routes

- `POST /api/login`, `POST /api/register`, `POST /api/logout`, and `GET /api/me` handle sessions and authentication.
- `GET /api/dashboard` supplies role-aware summary data.
- `GET|POST /api/modules/:module` lists or creates supported operational records; `PATCH /api/modules/:module/:id` updates permitted records.
- `POST /api/allocate`, `POST /api/assign-team`, and `POST /api/assign-victim` perform guarded operational assignments. `GET /api/backup` is Administrator-only.
- `/dashboard/reports.html` and `/api/reports/{summary,audit,users}` are restricted to Administrators and Officers.

Every protected endpoint enforces access on the server. Passwords are stored as bcrypt hashes, and login attempts are recorded in `login_audit`.
