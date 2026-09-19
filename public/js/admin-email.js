// =========================================================
// EMAIL — BLOQUE J
// =========================================================

async function loadEmailTemplates() {
  const data = await api("/api/admin/email/templates");
  const select = $("emailTemplate");
  const list = $("emailTemplatesList");
  if (!select || !list) return;

  select.innerHTML = '<option value="">Seleccionar plantilla...</option>';
  list.innerHTML = "";

  (data.templates || []).forEach(template => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name + " · " + template.event_key;
    select.appendChild(option);

    const card = document.createElement("div");
    card.className = "email-template-item";
    card.innerHTML = `
      <div>
        <strong>${h(template.name)}</strong>
        <span>${h(template.event_key)}</span>
      </div>
      <div class="email-template-actions">
        <button type="button" class="btn tiny email-edit-template" data-id="${template.id}">Editar</button>
        <button type="button" class="btn tiny btn-secondary email-delete-template" data-id="${template.id}">Eliminar</button>
      </div>
    `;
    card.dataset.template = JSON.stringify(template);
    list.appendChild(card);
  });
}

function setupEmailAdmin() {
  const sendForm = $("emailSendForm");
  const templateForm = $("emailTemplateForm");
  if (!sendForm || !templateForm) return;

  loadEmailTemplates().catch(error => showMsg(error.message, true));

  sendForm.addEventListener("submit", async event => {
    event.preventDefault();

    const templateId = Number($("emailTemplate")?.value);
    if (!templateId) return showMsg("Seleccioná una plantilla.", true);

    const variables = {
      cliente: $("emailClient")?.value.trim() || "",
      presupuesto: $("emailQuote")?.value.trim() || "",
      total: $("emailTotal")?.value.trim() || "",
      url: $("emailUrl")?.value.trim() || "",
      fecha: $("emailDate")?.value.trim() || "",
      hora: $("emailTime")?.value.trim() || "",
      trabajo: $("emailJob")?.value.trim() || "",
      detalle: $("emailDetail")?.value.trim() || ""
    };

    const button = sendForm.querySelector("button[type='submit']");
    if (button) button.disabled = true;

    try {
      const prepared = await api("/api/admin/email/prepare", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          template_id: templateId,
          recipient_name: $("emailClient")?.value.trim() || "",
          recipient_email: $("emailRecipient")?.value.trim() || "",
          variables,
          target_type: $("emailTargetType")?.value.trim() || "",
          target_id: $("emailTargetId")?.value || null
        })
      });

      const sent = await api("/api/admin/email/" + prepared.id + "/send", {method:"POST"});
      showMsg(sent.ok ? "Correo enviado correctamente." : "Correo preparado, pero no enviado.");
      sendForm.reset();
      await loadEmailHistory();
    } catch (error) {
      showMsg(error.message, true);
      await loadEmailHistory().catch(() => {});
    } finally {
      if (button) button.disabled = false;
    }
  });

  templateForm.addEventListener("submit", async event => {
    event.preventDefault();
    const body = {
      name: $("emailTemplateName")?.value.trim() || "",
      event_key: $("emailTemplateEvent")?.value.trim() || "",
      subject: $("emailTemplateSubject")?.value.trim() || "",
      body: $("emailTemplateBody")?.value || ""
    };

    try {
      await api("/api/admin/email/templates", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
      templateForm.reset();
      await loadEmailTemplates();
      showMsg("Plantilla creada.");
    } catch (error) {
      showMsg(error.message, true);
    }
  });

  $("refreshEmailHistory")?.addEventListener("click", loadEmailHistory);

  $("emailTemplatesList")?.addEventListener("click", async event => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const card = button.closest(".email-template-item");
    const template = card ? JSON.parse(card.dataset.template || "{}") : null;
    if (!template) return;

    if (button.classList.contains("email-delete-template")) {
      if (!confirm("¿Eliminar esta plantilla?")) return;
      try {
        await api("/api/admin/email/templates/" + template.id, {method:"DELETE"});
        await loadEmailTemplates();
        showMsg("Plantilla eliminada.");
      } catch (error) {
        showMsg(error.message, true);
      }
      return;
    }

    if (button.classList.contains("email-edit-template")) {
      const name = prompt("Nombre de la plantilla:", template.name);
      if (name === null) return;
      const subject = prompt("Asunto:", template.subject);
      if (subject === null) return;
      const body = prompt("Mensaje:", template.body);
      if (body === null) return;

      try {
        await api("/api/admin/email/templates/" + template.id, {
          method:"PUT",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            name,
            event_key: template.event_key,
            subject,
            body,
            active: !!template.active
          })
        });
        await loadEmailTemplates();
        showMsg("Plantilla actualizada.");
      } catch (error) {
        showMsg(error.message, true);
      }
    }
  });
}

async function loadEmailHistory() {
  const body = $("emailHistoryList");
  if (!body) return;

  try {
    const data = await api("/api/admin/email/history");
    body.innerHTML = (data.messages || []).map(message => `
      <tr>
        <td>${h(message.created_at)}</td>
        <td>${h(message.recipient_name || "—")}</td>
        <td>${h(message.recipient_email)}</td>
        <td>${h(message.subject)}</td>
        <td><span class="email-status email-status-${h(message.status)}">${h(message.status)}</span></td>
        <td>${message.sent_at ? h(message.sent_at) : "—"}</td>
      </tr>
    `).join("") || '<tr><td colspan="6">Sin correos registrados.</td></tr>';
}

async function initEmailAdmin() {
  setupEmailAdmin();
  await loadEmailHistory().catch(error => showMsg(error.message, true));
}

document.addEventListener("DOMContentLoaded", initEmailAdmin);
