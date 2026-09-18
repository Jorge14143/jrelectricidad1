const loginForm = document.getElementById("loginForm");

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = loginForm.querySelector("button[type='submit']");
  const message = document.getElementById("msg");
  const email = loginForm.elements.email?.value.trim() || "";
  const password = loginForm.elements.password?.value || "";

  if (message) {
    message.textContent = "Ingresando...";
    message.className = "notice";
  }

  if (button) button.disabled = true;

  try {
    const data = await api("/api/login", { email, password });

    if (message) {
      message.textContent = "✅ Sesión iniciada correctamente.";
      message.className = "notice success";
    }

    const redirect = data.user?.role === "admin" ? "/admin" : "/";
    window.location.href = redirect;
  } catch (error) {
    if (message) {
      message.textContent = "❌ " + error.message;
      message.className = "notice error";
    }
  } finally {
    if (button) button.disabled = false;
  }
});
