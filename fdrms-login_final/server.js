// server.js
// Module 1: Login & Authentication — Flood Disaster Relief Management System
// Module 9: Reports — Flood Disaster Relief Management System
//
// Implements:
//  - Citizen self-registration
//  - Role-based login (Administrator, Disaster Management Officer, Volunteer, Citizen)
//  - Secure password hashing (bcrypt)
//  - Session-based authentication (express-session, sqlite-backed store)
//  - Login attempt auditing
//  - Role-based redirect to placeholder dashboards
//  - Logout
//  - Reports dashboard (Administrator / Officer only): user & login-audit reporting
//    built on data already captured by Module 1 (users, login_audit tables)

const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const fs = require("fs");

const DB_PATH = process.env.FDRMS_DB_PATH || path.join(__dirname, "db", "fdrms.db");
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
      && (!req.body || typeof req.body !== "object" || Array.isArray(req.body))) {
    return res.status(400).json({ success: false, error: "A JSON object is required." });
  }
  next();
});

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
  if (!req.session.user) return res.status(401).json({ success: false, error: "Authentication required." });
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ success: false, error: "Authentication required." });
    if (req.session.user.role !== role) return res.status(403).json({ success: false, error: "Forbidden." });
    next();
  };
}

// Reports (Module 9) is shared by Administrator and Officer roles only.
function requireAnyRole(roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ success: false, error: "Authentication required." });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ success: false, error: "Forbidden." });
    }
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
  if (typeof full_name !== "string" || typeof email !== "string" || typeof password !== "string" || typeof confirm_password !== "string" || (phone !== undefined && phone !== null && typeof phone !== "string")) {
    return res.status(400).json({ success: false, error: "Registration fields must be text." });
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

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare(`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `);
  try { stmt.run(full_name.trim(), normalizedEmail, phone ? phone.trim() : null, password_hash, role); }
  catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ success: false, error: "An account with this email already exists." });
    throw error;
  }

  return res.json({ success: true, message: "Account created. You can now log in." });
});

