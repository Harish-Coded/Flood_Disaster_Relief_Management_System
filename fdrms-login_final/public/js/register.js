(() => {
  const roleTabs = document.getElementById("roleTabs");
  const form = document.getElementById("registerForm");
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

    const full_name = document.getElementById("full_name").value.trim();
    const email = document.getElementById("email").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const password = document.getElementById("password").value;
    const confirm_password = document.getElementById("confirm_password").value;

    if (!full_name || !email || !password || !confirm_password) {
      showAlert("Please fill in all required fields.");
      return;
    }
    if (password.length < 8) {
      showAlert("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm_password) {
      showAlert("Passwords do not match.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account…";

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name, email, phone, password, confirm_password, role: selectedRole }),
      });
      const data = await res.json();

      if (!res.ok) {
        showAlert(data.error || "Registration failed. Please try again.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Create account";
        return;
      }

      showAlert("Account created successfully. Redirecting to sign in…", "success");
      setTimeout(() => (window.location.href = "/login.html"), 1400);
    } catch (err) {
      showAlert("Could not reach the server. Please try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Create account";
    }
  });
})();
