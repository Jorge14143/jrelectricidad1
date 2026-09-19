"use strict";

function setMessage(id, text, ok = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "account-form-message" + (ok ? " success" : "");
}

function renderUser(user) {
  document.getElementById("account-name").textContent = user.name || "-";
  document.getElementById("account-email").textContent = user.email || "-";
  document.getElementById("account-role").textContent =
    user.role === "admin" ? "Administrador" : "Usuario";

  const name = document.getElementById("profile-name");
  if (name) name.value = user.name || "";

  const avatar = document.getElementById("avatar-url");
  if (avatar) avatar.value = user.avatar_url || "";

  const preview = document.getElementById("avatar-preview");
  if (preview) {
    preview.src = user.avatar_url || "";
    preview.style.display = user.avatar_url ? "block" : "none";
  }

  const status = document.getElementById("email-status");
  if (status) {
    status.textContent = user.email_verified
      ? "✅ Correo confirmado"
      : "⚠️ Correo sin confirmar";
  }

  if (user.pending_email) {
    const pending = document.getElementById("pending-email");
    if (pending) pending.textContent = "Pendiente de confirmación: " + user.pending_email;
  }

  if (user.role === "admin") {
    const admin = document.getElementById("admin-link");
    if (admin) admin.style.display = "inline-block";
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? {"Content-Type": "application/json"} : {}),
      ...(options.headers || {})
    }
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}

async function loadAccount() {
  try {
    const data = await api("/api/me");
    if (!data.user) {
      window.location.href = "/login.html";
      return;
    }
    renderUser(data.user);
    document.getElementById("account-message").style.display = "none";
    document.getElementById("account-data").style.display = "grid";
    await Promise.all([loadEmailStatus(), loadActivity()]);
  } catch (error) {
    console.error(error);
    setMessage("account-message", error.message);
  }
}

async function loadEmailStatus() {
  try {
    const data = await api("/api/account/email/status");
    const status = document.getElementById("email-status");
    const pending = document.getElementById("pending-email");
    const resend = document.getElementById("verify-email-button");

    if (status) status.textContent = data.verified ? "✅ Correo confirmado" : "⚠️ Correo sin confirmar";
    if (pending) pending.textContent = data.pending_email
      ? "Pendiente de confirmación: " + data.pending_email
      : "";
    if (resend) resend.style.display = data.verified ? "none" : "inline-block";
  } catch (error) {
    setMessage("email-message", error.message);
  }
}

async function loadActivity() {
  const box = document.getElementById("activity-list");
  if (!box) return;
  try {
    const data = await api("/api/account/activity?limit=30");
    box.innerHTML = "";
    if (!data.activity?.length) {
      box.textContent = "Todavía no hay actividad registrada.";
      return;
    }

    for (const item of data.activity) {
      const row = document.createElement("div");
      row.className = "account-field";
      const date = item.created_at
        ? new Date(item.created_at).toLocaleString("es-AR")
        : "";
      row.innerHTML = "<span>•</span><div><strong></strong><small></small></div>";
      row.querySelector("strong").textContent = item.action || "Actividad";
      row.querySelector("small").textContent = date;
      box.appendChild(row);
    }
  } catch (error) {
    box.textContent = "No se pudo cargar el historial.";
  }
}

document.getElementById("profile-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const name = document.getElementById("profile-name").value.trim();

  if (!name) {
    setMessage("profile-message", "El nombre es obligatorio.");
    return;
  }

  button.disabled = true;
  setMessage("profile-message", "Guardando...");
  try {
    const data = await api("/api/account/profile", {
      method: "PUT",
      body: JSON.stringify({ name })
    });
    renderUser(data.user);
    setMessage("profile-message", "✅ Datos personales actualizados.", true);
    await loadActivity();
  } catch (error) {
    setMessage("profile-message", "❌ " + error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("email-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const newEmail = document.getElementById("new-email").value.trim();
  const currentPassword = document.getElementById("email-current-password").value;

  button.disabled = true;
  setMessage("email-message", "Enviando confirmación...");
  try {
    const data = await api("/api/account/email", {
      method: "PUT",
      body: JSON.stringify({ newEmail, currentPassword })
    });
    form.reset();
    setMessage("email-message", "✅ " + data.message, true);
    await loadEmailStatus();
    await loadActivity();
  } catch (error) {
    setMessage("email-message", "❌ " + error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("verify-email-button")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setMessage("email-message", "Enviando correo...");
  try {
    const data = await api("/api/account/email/verify/request", {
      method: "POST",
      body: JSON.stringify({})
    });
    setMessage("email-message", "✅ " + data.message, true);
    await loadEmailStatus();
  } catch (error) {
    setMessage("email-message", "❌ " + error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("avatar-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const avatar_url = document.getElementById("avatar-url").value.trim();

  button.disabled = true;
  setMessage("avatar-message", "Guardando...");
  try {
    const data = await api("/api/account/avatar", {
      method: "PUT",
      body: JSON.stringify({ avatar_url })
    });
    renderUser(data.user);
    setMessage("avatar-message", "✅ " + data.message, true);
    await loadActivity();
  } catch (error) {
    setMessage("avatar-message", "❌ " + error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("password-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const currentPassword = document.getElementById("current-password").value;
  const newPassword = document.getElementById("new-password").value;
  const confirmPassword = document.getElementById("confirm-password").value;

  if (newPassword.length < 12) {
    setMessage("password-message", "❌ La nueva contraseña debe tener al menos 12 caracteres.");
    return;
  }
  if (newPassword !== confirmPassword) {
    setMessage("password-message", "❌ Las nuevas contraseñas no coinciden.");
    return;
  }

  button.disabled = true;
  setMessage("password-message", "Actualizando...");
  try {
    const data = await api("/api/account/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword })
    });
    form.reset();
    setMessage("password-message", "✅ " + data.message, true);
    await loadActivity();
  } catch (error) {
    setMessage("password-message", "❌ " + error.message);
  } finally {
    button.disabled = false;
  }
});

loadAccount();