// Operational API. Table names and writable columns are fixed here; user input is always bound.
const MODULES = {
 incidents: { table:"flood_incidents", roles:["admin","officer","citizen"], fields:["location","description","severity","people_affected","contact","occurred_at","status","user_id"], required:["location","description","severity"], citizenCreate:true },
 victims: { table:"victims", roles:["admin","officer"], fields:["name","age","gender","phone","address","incident_id","family_size","medical_needs","priority","camp_id","status"], required:["name"] },
 camps: { table:"relief_camps", roles:["admin","officer","citizen"], fields:["name","location","capacity","contact_person","contact_number","facilities","status"], required:["name","location","capacity"] },
 teams: { table:"rescue_teams", roles:["admin","officer"], fields:["name","leader","contact","members","specialization","availability","status"], required:["name"] },
 resources: { table:"resources", roles:["admin","officer"], fields:["name","category","quantity","unit","location","minimum_stock"], required:["name","category","quantity"] },
 donations: { table:"donations", roles:["admin","officer"], fields:["donor","contact","type","amount","description","target","status"], required:["donor","type","amount"] },
 requests: { table:"emergency_requests", roles:["admin","officer","citizen"], fields:["location","emergency_type","description","people","contact","priority","status","user_id"], required:["location","emergency_type","description"], citizenCreate:true },
 activities: { table:"field_activities", roles:["admin","officer","volunteer"], fields:["activity_type","location","description","people_assisted","resources_distributed","user_id"], required:["activity_type","location"], volunteerCreate:true },
 notifications: { table:"notifications", roles:["admin","officer","volunteer","citizen"], fields:["title","message","type","priority","is_read","role","user_id"], required:["title","message"] }
};
const ENUMS = {
 incidents: { severity:["Low","Medium","High","Critical"], status:["Pending","Approved","Rejected","In Progress","Resolved"] },
 victims: { priority:["Low","Medium","High","Critical"], status:["Registered","Awaiting Rescue","Rescued","At Relief Camp","Rehabilitated"] },
 camps: { status:["Active","Full","Closed"] },
 teams: { availability:["Available","Assigned","On Mission","Completed","Unavailable"], status:["Available","Assigned","On Mission","Completed","Unavailable"] },
 requests: { priority:["Low","Medium","High","Critical"], status:["Pending","Assigned","In Progress","Resolved","Cancelled"] },
 donations: { type:["Money","Food","Medicine","Clothing","Other"] }
};
const NUMERIC_FIELDS = new Set(["people_affected","people","age","family_size","members","capacity","quantity","minimum_stock","amount","people_assisted"]);
const INTEGER_FIELDS = new Set(["people_affected","people","age","family_size","members","capacity","people_assisted"]);
function validateModuleInput(key, body, { isCitizen = false } = {}) {
  const allowed = ENUMS[key] || {};
  for (const [field, values] of Object.entries(allowed)) {
    if (body[field] !== undefined && !values.includes(body[field])) return `${field} is invalid.`;
  }
  for (const field of Object.keys(body)) {
    if (!NUMERIC_FIELDS.has(field) || body[field] === undefined) continue;
    if (!(["number", "string"].includes(typeof body[field])) || (typeof body[field] === "string" && body[field].trim() === "")) return `${field} must be a valid non-negative number.`;
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0 || (INTEGER_FIELDS.has(field) && !Number.isInteger(value)) || (field === "capacity" && value === 0)) return `${field} must be a valid non-negative number.`;
  }
  if (isCitizen && Object.hasOwn(body, "status")) body.status = "Pending";
  return null;
}
function alertUsers(title, message, role="all", userId=null, type="Info", priority="Normal") {
  db.prepare("INSERT INTO notifications(user_id,role,title,message,type,priority) VALUES(?,?,?,?,?,?)").run(userId, role, title, message, type, priority);
}
app.get("/api/dashboard", requireAuth, (req,res) => {
 const count=(t,where="1=1")=>db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${where}`).get().n;
 const role=req.session.user.role;
 const unread=db.prepare("SELECT COUNT(*) n FROM notifications n WHERE (n.role='all' OR n.role=? OR n.user_id=?) AND n.is_read=0 AND NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id=n.id AND nr.user_id=?)").get(role,req.session.user.id,req.session.user.id).n;
 res.json({role, stats:{incidents:count("flood_incidents"),pendingIncidents:count("flood_incidents","status='Pending'"),victims:count("victims"),camps:count("relief_camps"),teams:count("rescue_teams"),lowStock:count("resources","quantity<=minimum_stock"),donations:count("donations"),requests:count("emergency_requests",role==="citizen"?`user_id=${Number(req.session.user.id)}`:"status='Pending'"),activities:count("field_activities",role==="volunteer"?`user_id=${Number(req.session.user.id)}`:"1=1"),notifications:unread}});
});
app.get("/api/modules/:module", requireAuth, (req,res)=>{
 const cfg=MODULES[req.params.module]; if(!cfg)return res.status(404).json({success:false,error:"Unknown module."});
 if(!cfg.roles.includes(req.session.user.role))return res.status(403).json({success:false,error:"Forbidden."});
 let rows;
 if(req.params.module==="incidents"&&req.session.user.role==="citizen") rows=db.prepare("SELECT * FROM flood_incidents WHERE user_id=? ORDER BY id DESC").all(req.session.user.id);
 else if(req.params.module==="requests"&&req.session.user.role==="citizen") rows=db.prepare("SELECT * FROM emergency_requests WHERE user_id=? ORDER BY id DESC").all(req.session.user.id);
 else if(req.params.module==="activities"&&req.session.user.role==="volunteer") rows=db.prepare("SELECT * FROM field_activities WHERE user_id=? ORDER BY id DESC").all(req.session.user.id);
 else if(req.params.module==="notifications") rows=db.prepare("SELECT n.*,CASE WHEN nr.user_id IS NOT NULL THEN 1 ELSE n.is_read END AS is_read FROM notifications n LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=? WHERE n.role='all' OR n.role=? OR n.user_id=? ORDER BY n.id DESC").all(req.session.user.id,req.session.user.role,req.session.user.id);
 else rows=db.prepare(`SELECT * FROM ${cfg.table} ORDER BY id DESC`).all(); res.json({rows});
});
app.post("/api/modules/:module", requireAuth,(req,res)=>{
 const key=req.params.module,cfg=MODULES[key],role=req.session.user.role;if(!cfg)return res.status(404).json({success:false,error:"Unknown module."});
 if(!cfg.roles.includes(role)||(!cfg.citizenCreate&&role==="citizen")||(!cfg.volunteerCreate&&role==="volunteer"))return res.status(403).json({success:false,error:"Forbidden."});
 const body={...req.body}; if(cfg.citizenCreate)body.user_id=req.session.user.id;if(cfg.volunteerCreate)body.user_id=req.session.user.id;
 for(const f of cfg.required)if(body[f]===undefined||String(body[f]).trim()==="")return res.status(400).json({success:false,error:`${f} is required.`});
 try {
  const validationError=validateModuleInput(key,body,{isCitizen:role==="citizen"});if(validationError)return res.status(400).json({success:false,error:validationError});
  const cols=cfg.fields.filter(f=>body[f]!==undefined), values=cols.map(f=>body[f]);
  const result=db.prepare(`INSERT INTO ${cfg.table} (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")})`).run(...values);
  if(key==="incidents")alertUsers("New flood incident",`Incident reported at ${body.location}.`,"admin",null,"Incident",body.severity);
  if(key==="requests")alertUsers("Emergency request received",`Help requested at ${body.location}.`,"officer",null,"Emergency",body.priority);
  res.status(201).json({success:true,id:result.lastInsertRowid,message:"Record created."});
 }catch(e){res.status(400).json({success:false,error:e.message.includes("UNIQUE")?"A duplicate record exists.":"Could not save this record."});}
});
app.patch("/api/modules/:module/:id",requireAuth,(req,res)=>{
 const key=req.params.module,cfg=MODULES[key],role=req.session.user.role;if(!cfg)return res.status(404).json({success:false,error:"Unknown module."});
 if(!["admin","officer"].includes(role)||!cfg.roles.includes(role))return res.status(403).json({success:false,error:"Forbidden."});
 if(key==="victims"&&req.body.camp_id!==undefined)return res.status(400).json({success:false,error:"Use the camp assignment operation to change a victim's camp."});
 const cols=cfg.fields.filter(f=>req.body[f]!==undefined);if(!cols.length)return res.status(400).json({success:false,error:"No valid fields supplied."});
 const validationError=validateModuleInput(key,req.body);if(validationError)return res.status(400).json({success:false,error:validationError});
 if(!/^\d+$/.test(String(req.params.id)))return res.status(404).json({success:false,error:"Record not found."});
 try{
  if(key==="camps"&&req.body.capacity!==undefined){const current=db.prepare("SELECT occupancy FROM relief_camps WHERE id=?").get(req.params.id);if(current&&Number(req.body.capacity)<current.occupancy)return res.status(400).json({success:false,error:"Capacity cannot be lower than current occupancy."});}
  const r=db.prepare(`UPDATE ${cfg.table} SET ${cols.map(f=>`${f}=?`).join(",")}${["incidents","victims","camps","teams","requests"].includes(key)?", updated_at=datetime('now')":""} WHERE id=?`).run(...cols.map(f=>req.body[f]),req.params.id);if(!r.changes)return res.status(404).json({success:false,error:"Record not found."});res.json({success:true,message:"Record updated."});}catch(e){res.status(400).json({success:false,error:e.code?.startsWith("SQLITE_CONSTRAINT_FOREIGNKEY")?"Referenced record does not exist.":"Invalid record update."});}
});
app.post("/api/allocate",requireAuth,(req,res)=>{
 if(!["admin","officer"].includes(req.session.user.role))return res.status(403).json({success:false,error:"Forbidden."});
 const {resource_id,camp_id,quantity,purpose}=req.body; if(!resource_id||!quantity||Number(quantity)<=0)return res.status(400).json({success:false,error:"Resource and positive quantity are required."});
 try{const tx=db.transaction(()=>{const r=db.prepare("SELECT * FROM resources WHERE id=?").get(resource_id);if(!r)throw Error("Resource not found.");if(Number(quantity)>r.quantity)throw Error("Allocation exceeds available stock.");db.prepare("UPDATE resources SET quantity=quantity-?,updated_at=datetime('now') WHERE id=?").run(quantity,resource_id);db.prepare("INSERT INTO resource_allocations(resource_id,camp_id,quantity,purpose,allocated_by) VALUES(?,?,?,?,?)").run(resource_id,camp_id||null,quantity,purpose||null,req.session.user.id);if(r.quantity-quantity<=r.minimum_stock)alertUsers("Low resource stock",`${r.name} is at or below minimum stock.`,"admin",null,"Stock","High");});tx();res.json({success:true,message:"Resource allocated."});}catch(e){res.status(400).json({success:false,error:e.message});}
});
app.get("/api/allocations",requireAnyRole(["admin","officer"]),(req,res)=>res.json({rows:db.prepare("SELECT a.*,r.name resource,c.name camp FROM resource_allocations a JOIN resources r ON r.id=a.resource_id LEFT JOIN relief_camps c ON c.id=a.camp_id ORDER BY a.id DESC").all()}));
app.post("/api/assign-victim",requireAnyRole(["admin","officer"]),(req,res)=>{
 const {victim_id,camp_id}=req.body;
 try{const tx=db.transaction(()=>{const v=db.prepare("SELECT * FROM victims WHERE id=?").get(victim_id),c=db.prepare("SELECT * FROM relief_camps WHERE id=?").get(camp_id);if(!v||!c)throw Error("Victim or camp not found.");if(v.camp_id===c.id)return;if(c.status==="Closed"||c.occupancy>=c.capacity)throw Error("The selected camp has no available space.");if(v.camp_id)db.prepare("UPDATE relief_camps SET occupancy=MAX(0,occupancy-?) WHERE id=?").run(v.family_size,v.camp_id);db.prepare("UPDATE relief_camps SET occupancy=occupancy+?,status=CASE WHEN occupancy+?>=capacity THEN 'Full' ELSE 'Active' END,updated_at=datetime('now') WHERE id=?").run(v.family_size,v.family_size,c.id);const updated=db.prepare("SELECT occupancy FROM relief_camps WHERE id=?").get(c.id);if(updated.occupancy>c.capacity)throw Error("Camp capacity would be exceeded.");db.prepare("UPDATE victims SET camp_id=?,status='At Relief Camp',updated_at=datetime('now') WHERE id=?").run(c.id,v.id);});tx();res.json({success:true,message:"Victim assigned to camp."});}catch(e){res.status(400).json({success:false,error:e.message});}
});
app.post("/api/assign-team",requireAuth,(req,res)=>{
 if(!["admin","officer"].includes(req.session.user.role))return res.status(403).json({success:false,error:"Forbidden."});const {team_id,incident_id,request_id,volunteer_id,mission}=req.body;
 if(!team_id||!mission||(!incident_id&&!request_id))return res.status(400).json({success:false,error:"Team, mission and an incident or request are required."});
 try{const tx=db.transaction(()=>{const t=db.prepare("SELECT id,status FROM rescue_teams WHERE id=?").get(team_id);if(!t)throw Error("Team not found.");if(t.status!=="Available")throw Error("Rescue team is not available.");if(incident_id&&!db.prepare("SELECT id FROM flood_incidents WHERE id=?").get(incident_id))throw Error("Incident not found.");if(request_id&&!db.prepare("SELECT id FROM emergency_requests WHERE id=?").get(request_id))throw Error("Emergency request not found.");if(volunteer_id&&!db.prepare("SELECT id FROM users WHERE id=? AND role='volunteer' AND is_active=1").get(volunteer_id))throw Error("Volunteer not found.");db.prepare("INSERT INTO rescue_assignments(team_id,incident_id,request_id,volunteer_id,mission) VALUES(?,?,?,?,?)").run(team_id,incident_id||null,request_id||null,volunteer_id||null,mission);db.prepare("UPDATE rescue_teams SET status='Assigned',availability='Assigned',updated_at=datetime('now') WHERE id=?").run(team_id);if(request_id)db.prepare("UPDATE emergency_requests SET status='Assigned',team_id=?,updated_at=datetime('now') WHERE id=?").run(team_id,request_id);if(volunteer_id)alertUsers("Rescue task assigned",mission,null,volunteer_id,"Rescue","High");});tx();res.json({success:true,message:"Team assigned."});}catch(e){res.status(400).json({success:false,error:e.message});}
});
app.get("/api/tasks",requireAuth,(req,res)=>{
 if(req.session.user.role!=="volunteer")return res.status(403).json({success:false,error:"Forbidden."});
 const rows=db.prepare("SELECT a.*,t.name team_name,i.location incident_location,r.location request_location FROM rescue_assignments a JOIN rescue_teams t ON t.id=a.team_id LEFT JOIN flood_incidents i ON i.id=a.incident_id LEFT JOIN emergency_requests r ON r.id=a.request_id WHERE a.volunteer_id=? ORDER BY a.id DESC").all(req.session.user.id);res.json({rows});
});
app.patch("/api/tasks/:id",requireAuth,(req,res)=>{
 if(req.session.user.role!=="volunteer")return res.status(403).json({success:false,error:"Forbidden."});
 const {status}=req.body;if(!["Assigned","In Progress","Completed"].includes(status))return res.status(400).json({success:false,error:"Invalid task status."});
 const tx=db.transaction(()=>{const a=db.prepare("SELECT team_id,request_id FROM rescue_assignments WHERE id=? AND volunteer_id=?").get(req.params.id,req.session.user.id);if(!a)return false;db.prepare("UPDATE rescue_assignments SET status=?,completed_at=CASE WHEN ?='Completed' THEN datetime('now') ELSE completed_at END WHERE id=?").run(status,status,req.params.id);db.prepare("UPDATE rescue_teams SET status=?,availability=?,updated_at=datetime('now') WHERE id=?").run(status,status,a.team_id);if(a.request_id)db.prepare("UPDATE emergency_requests SET status=?,updated_at=datetime('now') WHERE id=?").run(status==='Completed'?'Resolved':status==='In Progress'?'In Progress':'Assigned',a.request_id);return true;});
 try{if(!tx())return res.status(404).json({success:false,error:"Task not found."});res.json({success:true,message:"Task status updated."});}catch(e){res.status(400).json({success:false,error:"Could not update task."});}
});
app.post("/api/notifications/:id/read",requireAuth,(req,res)=>{if(!/^\d+$/.test(String(req.params.id)))return res.status(404).json({success:false,error:"Notification not found."});const n=db.prepare("SELECT id FROM notifications WHERE id=? AND (user_id=? OR role IN ('all',?))").get(req.params.id,req.session.user.id,req.session.user.role);if(!n)return res.status(404).json({success:false,error:"Notification not found."});db.prepare("INSERT OR IGNORE INTO notification_reads(notification_id,user_id) VALUES(?,?)").run(req.params.id,req.session.user.id);res.json({success:true});});
app.get("/api/backup",requireRole("admin"),async(req,res)=>{try{const file=path.join(__dirname,"db",`fdrms-backup-${Date.now()}.db`);await db.backup(file);res.download(file,"fdrms-backup.db",()=>fs.unlink(file,()=>{}));}catch(e){res.status(500).json({success:false,error:"Backup could not be created."});}});

