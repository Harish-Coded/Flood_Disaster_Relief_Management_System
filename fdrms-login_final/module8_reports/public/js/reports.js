// public/js/reports.js
// Module 8: Reports — client-side logic.
// Pulls summary stats, the login audit trail, and the user roster from the
// Module 8 API (guarded server-side to Administrator / Officer roles) and
// renders them into the Reports dashboard.

const ROLE_LABELS = {
  admin: "Administrator",
  officer: "Disaster Management Officer",
  volunteer: "Volunteer",
  citizen: "Citizen",
};

function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtDate(iso) {
  if (!iso) return "—";
  // SQLite datetime('now') is UTC, stored as "YYYY-MM-DD HH:MM:SS"
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return esc(iso);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

async function loadWhoAmI() {
  const res = await fetch("/api/me");
  if (!res.ok) { window.location.href = "/login.html"; return null; }
  const data = await res.json();
  document.getElementById("userName").textContent = data.user.full_name;
  document.getElementById("rolePill").textContent = data.roleLabel;
  document.getElementById("backLink").href = `/dashboard/${data.user.role}.html`;
  return data.user;
}

function renderStatCards(summary) {
  const { users, logins } = summary;
  const successRate = logins.total > 0
    ? Math.round((logins.successful / logins.total) * 100)
    : 0;

  const cards = [
    { num: users.total, lbl: "TOTAL USERS", cls: "" },
    { num: users.active, lbl: "ACTIVE ACCOUNTS", cls: "good" },
    { num: users.inactive, lbl: "DEACTIVATED", cls: users.inactive > 0 ? "warn" : "" },
    { num: logins.total, lbl: "TOTAL LOGIN ATTEMPTS", cls: "" },
    { num: logins.failed, lbl: "FAILED ATTEMPTS", cls: logins.failed > 0 ? "warn" : "good" },
    { num: `${successRate}%`, lbl: "LOGIN SUCCESS RATE", cls: "good" },
  ];
  const ops = summary.operations;
  if (ops) cards.push(
    { num: `${ops.incidents.total} (${ops.incidents.pending || 0} pending)`, lbl: "FLOOD INCIDENTS", cls: ops.incidents.pending ? "warn" : "" },
    { num: ops.victims, lbl: "REGISTERED VICTIMS", cls: "" },
    { num: `${ops.camps.occupancy || 0} / ${ops.camps.capacity || 0}`, lbl: "CAMP OCCUPANCY", cls: "" },
    { num: ops.teams.total, lbl: "RESCUE TEAMS", cls: "" },
    { num: `${ops.resources.lowStock || 0} low / ${ops.resources.total} resources`, lbl: "RESOURCE STOCK", cls: ops.resources.lowStock ? "warn" : "" },
    { num: ops.donations.total, lbl: "DONATIONS", cls: "" },
    { num: `${ops.requests.pending || 0} pending / ${ops.requests.total} total`, lbl: "EMERGENCY REQUESTS", cls: ops.requests.pending ? "warn" : "" },
  );

  document.getElementById("statCards").innerHTML = cards.map((c) => `
    <div class="rep-card ${c.cls}">
      <div class="rep-num">${esc(c.num)}</div>
      <div class="rep-lbl">${esc(c.lbl)}</div>
    </div>
  `).join("");
}

function renderRoleBars(summary) {
  const byRole = summary.users.byRole;
  const max = Math.max(1, ...Object.values(byRole));

  const order = ["admin", "officer", "volunteer", "citizen"];
  document.getElementById("roleBars").innerHTML = order.map((role) => {
    const count = byRole[role] || 0;
    const pct = Math.round((count / max) * 100);
    return `
      <div class="rep-role-row">
        <div class="rep-role-name">${esc(ROLE_LABELS[role])}</div>
        <div class="rep-role-track"><div class="rep-role-fill" style="width:${pct}%"></div></div>
        <div class="rep-role-count">${count}</div>
      </div>
    `;
  }).join("");
}

function renderAuditRows(rows) {
  const tbody = document.getElementById("auditRows");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="rep-empty">No login attempts recorded yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="mono">${fmtDate(r.created_at)}</td>
      <td>${esc(r.full_name) || "—"}</td>
      <td class="mono">${esc(r.email)}</td>
      <td>${esc(ROLE_LABELS[r.role] || "—")}</td>
      <td>${r.success
        ? `<span class="rep-pill ok">Success</span>`
        : `<span class="rep-pill fail">Failed</span>`}</td>
      <td class="mono">${esc(r.ip_address) || "—"}</td>
    </tr>
  `).join("");
}

function renderUserRows(rows) {
  const tbody = document.getElementById("userRows");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="rep-empty">No registered users yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((u) => `
    <tr>
      <td>${esc(u.full_name)}</td>
      <td class="mono">${esc(u.email)}</td>
      <td class="mono">${esc(u.phone) || "—"}</td>
      <td>${esc(ROLE_LABELS[u.role] || "—")}</td>
      <td>${u.is_active
        ? `<span class="rep-pill ok">Active</span>`
        : `<span class="rep-pill inactive">Deactivated</span>`}</td>
      <td class="mono">${fmtDate(u.created_at)}</td>
      <td class="mono">${u.last_login ? fmtDate(u.last_login) : "Never"}</td>
    </tr>
  `).join("");
}

function wireTabs() {
  const tabs = document.querySelectorAll(".rep-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const view = tab.dataset.view;
      document.getElementById("auditView").style.display = view === "audit" ? "" : "none";
      document.getElementById("usersView").style.display = view === "users" ? "" : "none";
    });
  });
}

async function loadReports() {
  try {
    const [summaryRes, auditRes, usersRes] = await Promise.all([
      fetch("/api/reports/summary"),
      fetch("/api/reports/audit?limit=100"),
      fetch("/api/reports/users"),
    ]);

    if (summaryRes.status === 403 || auditRes.status === 403 || usersRes.status === 403) {
      document.querySelector(".rep-body").innerHTML =
        `<div class="rep-empty">You do not have permission to view Reports.</div>`;
      return;
    }
    if (summaryRes.status === 401 || auditRes.status === 401 || usersRes.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    const summary = await summaryRes.json();
    const audit = await auditRes.json();
    const users = await usersRes.json();

    renderStatCards(summary);
    renderRoleBars(summary);
    renderAuditRows(audit.rows);
    renderUserRows(users.rows);
  } catch (err) {
    document.getElementById("statCards").innerHTML =
      `<div class="rep-empty">Could not load reports. Please try again.</div>`;
  }
}

(async () => {
  const user = await loadWhoAmI();
  if (!user) return;
  wireTabs();
  await loadReports();
})();

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
});
