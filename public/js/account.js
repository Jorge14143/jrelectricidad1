"use strict";

function accountMoney(value) {
  return "$ " + Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function accountDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toLocaleDateString("es-AR");
}
function accountStatus(value) {
  const map = { pendiente:"Pendiente", contactado:"Contactado", presupuestado:"Presupuestado", cerrado:"Cerrado", borrador:"Borrador", enviado:"Enviado", aceptado:"Aceptado", rechazado:"Rechazado", vencido:"Vencido", en_proceso:"En proceso", pendiente_presupuesto:"Pendiente de presupuesto", presupuesto_enviado:"Presupuesto enviado", emitida:"Emitida", parcial:"Pago parcial", pagada:"Pagada", anulada:"Anulada" };
  return map[value] || value || "—";
}
function accountEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, function(c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
  });
}

async function loadAccountDashboard() {
  try {
    const response = await fetch("/api/account/dashboard", { credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo cargar el historial.");

    const s = data.summary || {};
    document.getElementById("stat-requests").textContent = s.requests ?? 0;
    document.getElementById("stat-quotes").textContent = s.quotes ?? 0;
    document.getElementById("stat-active-jobs").textContent = s.activeJobs ?? 0;
    document.getElementById("stat-balance").textContent = accountMoney(s.pendingBalance);

    const requests = data.requests || [];
    document.getElementById("account-requests-list").innerHTML = requests.length
      ? requests.map(function(x) {
          return '<article class="account-record"><div><strong>' + accountEscape(x.service || "Solicitud de servicio") + '</strong><p>' + accountEscape(x.description || "") + '</p></div><div class="account-record-meta"><span>' + accountStatus(x.status) + '</span><small>' + accountDate(x.created_at) + '</small></div></article>';
        }).join("")
      : '<div class="account-empty">Todavía no tenés solicitudes registradas.</div>';

    const quotes = data.quotes || [];
    document.getElementById("account-quotes-list").innerHTML = quotes.length
      ? quotes.map(function(x) {
          return '<article class="account-record account-record-quote"><div><strong>' + accountEscape(x.quote_number || "Presupuesto") + '</strong><p>' + accountEscape(x.service || "Servicio") + ' · Emitido ' + accountDate(x.issue_date) + '</p></div><div class="account-record-price"><strong>' + accountMoney(x.total) + '</strong><span class="account-status">' + accountStatus(x.status) + '</span></div></article>';
        }).join("")
      : '<div class="account-empty">Todavía no se emitieron presupuestos para tu cuenta.</div>';

    const jobs = data.jobs || [];
    document.getElementById("account-jobs-list").innerHTML = jobs.length
      ? jobs.map(function(x) {
          const when = x.completed_at ? "Finalizado " + accountDate(x.completed_at) : x.started_at ? "Iniciado " + accountDate(x.started_at) : "Sin iniciar";
          return '<article class="account-record"><div><strong>' + accountEscape(x.service || "Trabajo") + '</strong><p>Presupuesto ' + accountEscape(x.quote_number || "—") + '</p></div><div class="account-record-meta"><span>' + accountStatus(x.status) + '</span><small>' + when + '</small></div></article>';
        }).join("")
      : '<div class="account-empty">Todavía no tenés trabajos registrados.</div>';

    const invoices = data.invoices || [];
    document.getElementById("account-invoices-list").innerHTML = invoices.length
      ? invoices.map(function(x) {
          const pending = Math.max(0, Number(x.total || 0) - Number(x.paid_amount || 0));
          return '<article class="account-record"><div><strong>' + accountEscape(x.invoice_number || "Factura") + '</strong><p>Presupuesto ' + accountEscape(x.quote_number || "—") + ' · ' + accountDate(x.issue_date) + '</p></div><div class="account-record-price"><strong>' + accountMoney(x.total) + '</strong><span>' + (pending > 0 ? "Pendiente " + accountMoney(pending) : "Pagada") + '</span></div></article>';
        }).join("")
      : '<div class="account-empty">Todavía no hay facturas registradas.</div>';

    const reviews = data.reviews || [];
    document.getElementById("account-reviews-list").innerHTML = reviews.length
      ? reviews.map(function(x) {
          const rating = Number(x.rating || 0);
          return '<article class="account-record"><div><strong class="account-stars">' + "★".repeat(rating) + "☆".repeat(5 - rating) + '</strong><p>' + accountEscape(x.comment || "") + '</p></div><div class="account-record-meta"><span>' + (x.status === "approved" ? "Publicada" : "Oculta") + '</span><small>' + accountDate(x.created_at) + '</small></div></article>';
        }).join("")
      : '<div class="account-empty">Todavía no dejaste reseñas.</div>';
  } catch (error) {
    console.error(error);
    ["account-requests-list","account-quotes-list","account-jobs-list","account-invoices-list","account-reviews-list"].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="account-empty">No se pudo cargar esta información.</div>';
    });
  }
}


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
    loadAccountDashboard();
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
