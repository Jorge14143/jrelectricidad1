const registerForm = document.getElementById("registerForm");

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = registerForm.querySelector("button[type='submit']");
  const message = document.getElementById("msg");
  const name = registerForm.elements.name?.value.trim() || "";
  const email = registerForm.elements.email?.value.trim() || "";
  const password = registerForm.elements.password?.value || "";

  if (password.length < 8) {
    if (message) {
      message.textContent = "❌ La contraseña debe tener al menos 8 caracteres.";
      message.className = "notice error";
    }
    return;
  }

  if (message) {
    message.textContent = "Creando cuenta...";
    message.className = "notice";
  }

  if (button) button.disabled = true;

  try {
    await api("/api/register", { name, email, password });

    if (message) {
      message.textContent = "✅ Cuenta creada correctamente. Redirigiendo...";
      message.className = "notice success";
    }

    window.location.href = "/";
  } catch (error) {
    if (message) {
      message.textContent = "❌ " + error.message;
      message.className = "notice error";
    }
  } finally {
    if (button) button.disabled = false;
  }
});
