(() => {
  const roleTabs = document.getElementById("roleTabs");
  const form = document.getElementById("loginForm");
  const alertBox = document.getElementById("alertBox");
  const submitBtn = document.getElementById("submitBtn");

  let selectedRole = "citizen";

  roleTabs.addEventListener("click", (e) => {
    const tab = e.target.closest(".role-tab");
    if (!tab) return;
    [...roleTabs.children].forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    selectedRole = tab.dataset.role;
  });

  function showAlert(message, type = "error") {
    alertBox.textContent = message;
    alertBox.className = `alert show alert-${type}`;
  }

  function hideAlert() {
    alertBox.className = "alert";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email || !password) {
      showAlert("Please enter both email and password.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role: selectedRole }),
      });
      const data = await res.json();

      if (!res.ok) {
        showAlert(data.error || "Login failed. Please try again.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign in";
        return;
      }

      submitBtn.textContent = "Redirecting…";
      window.location.href = data.redirect;
    } catch (err) {
      showAlert("Could not reach the server. Please try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });
})();
