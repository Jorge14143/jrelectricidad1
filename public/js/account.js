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
function accountEl(id) {
  return document.getElementById(id);
}
function setText(id, value) {
  const el = accountEl(id);
  if (el) el.textContent = value;
}
function setHtml(id, value) {
  const el = accountEl(id);
  if (el) el.innerHTML = value;
}

function updateServiceProgress(data) {
  const requests = data.requests || [];
  const quotes = data.quotes || [];
  const jobs = data.jobs || [];
  let current = requests.length ? 1 : 0;

  if (quotes.length) current = 2;
  if (jobs.some(j => ["finalizado","completado","cerrado"].includes(String(j.status || "").toLowerCase())) || jobs.some(j => j.completed_at)) current = 4;
  else if (jobs.length) current = 3;

  document.querySelectorAll(".progress-stage").forEach((stage, index) => {
    stage.classList.remove("done", "current");
    const step = index + 1;
    if (current && step < current) stage.classList.add("done");
    if (current && step === current) stage.classList.add("current");
  });

  const messages = {
    0: "Cuando envíes una solicitud, su avance se mostrará acá.",
    1: "Tu solicitud fue registrada. El próximo paso es la revisión y preparación del presupuesto.",
    2: "Ya hay un presupuesto emitido. Revisá su detalle para continuar con el servicio.",
    3: "Hay un trabajo en curso. Acá vas a poder consultar su estado y evolución.",
    4: "El trabajo figura como finalizado. Queda disponible en tu historial."
  };
  setText("account-next-step", messages[current] || messages[0]);
}


