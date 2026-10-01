const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { createServer } = require("node:net");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

let dir, dbPath, server, base, port;
const clients = {};

async function freePort() {
  const s = createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const n = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return n;
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "fdrms-qa-"));
  dbPath = path.join(dir, "qa.db");
  const env = { ...process.env, FDRMS_DB_PATH: dbPath };
  const init = spawnSync(process.execPath, ["db/init.js"], { cwd: process.cwd(), env, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["server.js"], { cwd: process.cwd(), env: { ...env, PORT: String(port), HOST: "127.0.0.1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i += 1) {
    try { await fetch(`${base}/api/me`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  assert.equal(server.exitCode, null, "server must stay running");
});

after(async () => {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function client(role) {
  return clients[role] ||= { cookie: "" };
}
async function request(role, route, { method = "GET", body } = {}) {
  const c = role ? client(role) : { cookie: "" };
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(c.cookie ? { cookie: c.cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) c.cookie = setCookie.split(";")[0];
  const text = response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text();
  return { status: response.status, body: text, headers: response.headers };
}
async function login(role, email, password, accountRole = role) {
  const result = await request(role, "/api/login", { method: "POST", body: { email, password, role: accountRole } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result;
}

test("end-to-end operational, security, reports, and backup workflows", async () => {
  let r = await request(null, "/api/dashboard");
  assert.equal(r.status, 401);
  assert.equal(r.body.success, false);
  assert.equal((await request(null, "/api/login", { method: "POST", body: null })).status, 400);
  r = await request("bad", "/api/login", { method: "POST", body: { email: "nobody@example.org", password: "incorrect", role: "citizen" } });
  assert.equal(r.status, 401);
  assert.equal((await request("bad", "/api/me")).status, 401);

  r = await request(null, "/api/register", { method: "POST", body: { full_name: "QA Citizen", email: "qa.citizen@example.org", password: "QaCitizen!23", confirm_password: "QaCitizen!23", role: "citizen" } });
  assert.equal(r.status, 200);
  assert.equal((await request(null, "/api/register", { method: "POST", body: { full_name: "QA Citizen", email: "qa.citizen@example.org", password: "QaCitizen!23", confirm_password: "QaCitizen!23", role: "citizen" } })).status, 409);
  assert.equal((await request(null, "/api/register", { method: "POST", body: { email: "bad", password: "short", role: "admin" } })).status, 400);
  assert.equal((await request(null, "/api/register", { method: "POST", body: { full_name: "No privilege", email: "qa.admin@example.org", password: "QaAdmin!234", confirm_password: "QaAdmin!234", role: "admin" } })).status, 400);

  const citizen = await login("citizen", "qa.citizen@example.org", "QaCitizen!23");
  assert.equal(citizen.body.redirect, "/dashboard/citizen.html");
  assert.equal((await request("citizen", "/api/modules/incidents")).body.rows.length, 0, "citizens only see incidents they submitted");
  const officer = await login("officer", "officer@fdrms.gov.in", "Officer@123");
  assert.equal(officer.body.redirect, "/dashboard/officer.html");
  await login("volunteer", "volunteer@fdrms.gov.in", "Volunteer@123");
  const admin = await login("admin", "admin@fdrms.gov.in", "Admin@123");
  assert.equal((await request("officer", "/dashboard/admin.html")).status, 403);
  assert.equal((await request("citizen", "/dashboard/reports.html")).status, 403);
  assert.equal((await request("citizen", "/dashboard/citizen.html")).status, 200);
  assert.equal((await request("citizen", "/api/login", { method: "POST", body: { email: "qa.citizen@example.org", password: "QaCitizen!23", role: "admin" } })).status, 401);

  // Workflow 1: citizen report, officer review, citizen cannot approve.
  r = await request("citizen", "/api/modules/incidents", { method: "POST", body: { location: "QA flood zone", description: "Rising water", severity: "High", status: "Approved" } });
  assert.equal(r.status, 201); const incidentId = r.body.id;
  assert.equal((await request("citizen", "/api/modules/incidents", { method: "POST", body: { description: "Missing location", severity: "Low" } })).status, 400);
  assert.equal((await request("citizen", `/api/modules/incidents/${incidentId}`, { method: "PATCH", body: { status: "Approved" } })).status, 403);
  r = await request("officer", "/api/modules/incidents");
  assert.ok(r.body.rows.some((row) => row.id === incidentId && row.status === "Pending"), "citizen cannot choose initial incident status");
  assert.equal((await request("officer", `/api/modules/incidents/${incidentId}`, { method: "PATCH", body: { status: "Approved" } })).status, 200);
  assert.equal((await request("officer", `/api/modules/incidents/${incidentId}`, { method: "PATCH", body: { status: "bogus" } })).status, 400);
  assert.equal((await request("officer", "/api/modules/incidents", { method: "POST", body: { location: "bad status", description: "x", severity: "Extreme" } })).status, 400);

  // Workflow 2: emergency request -> team assignment -> volunteer status update.
  r = await request("citizen", "/api/modules/requests", { method: "POST", body: { location: "QA rescue point", emergency_type: "Evacuation", description: "Stranded family", people: 3, priority: "Critical", status: "Resolved" } });
  assert.equal(r.status, 201); const requestId = r.body.id;
  assert.equal((await request("officer", "/api/modules/requests")).body.rows.find((x) => x.id === requestId).status, "Pending", "citizen cannot set privileged request status");
  const team = await request("officer", "/api/modules/teams", { method: "POST", body: { name: "QA rescue team", members: 4 } });
  assert.equal(team.status, 201);
  const lookupDb = new Database(dbPath, { readonly: true });
  const volunteerUser = lookupDb.prepare("SELECT id FROM users WHERE email=?").get("volunteer@fdrms.gov.in").id;
  lookupDb.close();
  r = await request("officer", "/api/assign-team", { method: "POST", body: { team_id: team.body.id, request_id: requestId, volunteer_id: volunteerUser, mission: "Rescue QA family" } });
  assert.equal(r.status, 200);
  assert.equal((await request("citizen", "/api/modules/requests")).body.rows.find((x) => x.id === requestId).status, "Assigned");
  assert.equal((await request("volunteer", "/api/tasks")).body.rows.length, 1);
  const assignedTask = (await request("volunteer", "/api/tasks")).body.rows[0];
  assert.equal((await request("officer", "/api/tasks")).status, 403);
  r = await request("volunteer", `/api/tasks/${assignedTask.id}`, { method: "PATCH", body: { status: "In Progress" } });
  assert.equal(r.status, 200);
  assert.equal((await request("officer", "/api/modules/requests")).body.rows.find((x) => x.id === requestId).status, "In Progress");
  assert.equal((await request("volunteer", `/api/tasks/${assignedTask.id}`, { method: "PATCH", body: { status: "Approved" } })).status, 400);
  assert.equal((await request("volunteer", "/api/tasks/999999", { method: "PATCH", body: { status: "Completed" } })).status, 404);

  // Workflow 3: stock allocation and failure boundaries.
  const resource = await request("officer", "/api/modules/resources", { method: "POST", body: { name: "QA water", category: "Water", quantity: 5, unit: "litres", minimum_stock: 1 } });
  assert.equal(resource.status, 201);
  assert.equal((await request("officer", "/api/modules/resources", { method: "POST", body: { name: "Missing category", quantity: 1 } })).status, 400);
  assert.equal((await request("officer", `/api/modules/resources/${resource.body.id}`, { method: "PATCH", body: { location: "QA depot" } })).status, 200);
  assert.equal((await request("officer", "/api/modules/resources", { method: "POST", body: { name: "Bad quantity", category: "Water", quantity: true } })).status, 400);
  assert.equal((await request("officer", "/api/allocate", { method: "POST", body: { resource_id: resource.body.id, quantity: 3 } })).status, 200);
  assert.equal((await request("officer", "/api/modules/resources")).body.rows.find((x) => x.id === resource.body.id).quantity, 2);
  assert.ok((await request("officer", "/api/allocations")).body.rows.some((x) => x.resource_id === resource.body.id && x.quantity === 3));
  assert.equal((await request("officer", "/api/allocate", { method: "POST", body: { resource_id: resource.body.id, quantity: 3 } })).status, 400);
  assert.equal((await request("officer", "/api/allocate", { method: "POST", body: { resource_id: resource.body.id, quantity: -1 } })).status, 400);
  assert.equal((await request("officer", "/api/allocate", { method: "POST", body: { resource_id: 999999, quantity: 1 } })).status, 400);
  assert.equal((await request("citizen", "/api/allocate", { method: "POST", body: { resource_id: resource.body.id, quantity: 1 } })).status, 403);
  assert.equal((await request("volunteer", "/api/allocate", { method: "POST", body: { resource_id: resource.body.id, quantity: 1 } })).status, 403);

  // Workflow 4: camp assignment and capacity invariants.
  const camp = await request("officer", "/api/modules/camps", { method: "POST", body: { name: "QA one place", location: "QA", capacity: 1 } });
  assert.equal((await request("officer", "/api/modules/camps", { method: "POST", body: { name: "Fractional", location: "QA", capacity: 1.5 } })).status, 400);
  const victim = await request("officer", "/api/modules/victims", { method: "POST", body: { name: "QA victim", family_size: 1 } });
  assert.equal(camp.status, 201); assert.equal(victim.status, 201);
  assert.equal((await request("officer", "/api/assign-victim", { method: "POST", body: { victim_id: victim.body.id, camp_id: camp.body.id } })).status, 200);
  assert.equal((await request("officer", "/api/modules/camps")).body.rows.find((x) => x.id === camp.body.id).occupancy, 1);
  const tooMany = await request("officer", "/api/modules/victims", { method: "POST", body: { name: "QA family", family_size: 2 } });
  assert.equal((await request("officer", "/api/assign-victim", { method: "POST", body: { victim_id: tooMany.body.id, camp_id: camp.body.id } })).status, 400);
  assert.equal((await request("officer", `/api/modules/camps/${camp.body.id}`, { method: "PATCH", body: { capacity: 0 } })).status, 400);
  assert.equal((await request("officer", "/api/modules/victims", { method: "POST", body: { name: "Orphan", camp_id: 999999 } })).status, 400);
  assert.equal((await request("officer", `/api/modules/victims/${victim.body.id}`, { method: "PATCH", body: { camp_id: 999999 } })).status, 400);

  // Donations, notifications, activities and reporting.
  assert.equal((await request("officer", "/api/modules/donations", { method: "POST", body: { donor: "QA donor", type: "Food", amount: 4 } })).status, 201);
  assert.equal((await request("volunteer", "/api/modules/activities", { method: "POST", body: { activity_type: "QA delivery", location: "QA", people_assisted: 2 } })).status, 201);
  assert.ok((await request("officer", "/api/modules/activities")).body.rows.some((x) => x.activity_type === "QA delivery"));
  assert.equal((await request("citizen", "/api/modules/activities", { method: "POST", body: { activity_type: "x", location: "y" } })).status, 403);
  r = await request("officer", "/api/modules/notifications"); assert.equal(r.status, 200);
  const requestNotice = r.body.rows.find((x) => x.title === "Emergency request received");
  assert.ok(requestNotice);
  assert.equal((await request("officer", `/api/notifications/${requestNotice.id}/read`, { method: "POST" })).status, 200);
  assert.equal((await request("officer", "/api/notifications/999999/read", { method: "POST" })).status, 404);
  const publicNotice = (await request("citizen", "/api/modules/notifications")).body.rows.find((x) => x.title === "Relief operations active");
  assert.ok(publicNotice);
  assert.equal((await request("citizen", `/api/notifications/${publicNotice.id}/read`, { method: "POST" })).status, 200);
  assert.equal((await request("citizen", "/api/modules/notifications")).body.rows.find((x) => x.id === publicNotice.id).is_read, 1);
  assert.equal((await request(null, "/api/register", { method: "POST", body: { full_name: "Second QA Citizen", email: "qa.citizen2@example.org", password: "QaCitizen!23", confirm_password: "QaCitizen!23", role: "citizen" } })).status, 200);
  await login("citizen2", "qa.citizen2@example.org", "QaCitizen!23", "citizen");
  assert.equal((await request("citizen2", "/api/modules/notifications")).body.rows.find((x) => x.id === publicNotice.id).is_read, 0, "read receipts are per recipient");
  r = await request("officer", "/api/reports/summary"); assert.equal(r.status, 200);
  assert.equal(r.body.operations.incidents.total >= 4, true);
  assert.equal((await request("volunteer", "/api/reports/summary")).status, 403);
  assert.equal((await request("volunteer", "/api/backup")).status, 403);
  r = await request("admin", "/api/backup"); assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /attachment/);
  assert.ok(r.body.startsWith("SQLite format 3"), "backup should be a readable SQLite database file");
  assert.equal((await request("admin", "/api/reports/users")).status, 200);

  // Explicit role probes and session lifecycle.
  assert.equal((await request("citizen", "/api/modules/victims")).status, 403);
  assert.equal((await request("citizen", "/api/modules/camps")).status, 200);
  assert.equal((await request("citizen", "/api/modules/camps", { method: "POST", body: { name: "Forbidden", location: "QA", capacity: 2 } })).status, 403);
  assert.equal((await request("volunteer", "/api/modules/resources")).status, 403);
  assert.equal((await request("citizen", "/api/assign-team", { method: "POST", body: {} })).status, 403);
  assert.equal((await request("volunteer", "/api/modules/incidents")).status, 403);
  assert.equal((await request("citizen", "/api/allocations")).status, 403);
  assert.equal((await request("citizen", "/api/logout", { method: "POST" })).status, 200);
  assert.equal((await request("citizen", "/api/me")).status, 401);
  assert.equal((await request(null, "/api/allocations")).status, 401);
  assert.equal((await request("admin", "/api/no-such-endpoint")).status, 404);
  const malformed = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);

  const db = new Database(dbPath, { readonly: true });
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal(db.prepare("SELECT quantity FROM resources WHERE id=?").get(resource.body.id).quantity, 2);
  assert.equal(db.prepare("SELECT occupancy FROM relief_camps WHERE id=?").get(camp.body.id).occupancy, 1);
  db.close();
});