// ---------- API: login ----------

app.post("/api/login", (req, res) => {
  const { email, password, role } = req.body;
  const ip = req.ip;

  if (!email || !password || !role) {
    return res.status(400).json({ error: "Email, password, and role are required." });
  }
  if (typeof email !== "string" || typeof password !== "string" || typeof role !== "string") {
    return res.status(400).json({ success: false, error: "Email, password, and role must be text." });
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

// ---------- API: reports (Module 9) — Administrator / Officer only ----------

// Summary counts: users by role, active/inactive, and login success/failure totals.
app.get("/api/reports/summary", requireAnyRole(["admin", "officer"]), (req, res) => {
  const byRole = db
    .prepare(`SELECT role, COUNT(*) AS count FROM users GROUP BY role`)
    .all();

  const activeInactive = db
    .prepare(`
      SELECT
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive,
        COUNT(*) AS total
      FROM users
    `)
    .get();

  const loginTotals = db
    .prepare(`
      SELECT
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successful,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
        COUNT(*) AS total
      FROM login_audit
    `)
    .get();

  const roleCounts = { admin: 0, officer: 0, volunteer: 0, citizen: 0 };
  byRole.forEach((r) => { roleCounts[r.role] = r.count; });

  res.json({
    users: {
      total: activeInactive.total || 0,
      active: activeInactive.active || 0,
      inactive: activeInactive.inactive || 0,
      byRole: roleCounts,
    },
    logins: {
      total: loginTotals.total || 0,
      successful: loginTotals.successful || 0,
      failed: loginTotals.failed || 0,
    },
    operations: {
      incidents: db.prepare("SELECT COUNT(*) total, SUM(status='Pending') pending, SUM(severity='Critical') critical FROM flood_incidents").get(),
      victims: db.prepare("SELECT COUNT(*) total FROM victims").get().total,
      camps: db.prepare("SELECT COUNT(*) total, SUM(capacity) capacity, SUM(occupancy) occupancy FROM relief_camps").get(),
      teams: db.prepare("SELECT COUNT(*) total, SUM(status='On Mission') onMission FROM rescue_teams").get(),
      resources: db.prepare("SELECT COUNT(*) total, SUM(quantity<=minimum_stock) lowStock FROM resources").get(),
      donations: db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN type='Money' THEN amount ELSE 0 END) money FROM donations").get(),
      requests: db.prepare("SELECT COUNT(*) total, SUM(status='Pending') pending FROM emergency_requests").get(),
    },
  });
});

// Recent login audit trail, most recent first.
app.get("/api/reports/audit", requireAnyRole(["admin", "officer"]), (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 200) limit = 200;

  const rows = db
    .prepare(`
      SELECT
        la.id,
        la.email_tried AS email,
        la.success,
        la.ip_address,
        la.created_at,
        u.full_name,
        u.role
      FROM login_audit la
      LEFT JOIN users u ON u.id = la.user_id
      ORDER BY la.created_at DESC, la.id DESC
      LIMIT ?
    `)
    .all(limit);

  res.json({ rows });
});

// Full user roster (no password data) — for the Reports "Users" table.
app.get("/api/reports/users", requireAnyRole(["admin", "officer"]), (req, res) => {
  const rows = db
    .prepare(`
      SELECT id, full_name, email, phone, role, is_active, created_at, last_login
      FROM users
      ORDER BY created_at DESC
    `)
    .all();

  res.json({ rows });
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

app.get(
  "/dashboard/reports.html",
  requireAnyRole(["admin", "officer"]),
  (req, res) => res.sendFile(path.join(__dirname, "views", "reports.html"))
);

app.get("/", (req, res) => res.redirect("/login.html"));

app.use("/api", (req, res) => res.status(404).json({ success: false, error: "API endpoint not found." }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  res.status(status).json({ success: false, error: status === 400 ? "Invalid request body." : "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`\n  FDRMS Login Module running → http://localhost:${PORT}\n`);
});
