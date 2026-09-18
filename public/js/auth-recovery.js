"use strict";

const messageBox = document.getElementById("msg");

function showAuthMessage(message, type = "") {
  if (!messageBox) return;
  messageBox.textContent = message;
  messageBox.className = type ? `notice ${type}` : "notice";
}

const forgotForm = document.getElementById("forgotForm");

forgotForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const button = forgotForm.querySelector("button[type='submit']");
  const email = forgotForm.elements.email?.value.trim() || "";

  showAuthMessage("Procesando solicitud...");
  if (button) button.disabled = true;

  try {
    const data = await api("/api/forgot-password", { email });
    showAuthMessage("✅ " + data.message, "success");
    forgotForm.reset();
  } catch (error) {
    showAuthMessage("❌ " + error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
});

const resetForm = document.getElementById("resetForm");

resetForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const button = resetForm.querySelector("button[type='submit']");
  const password = resetForm.elements.password?.value || "";
  const password2 = resetForm.elements.password2?.value || "";
  const token = new URLSearchParams(window.location.search).get("token");

  if (!token) {
    showAuthMessage("❌ El enlace de recuperación no es válido.", "error");
    return;
  }

  if (password.length < 8) {
    showAuthMessage("❌ La contraseña debe tener al menos 8 caracteres.", "error");
    return;
  }

  if (password !== password2) {
    showAuthMessage("❌ Las contraseñas no coinciden.", "error");
    return;
  }

  showAuthMessage("Actualizando contraseña...");
  if (button) button.disabled = true;

  try {
    const data = await api("/api/reset-password", { token, password });
    showAuthMessage("✅ " + data.message, "success");
    resetForm.reset();

    window.setTimeout(() => {
      window.location.href = "/login.html";
    }, 1200);
  } catch (error) {
    showAuthMessage("❌ " + error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
});