function initAccountNavigation() {
  const links = document.querySelectorAll(".account-menu a[data-account-view]");
  const views = document.querySelectorAll(".account-view");

  function showView(id, updateHash = true) {
    const target = document.getElementById(id);
    if (!target) return;

    views.forEach(function(view) {
      view.classList.toggle("active", view.id === id);
    });

    links.forEach(function(link) {
      link.classList.toggle("active", link.dataset.accountView === id);
    });

    if (updateHash) history.replaceState(null, "", "#" + id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  links.forEach(function(link) {
    link.addEventListener("click", function(event) {
      event.preventDefault();
      showView(link.dataset.accountView);
    });
  });

  const initial = window.location.hash.replace("#", "");
  showView(initial && document.getElementById(initial) ? initial : "servicio", false);

  window.addEventListener("hashchange", function() {
    const id = window.location.hash.replace("#", "");
    if (id && document.getElementById(id)) showView(id, false);
  });
}

async function loadAccountDashboard() {
  try {
    const response = await fetch("/api/account/dashboard", { credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo cargar el historial.");

    const s = data.summary || {};
    setText("doc-count-requests", s.requests ?? 0);
    setText("doc-count-quotes", s.quotes ?? 0);
    setText("doc-count-jobs", (Number(s.activeJobs || 0) + Number(s.completedJobs || 0)) || 0);
    setText("doc-count-invoices", s.invoices ?? 0);
    updateServiceProgress(data);

    const requests = data.requests || [];
    setHtml("account-requests-list", requests.length
      ? requests.map(function(x) {
          return '<article class="account-record"><div><strong>' + accountEscape(x.service || "Solicitud de servicio") + '</strong><p>' + accountEscape(x.description || "") + '</p></div><div class="account-record-meta"><span>' + accountStatus(x.status) + '</span><small>' + accountDate(x.created_at) + '</small></div></article>';
        }).join("")
      : '<div class="account-empty">Todavía no tenés solicitudes registradas.</div>');

    const quotes = data.quotes || [];
    setHtml("account-quotes-list", quotes.length
      ? quotes.map(function(x) {
          return '<article class="account-record account-record-quote"><div><strong>' + accountEscape(x.quote_number || "Presupuesto") + '</strong><p>' + accountEscape(x.service || "Servicio") + ' · Emitido ' + accountDate(x.issue_date) + '</p></div><div class="account-record-price"><strong>' + accountMoney(x.total) + '</strong><span class="account-status">' + accountStatus(x.status) + '</span></div></article>';
        }).join("")
      : '<div class="account-empty">Todavía no se emitieron presupuestos para tu cuenta.</div>');

    const jobs = data.jobs || [];
    setHtml("account-jobs-list", jobs.length
      ? jobs.map(function(x) {
          const when = x.completed_at ? "Finalizado " + accountDate(x.completed_at) : x.started_at ? "Iniciado " + accountDate(x.started_at) : "Sin iniciar";
          return '<article class="account-record"><div><strong>' + accountEscape(x.service || "Trabajo") + '</strong><p>Presupuesto ' + accountEscape(x.quote_number || "—") + '</p></div><div class="account-record-meta"><span>' + accountStatus(x.status) + '</span><small>' + when + '</small></div></article>';
        }).join("")
      : '<div class="account-empty">Todavía no tenés trabajos registrados.</div>');

    const invoices = data.invoices || [];
    setHtml("account-invoices-list", invoices.length
      ? invoices.map(function(x) {
          const pending = Math.max(0, Number(x.total || 0) - Number(x.paid_amount || 0));
          return '<article class="account-record"><div><strong>' + accountEscape(x.invoice_number || "Factura") + '</strong><p>Presupuesto ' + accountEscape(x.quote_number || "—") + ' · ' + accountDate(x.issue_date) + '</p></div><div class="account-record-price"><strong>' + accountMoney(x.total) + '</strong><span>' + (pending > 0 ? "Pendiente " + accountMoney(pending) : "Pagada") + '</span></div></article>';
        }).join("")
      : '<div class="account-empty">Todavía no hay facturas registradas.</div>');

    const reviews = data.reviews || [];
    setHtml("account-reviews-list", reviews.length
      ? reviews.map(function(x) {
          const rating = Math.max(0, Math.min(5, Number(x.rating || 0)));
          return '<article class="account-record"><div><strong class="account-stars">' + "★".repeat(rating) + "☆".repeat(5 - rating) + '</strong><p>' + accountEscape(x.comment || "") + '</p></div><div class="account-record-meta"><span>' + (x.status === "approved" ? "Publicada" : "Oculta") + '</span><small>' + accountDate(x.created_at) + '</small></div></article>';
        }).join("")
      : '<div class="account-empty">Todavía no dejaste reseñas.</div>');
  } catch (error) {
    console.error(error);
    ["account-requests-list","account-quotes-list","account-jobs-list","account-invoices-list","account-reviews-list"].forEach(function(id) {
      setHtml(id, '<div class="account-empty">No se pudo cargar esta información.</div>');
    });
  }
}

async function loadAccount() {
  const message = accountEl("account-message");
  const dataBox = accountEl("account-data");
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    if (!response.ok) { window.location.href = "/login.html"; return; }
    const data = await response.json();
    if (!data.user) { window.location.href = "/login.html"; return; }

    const user = data.user;
    const name = user.name || "Cliente";
    setText("account-name", name);
    setText("account-email", user.email || "-");
    setText("account-role", user.role === "admin" ? "Administrador" : "Usuario");
    setText("profile-card-name", name);
    setText("account-welcome-title", "Mi cuenta");
    setText("profile-avatar", name.trim().charAt(0).toUpperCase() || "J");
    const profileName = accountEl("profile-name");
    const profileEmail = accountEl("profile-email");
    if (profileName) profileName.value = name;
    if (profileEmail) profileEmail.value = user.email || "";

    const adminLink = accountEl("admin-link");
    if (user.role === "admin" && adminLink) adminLink.style.display = "inline-block";
    if (message) message.style.display = "none";
    if (dataBox) dataBox.style.display = "block";

    await loadAccountDashboard();
  } catch (error) {
    console.error(error);
    if (message) message.textContent = "No se pudo cargar la información.";
  }
}

const profileForm = accountEl("profile-form");
profileForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = accountEl("profile-message");
  const button = profileForm.querySelector("button[type=submit]");
  const name = accountEl("profile-name").value.trim();
  const email = accountEl("profile-email").value.trim();
  if (!name || !email) { message.textContent = "Completá nombre y email."; return; }
  if (button) button.disabled = true;
  message.textContent = "Guardando...";
  try {
    const response = await fetch("/api/account/profile", { method:"PUT", headers:{"Content-Type":"application/json"}, credentials:"same-origin", body:JSON.stringify({name,email}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudieron actualizar los datos.");
    setText("account-name", data.user.name);
    setText("account-email", data.user.email);
    setText("profile-card-name", data.user.name);
    setText("profile-avatar", (data.user.name || "J").trim().charAt(0).toUpperCase());
    message.textContent = "✅ Datos personales actualizados correctamente.";
  } catch(error) { message.textContent = "❌ " + error.message; }
  finally { if (button) button.disabled = false; }
});

const emailForm = accountEl("email-form");
emailForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const newEmail = accountEl("new-email").value.trim();
  const currentPassword = accountEl("email-current-password").value;
  const message = accountEl("email-message");
  message.textContent = "Actualizando...";
  try {
    const response = await fetch("/api/account/email", {method:"PUT",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({newEmail,currentPassword})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo cambiar el correo.");
    setText("account-email", data.user.email);
    const profileEmail = accountEl("profile-email");
    if (profileEmail) profileEmail.value = data.user.email;
    emailForm.reset();
    message.textContent = "✅ Correo actualizado correctamente.";
  } catch(error) { message.textContent = "❌ " + error.message; }
});

const passwordForm = accountEl("password-form");
passwordForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const currentPassword = accountEl("current-password").value;
  const newPassword = accountEl("new-password").value;
  const confirmPassword = accountEl("confirm-password").value;
  const message = accountEl("password-message");
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

initAccountNavigation();
loadAccount();
