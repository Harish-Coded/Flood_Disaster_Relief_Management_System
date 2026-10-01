// db/init.js
// Initializes the SQLite database for the FDRMS Login & Authentication module.
// Creates the `users` table (mirrors the intended MySQL schema from the SRS)
// and seeds one demo account per role so the module can be tested immediately.

const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const dbPath = process.env.FDRMS_DB_PATH || path.join(__dirname, "fdrms.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
// Operational modules are additive so an existing authentication database is preserved.
db.exec(`
 CREATE TABLE IF NOT EXISTS flood_incidents (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), location TEXT NOT NULL, description TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('Low','Medium','High','Critical')), people_affected INTEGER NOT NULL DEFAULT 1, contact TEXT, occurred_at TEXT, status TEXT NOT NULL DEFAULT 'Pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
 CREATE TABLE IF NOT EXISTS relief_camps (id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity>0), occupancy INTEGER NOT NULL DEFAULT 0 CHECK(occupancy>=0 AND occupancy<=capacity), contact_person TEXT, contact_number TEXT, facilities TEXT, status TEXT NOT NULL DEFAULT 'Active', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
 CREATE TABLE IF NOT EXISTS victims (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, gender TEXT, phone TEXT, address TEXT, incident_id INTEGER REFERENCES flood_incidents(id), family_size INTEGER NOT NULL DEFAULT 1, medical_needs TEXT, priority TEXT DEFAULT 'Medium', camp_id INTEGER REFERENCES relief_camps(id), status TEXT NOT NULL DEFAULT 'Registered', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
 CREATE TABLE IF NOT EXISTS rescue_teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL, leader TEXT, contact TEXT, members INTEGER DEFAULT 1, specialization TEXT, availability TEXT DEFAULT 'Available', status TEXT DEFAULT 'Available', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
 CREATE TABLE IF NOT EXISTS rescue_assignments (id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES rescue_teams(id), incident_id INTEGER REFERENCES flood_incidents(id), request_id INTEGER REFERENCES emergency_requests(id), mission TEXT NOT NULL, status TEXT DEFAULT 'Assigned', assigned_at TEXT DEFAULT (datetime('now')), completed_at TEXT);
 CREATE TABLE IF NOT EXISTS resources (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0 CHECK(quantity>=0), unit TEXT DEFAULT 'units', location TEXT, minimum_stock REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
 CREATE TABLE IF NOT EXISTS resource_allocations (id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL REFERENCES resources(id), camp_id INTEGER REFERENCES relief_camps(id), quantity REAL NOT NULL CHECK(quantity>0), purpose TEXT, allocated_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT (datetime('now')));
 CREATE TABLE IF NOT EXISTS donations (id INTEGER PRIMARY KEY, donor TEXT NOT NULL, contact TEXT, type TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, description TEXT, target TEXT, status TEXT DEFAULT 'Received', created_at TEXT DEFAULT (datetime('now')));
 CREATE TABLE IF NOT EXISTS emergency_requests (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), location TEXT NOT NULL, emergency_type TEXT NOT NULL, description TEXT NOT NULL, people INTEGER NOT NULL DEFAULT 1, contact TEXT, priority TEXT DEFAULT 'Medium', status TEXT DEFAULT 'Pending', team_id INTEGER REFERENCES rescue_teams(id), created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
 CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), role TEXT, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT DEFAULT 'Info', priority TEXT DEFAULT 'Normal', is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
 CREATE TABLE IF NOT EXISTS notification_reads (notification_id INTEGER NOT NULL REFERENCES notifications(id), user_id INTEGER NOT NULL REFERENCES users(id), read_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(notification_id,user_id));
 CREATE TABLE IF NOT EXISTS field_activities (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), activity_type TEXT NOT NULL, location TEXT NOT NULL, description TEXT, people_assisted INTEGER DEFAULT 0, resources_distributed TEXT, created_at TEXT DEFAULT (datetime('now')));
`);
if (!db.pragma("table_info(rescue_assignments)").some((column) => column.name === "volunteer_id")) {
  db.exec("ALTER TABLE rescue_assignments ADD COLUMN volunteer_id INTEGER REFERENCES users(id)");
}

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

// Small, repeatable operational dataset for a usable demonstration instance.
if (db.prepare("SELECT COUNT(*) c FROM flood_incidents").get().c === 0) {
  const adminId = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get()?.id || null;
  db.prepare("INSERT INTO relief_camps(name,location,capacity,occupancy,contact_person,contact_number,facilities) VALUES ('Riverside Community Hall','North Bank, Guwahati',120,34,'M. Das','9001001001','Water, medical desk, kitchen'),('Beltola High School','Beltola, Guwahati',200,81,'P. Sharma','9001001002','Dormitory, sanitation'),('Dispur Relief Centre','Dispur, Guwahati',90,18,'A. Ali','9001001003','First aid, food')").run();
  const camps=db.prepare("SELECT id FROM relief_camps ORDER BY id").all();
  db.prepare("INSERT INTO flood_incidents(user_id,location,description,severity,people_affected,contact,status) VALUES (?,?,?,?,?,?,?),(?,?,?,?,?,?,?),(?,?,?,?,?,?,?)")
    .run(adminId,'North Bank, Guwahati','Brahmaputra overflow affecting low-lying homes.','High',64,'9002002001','Approved',adminId,'Beltola, Guwahati','Water entered several streets after overnight rain.','Critical',120,'9002002002','In Progress',adminId,'Dispur, Guwahati','Road access blocked by water near the market.','Medium',22,'9002002003','Pending');
  const incidents=db.prepare("SELECT id FROM flood_incidents ORDER BY id").all();
  db.prepare("INSERT INTO victims(name,age,gender,phone,address,incident_id,family_size,medical_needs,priority,camp_id,status) VALUES (?,?,?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?,?,?)")
   .run('Anita Das',34,'Female','9003003001','North Bank',incidents[0].id,4,'Insulin','High',camps[0].id,'At Relief Camp','Rahul Ali',9,'Male','9003003002','Beltola',incidents[1].id,5,'None','Medium',camps[1].id,'At Relief Camp');
  db.prepare("INSERT INTO rescue_teams(name,leader,contact,members,specialization) VALUES ('River Response 1','R. Bora','9004004001',6,'Boat rescue'),('Medical Support 2','S. Nath','9004004002',4,'First aid'),('Rapid Relief 3','K. Das','9004004003',5,'Evacuation')").run();
  db.prepare("INSERT INTO resources(name,category,quantity,unit,location,minimum_stock) VALUES ('Drinking water','Water',420,'litres','Central depot',100),('Rice packets','Food',180,'packets','Central depot',50),('First aid kits','Medicine',38,'kits','Medical store',12),('Blankets','Clothing',75,'pieces','Central depot',25)").run();
  db.prepare("INSERT INTO donations(donor,contact,type,amount,description,target) VALUES ('Guwahati Traders Association','help@gta.example','Money',25000,'Emergency relief fund','All camps'),('Northeast Care Group','9005005001','Food',150,'Meal packs','Beltola High School'),('Asha Pharmacy','9005005002','Medicine',40,'First aid kits','Central depot')").run();
  const request=db.prepare("INSERT INTO emergency_requests(user_id,location,emergency_type,description,people,contact,priority,status) VALUES (?,?,?,?,?,?,?,?)");
  request.run(adminId,'Pandu, Guwahati','Evacuation','Family stranded on first floor.',5,'9006006001','High','Pending');
  db.prepare("INSERT INTO notifications(role,title,message,type,priority) VALUES ('all','Relief operations active','Three relief camps are accepting affected residents.','Camp','Normal'),('admin','Review critical incident','A high-severity flood incident needs assessment.','Incident','High')").run();
  db.prepare("INSERT INTO field_activities(user_id,activity_type,location,description,people_assisted,resources_distributed) VALUES (?,?,?,?,?,?)").run(adminId,'Supply distribution','North Bank','Distributed water and dry food to households.',28,'Water, food packets');
  console.log("✔ Operational demo records created.");
}

db.close();
