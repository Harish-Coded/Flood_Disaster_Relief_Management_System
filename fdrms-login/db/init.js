// db/init.js
// Initializes the SQLite database for the FDRMS Login & Authentication module.
// Creates the `users` table (mirrors the intended MySQL schema from the SRS)
// and seeds one demo account per role so the module can be tested immediately.

const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "fdrms.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name     TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    phone         TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('admin','officer','volunteer','citizen')),
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login    TEXT
  );

  CREATE TABLE IF NOT EXISTS login_audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    email_tried TEXT,
    success    INTEGER NOT NULL,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const seedUsers = [
  {
    full_name: "System Administrator",
    email: "admin@fdrms.gov.in",
    phone: "9000000001",
    password: "Admin@123",
    role: "admin",
  },
  {
    full_name: "Disaster Management Officer",
    email: "officer@fdrms.gov.in",
    phone: "9000000002",
    password: "Officer@123",
    role: "officer",
  },
  {
    full_name: "Field Volunteer",
    email: "volunteer@fdrms.gov.in",
    phone: "9000000003",
    password: "Volunteer@123",
    role: "volunteer",
  },
  {
    full_name: "Demo Citizen",
    email: "citizen@fdrms.gov.in",
    phone: "9000000004",
    password: "Citizen@123",
    role: "citizen",
  },
];

const insert = db.prepare(`
  INSERT INTO users (full_name, email, phone, password_hash, role)
  VALUES (@full_name, @email, @phone, @password_hash, @role)
`);

const existing = db.prepare("SELECT COUNT(*) AS c FROM users").get();

if (existing.c === 0) {
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const password_hash = bcrypt.hashSync(row.password, 10);
      insert.run({ ...row, password_hash });
    }
  });
  insertMany(seedUsers);
  console.log("✔ Database created and seeded with demo accounts:");
  seedUsers.forEach((u) =>
    console.log(`   [${u.role.padEnd(9)}] ${u.email}  /  ${u.password}`)
  );
} else {
  console.log("✔ Database already initialized. Skipping seed.");
}

db.close();
