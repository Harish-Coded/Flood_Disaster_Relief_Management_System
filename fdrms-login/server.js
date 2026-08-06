// server.js
// Module 1: Login & Authentication — Flood Disaster Relief Management System
//
// Implements:
//  - Citizen self-registration
//  - Role-based login (Administrator, Disaster Management Officer, Volunteer, Citizen)
//  - Secure password hashing (bcrypt)
//  - Session-based authentication (express-session, sqlite-backed store)
//  - Login attempt auditing
//  - Role-based redirect to placeholder dashboards
//  - Logout

const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "db", "fdrms.db");
const db = new Database(DB_PATH);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    // NOTE: uses the built-in MemoryStore, which is fine for this single-process
    // demo/dev module. For a production deployment, swap in a persistent store
    // (e.g. connect-sqlite3, connect-redis) backed by the MySQL/other DB from the SRS.
    secret: "fdrms-module1-dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 4, // 4 hours
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

// ---------- helpers ----------

const ROLE_LABELS = {
  admin: "Administrator",
  officer: "Disaster Management Officer",
  volunteer: "Volunteer",
  citizen: "Citizen",
};

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login.html");
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login.html");
    if (req.session.user.role !== role) return res.status(403).send("Forbidden: wrong role for this dashboard.");
    next();
  };
}

// ---------- API: register ----------
// Only "citizen" and "volunteer" may self-register.
// Admin / Officer accounts are provisioned internally (seeded) per the SRS access model.

app.post("/api/register", (req, res) => {
  const { full_name, email, phone, password, confirm_password, role } = req.body;

  if (!full_name || !email || !password || !confirm_password || !role) {
    return res.status(400).json({ error: "All required fields must be filled." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  if (password !== confirm_password) {
    return res.status(400).json({ error: "Passwords do not match." });
  }
  if (!["citizen", "volunteer"].includes(role)) {
    return res.status(400).json({ error: "Self-registration is only available for Citizen or Volunteer roles." });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare(`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(full_name.trim(), email.toLowerCase().trim(), phone ? phone.trim() : null, password_hash, role);

  return res.json({ success: true, message: "Account created. You can now log in." });
});

// ---------- API: login ----------

app.post("/api/login", (req, res) => {
  const { email, password, role } = req.body;
  const ip = req.ip;

  if (!email || !password || !role) {
    return res.status(400).json({ error: "Email, password, and role are required." });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());

  const audit = db.prepare(`
    INSERT INTO login_audit (user_id, email_tried, success, ip_address)
    VALUES (?, ?, ?, ?)
  `);

  if (!user) {
    audit.run(null, email, 0, ip);
    return res.status(401).json({ error: "Invalid email or password." });
  }

  if (!user.is_active) {
    audit.run(user.id, email, 0, ip);
    return res.status(403).json({ error: "This account has been deactivated. Contact the administrator." });
  }

  if (user.role !== role) {
    audit.run(user.id, email, 0, ip);
    return res.status(401).json({ error: `This account is not registered as ${ROLE_LABELS[role]}.` });
  }

  const passwordOk = bcrypt.compareSync(password, user.password_hash);
  if (!passwordOk) {
    audit.run(user.id, email, 0, ip);
    return res.status(401).json({ error: "Invalid email or password." });
  }

  audit.run(user.id, email, 1, ip);
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  req.session.user = {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
  };

  const redirects = {
    admin: "/dashboard/admin.html",
    officer: "/dashboard/officer.html",
    volunteer: "/dashboard/volunteer.html",
    citizen: "/dashboard/citizen.html",
  };

  return res.json({ success: true, redirect: redirects[user.role] });
});

// ---------- API: current session ----------

app.get("/api/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in." });
  res.json({ user: req.session.user, roleLabel: ROLE_LABELS[req.session.user.role] });
});

// ---------- API: logout ----------

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// ---------- protected dashboard routes ----------

app.get("/dashboard/admin.html", requireRole("admin"), (req, res) =>
  res.sendFile(path.join(__dirname, "views", "dashboard.html"))
);
app.get("/dashboard/officer.html", requireRole("officer"), (req, res) =>
  res.sendFile(path.join(__dirname, "views", "dashboard.html"))
);
app.get("/dashboard/volunteer.html", requireRole("volunteer"), (req, res) =>
  res.sendFile(path.join(__dirname, "views", "dashboard.html"))
);
app.get("/dashboard/citizen.html", requireRole("citizen"), (req, res) =>
  res.sendFile(path.join(__dirname, "views", "dashboard.html"))
);

app.get("/", (req, res) => res.redirect("/login.html"));

app.listen(PORT, () => {
  console.log(`\n  FDRMS Login Module running → http://localhost:${PORT}\n`);
});
