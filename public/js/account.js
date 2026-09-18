"use strict";

async function loadAccount() {
  const message = document.getElementById("account-message");
  const dataBox = document.getElementById("account-data");
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    if (!response.ok) { window.location.href = "/login.html"; return; }
    const data = await response.json();
    if (!data.user) { window.location.href = "/login.html"; return; }
    const user = data.user;

    document.getElementById("account-name").textContent = user.name || "-";
    document.getElementById("account-email").textContent = user.email || "-";
    document.getElementById("account-role").textContent = user.role === "admin" ? "Administrador" : "Usuario";
    document.getElementById("profile-name").value = user.name || "";
    document.getElementById("profile-email").value = user.email || "";

    if (user.role === "admin") document.getElementById("admin-link").style.display = "inline-block";
    if (message) message.style.display = "none";
    if (dataBox) dataBox.style.display = "grid";
  } catch (error) {
    console.error(error);
    if (message) message.textContent = "No se pudo cargar la información.";
  }
}

const profileForm = document.getElementById("profile-form");
profileForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("profile-message");
  const button = profileForm.querySelector("button[type=submit]");
  const name = document.getElementById("profile-name").value.trim();
  const email = document.getElementById("profile-email").value.trim();
  if (!name || !email) { message.textContent = "Completá nombre y email."; return; }
  if (button) button.disabled = true;
  message.textContent = "Guardando...";
  try {
    const response = await fetch("/api/account/profile", {
      method: "PUT", headers: {"Content-Type":"application/json"}, credentials:"same-origin",
      body: JSON.stringify({name,email})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudieron actualizar los datos.");
    document.getElementById("account-name").textContent = data.user.name;
    document.getElementById("account-email").textContent = data.user.email;
    message.textContent = "✅ Datos personales actualizados correctamente.";
  } catch(error) { message.textContent = "❌ " + error.message; }
  finally { if (button) button.disabled = false; }
});

const emailForm = document.getElementById("email-form");
emailForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const newEmail = document.getElementById("new-email").value.trim();
  const currentPassword = document.getElementById("email-current-password").value;
  const message = document.getElementById("email-message");
  message.textContent = "Actualizando...";
  try {
    const response = await fetch("/api/account/email", {method:"PUT",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({newEmail,currentPassword})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo cambiar el correo.");
    document.getElementById("account-email").textContent = data.user.email;
    document.getElementById("profile-email").value = data.user.email;
    emailForm.reset();
    message.textContent = "✅ Correo actualizado correctamente.";
  } catch(error) { message.textContent = "❌ " + error.message; }
});

const passwordForm = document.getElementById("password-form");
passwordForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const currentPassword = document.getElementById("current-password").value;
  const newPassword = document.getElementById("new-password").value;
  const confirmPassword = document.getElementById("confirm-password").value;
  const message = document.getElementById("password-message");
  if (newPassword.length < 8) { message.textContent = "❌ La nueva contraseña debe tener al menos 8 caracteres."; return; }
  if (newPassword !== confirmPassword) { message.textContent = "❌ Las nuevas contraseñas no coinciden."; return; }
  message.textContent = "Actualizando...";
  try {
    const response = await fetch("/api/account/password", {method:"PUT",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({currentPassword,newPassword})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo cambiar la contraseña.");
    passwordForm.reset();
    message.textContent = "✅ Contraseña actualizada correctamente. Las demás sesiones fueron cerradas.";
  } catch(error) { message.textContent = "❌ " + error.message; }
});

loadAccount();
