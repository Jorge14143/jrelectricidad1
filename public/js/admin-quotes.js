// =========================================================
// SOLICITUDES DE PRESUPUESTO
// =========================================================

// =========================================================
// PRESUPUESTOS GUARDADOS
// =========================================================

function formatQuoteDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  return new Date(value).toLocaleDateString(
    "es-AR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  );
}


function quoteStatusLabel(status) {
  const labels = {
    borrador: "Borrador",
    enviado: "Enviado",
    aceptado: "Aceptado",
    rechazado: "Rechazado",
    vencido: "Vencido",
    cerrado: "Cerrado"
  };

  return labels[status] || status || "Borrador";
}


async function loadQuotes() {
  const container = $("quotesList");

  if (!container) {
    return;
  }

  container.innerHTML = `
    <p class="muted quote-list-loading">
      Cargando presupuestos...
    </p>
  `;

  try {
    const quotes = await api("/api/admin/quotes");

    if (!quotes.length) {
      container.innerHTML = `
        <div class="quote-list-empty">
          <span>💰</span>
          <p>Todavía no hay presupuestos guardados.</p>
        </div>
      `;

      return;
    }

    container.innerHTML = `
      <div class="table-wrap quotes-table-wrap">

        <table class="table quotes-table">

          <thead>
            <tr>
              <th>Nº</th>
              <th>Cliente</th>
              <th>Solicitud</th>
              <th>Fecha</th>
              <th>Conceptos</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>

          <tbody>

            ${quotes.map(quote => {

              const quoteId =
                Number(quote.id);

              const phone =
                quote.client_phone || "";

              const hasPhone =
                phone.trim().length > 0;

              return `
                <tr>

                  <td>
                    <strong class="quote-number">
                      ${h(quote.quote_number)}
                    </strong>
                  </td>

                  <td>
                    <strong>
                      ${h(quote.client_name)}
                    </strong>

                    ${
                      quote.client_email
                        ? `
                          <small>
                            ${h(quote.client_email)}
                          </small>
                        `
                        : ""
                    }

                  </td>

                  <td>
                    ${h(
                      quote.requested_service ||
                      "Sin servicio"
                    )}
                  </td>

                  <td>
                    ${h(
                      formatQuoteDate(
                        quote.issue_date ||
                        quote.created_at
                      )
                    )}
                  </td>

                  <td>
                    ${Number(
                      quote.items_count || 0
                    )}
                  </td>

                  <td>
                    <strong class="quote-total-value">
                      ${formatQuoteMoney(
                        quote.total
                      )}
                    </strong>
                  </td>

                  <td>
                    <span class="quote-status">
                      ${h(
                        quoteStatusLabel(
                          quote.status
                        )
                      )}
                    </span>
                  </td>

                  <td>

                    <div class="quote-table-actions">
					<button
  type="button"
  class="btn tiny"
  onclick="editQuote(${quoteId})"
  title="Editar presupuesto"
>
  ✏️ Editar
</button>

                      <button
                        type="button"
                        class="btn tiny"
                        onclick="viewQuote(${quoteId})"
                        title="Ver presupuesto"
                      >
                        👁 Ver
                      </button>

                      <button
                        type="button"
                        class="btn tiny"
                        onclick="openQuotePdf(${quoteId})"
                        title="Ver PDF"
                      >
                        📄 PDF
                      </button>
                      <button type="button" class="btn tiny" onclick="changeQuoteStatus(${quoteId},'enviado')" title="Enviar al cliente">📤 Enviar</button>
                      <button type="button" class="btn tiny" onclick="deleteQuote(${quoteId})" title="Eliminar si está en borrador">🗑 Eliminar</button>

                      ${
                        hasPhone && quote.access_token
                          ? `
                            <button
                              type="button"
                              class="quote-whatsapp-btn"
                              onclick="sendQuoteWhatsApp(${quoteId})"
                              title="Enviar por WhatsApp"
                            >
                              📲 WhatsApp
                            </button>
                          `
                          : `
                            <button
                              type="button"
                              class="quote-whatsapp-btn"
                              disabled
                              title="El cliente no tiene teléfono registrado"
                            >
                              📲 WhatsApp
                            </button>
                          `
                      }

                    </div>

                  </td>

                </tr>
              `;

            }).join("")}

          </tbody>

        </table>

      </div>
    `;

    // Guardamos los presupuestos para usarlos
    // desde los botones de acciones.
    window.adminQuotes = quotes;

  } catch (error) {

    console.error(
      "Error cargando presupuestos:",
      error
    );

    container.innerHTML = `
      <div class="quote-list-empty">

        <span>⚠️</span>

        <p>
          ${h(error.message)}
        </p>

      </div>
    `;
  }
}
// =========================================================
// GESTIÓN AVANZADA DE PRESUPUESTOS
// =========================================================

async function changeQuoteStatus(id, status) {
  const labels = {
    enviado: "enviar al cliente",
    aceptado: "marcar como aceptado",
    rechazado: "marcar como rechazado",
    vencido: "marcar como vencido",
    cerrado: "cerrar"
  };

  if (!confirm("¿Querés " + (labels[status] || "cambiar el estado de este presupuesto") + "?")) return;

  try {
    const result = await api("/api/admin/quotes/" + id + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });

    alert(result.message || "Estado actualizado correctamente.");
    await loadQuotes();
    await loadQuoteRequests();
  } catch (error) {
    alert("No se pudo cambiar el estado: " + error.message);
  }
}

async function deleteQuote(id) {
  if (!confirm("¿Eliminar este presupuesto en borrador? Esta acción no se puede deshacer.")) return;

  try {
    await api("/api/admin/quotes/" + id, { method: "DELETE" });
    alert("Presupuesto eliminado.");
    await loadQuotes();
  } catch (error) {
    alert("No se pudo eliminar: " + error.message);
  }
}

// =========================================================
// ACCIONES DE PRESUPUESTOS
// =========================================================

function getAdminQuote(id) {
  const quotes =
    Array.isArray(window.adminQuotes)
      ? window.adminQuotes
      : [];

  return quotes.find(
    quote =>
      Number(quote.id) === Number(id)
  );
}


// =========================================================
// VER PRESUPUESTO
// =========================================================
async function editQuote(id) {
  try {
    const quote =
      await api(`/api/admin/quotes/${id}`);

    const cachedQuote =
      getAdminQuote(id);

    editingQuoteId =
      Number(id);

    $("createQuoteModalTitle").textContent =
      "Editar presupuesto";

    $("saveQuoteButton").textContent =
      "💾 Guardar cambios";

    $("quoteRequestId").value =
      quote.quote_request_id ||
      cachedQuote?.quote_request_id ||
      "";

    $("quoteIssueDate").value =
      quote.issue_date
        ? String(quote.issue_date).slice(0, 10)
        : "";

    $("quoteExpirationDate").value =
      quote.expiration_date
        ? String(quote.expiration_date).slice(0, 10)
        : "";

    $("quoteDiscount").value =
      Number(quote.discount || 0);

    $("quoteNotes").value =
      quote.notes || "";

    $("quoteClientInfo").innerHTML = `
      <div class="quote-client-summary-main">
        <strong>${h(
          quote.name ||
          quote.client_name ||
          cachedQuote?.client_name ||
          ""
        )}</strong>

        ${
          quote.email ||
          quote.client_email ||
          cachedQuote?.client_email
            ? `
              <span>
                ${h(
                  quote.email ||
                  quote.client_email ||
                  cachedQuote?.client_email ||
                  ""
                )}
              </span>
            `
            : ""
        }

        ${
          quote.phone ||
          quote.client_phone ||
          cachedQuote?.client_phone
            ? `
              <span>
                ${h(
                  quote.phone ||
                  quote.client_phone ||
                  cachedQuote?.client_phone ||
                  ""
                )}
              </span>
            `
            : ""
        }
      </div>
    `;

    const itemsContainer =
      $("quoteItems");

    itemsContainer.innerHTML = "";

    const items =
      Array.isArray(quote.items)
        ? quote.items
        : [];

    if (!items.length) {
      addQuoteItem();
    } else {
      for (const item of items) {
        addQuoteItem();

        const rows =
          itemsContainer.querySelectorAll(
            ".quote-item"
          );

        const row =
          rows[rows.length - 1];

        const description =
          row.querySelector(
            ".quote-item-description"
          );

        const quantity =
          row.querySelector(
            ".quote-item-quantity"
          );

        const unit =
          row.querySelector(
            ".quote-item-unit"
          );

        const unitPrice =
          row.querySelector(
            ".quote-item-price"
          );

        if (description) {
          description.value =
            item.description || "";
        }

        if (quantity) {
          quantity.value =
            item.quantity ?? 1;
        }

        if (unit) {
          unit.value =
            item.unit || "unidad";
        }

        if (unitPrice) {
          unitPrice.value =
            item.unit_price ?? 0;
        }
      }
    }

    calculateQuoteTotals();

    $("createQuoteModal").style.display =
      "flex";

  } catch (error) {
    console.error(
      "Error cargando presupuesto para editar:",
      error
    );

    showMsg(
      "No se pudo cargar el presupuesto: " +
      error.message,
      true
    );
  }
}
async function viewQuote(id) {
  try {

    const quote =
      await api(
        `/api/admin/quotes/${id}`
      );

    const modal =
      $("quoteSummaryModal");

    const detail =
      $("quoteSummaryDetail");

    if (!modal || !detail) {
      console.error(
        "No existe el modal de resumen del presupuesto."
      );

      // Si el modal no existe, mostramos el presupuesto
      // directamente en una nueva pestaña como alternativa.
      window.open(
        `/api/admin/quotes/${id}`,
        "_blank"
      );

      return;
    }

    detail.innerHTML = `
      <div class="quote-detail-modern">

        <div class="quote-detail-header">

          <div>

            <span class="quote-section-label">
              PRESUPUESTO
            </span>

            <h2>
              ${h(quote.quote_number)}
            </h2>

          </div>

          <span class="quote-detail-status">
            ${h(
              quoteStatusLabel(
                quote.status
              )
            )}
          </span>

        </div>

        <div class="quote-detail-block">

          <div class="quote-detail-block-title">

            <span class="quote-detail-block-icon">
              👤
            </span>

            <div>

              <span class="quote-detail-block-label">
                CLIENTE
              </span>

              <h3>
                ${h(quote.name || "-")}
              </h3>

            </div>

          </div>

          <div class="quote-contact-grid">

            <div class="quote-contact-item">

              <span class="quote-contact-icon">
                📱
              </span>

              <div>

                <small>
                  Teléfono
                </small>

                <strong>
                  ${h(quote.phone || "-")}
                </strong>

              </div>

            </div>

            <div class="quote-contact-item">

              <span class="quote-contact-icon">
                ✉️
              </span>

              <div>

                <small>
                  Email
                </small>

                <strong>
                  ${h(quote.email || "No indicado")}
                </strong>

              </div>

            </div>

          </div>

        </div>

        <div class="quote-detail-block">

          <div class="quote-detail-block-title">

            <span class="quote-detail-block-icon">
              ⚡
            </span>

            <div>

              <span class="quote-detail-block-label">
                SERVICIO
              </span>

              <h3>
                ${h(
                  quote.service ||
                  "Sin servicio"
                )}
              </h3>

            </div>

          </div>

        </div>

        <div class="quote-detail-block">

          <div class="quote-detail-block-title">

            <span class="quote-detail-block-icon">
              🧾
            </span>

            <div>

              <span class="quote-detail-block-label">
                CONCEPTOS
              </span>

            </div>

          </div>

          <div class="table-wrap">

            <table class="table">

              <thead>

                <tr>
                  <th>Concepto</th>
                  <th>Cantidad</th>
                  <th>Precio</th>
                  <th>Total</th>
                </tr>

              </thead>

              <tbody>

                ${
                  (quote.items || [])
                    .map(item => `
                      <tr>

                        <td>
                          ${h(item.description)}
                        </td>

                        <td>
                          ${h(item.quantity)}
                          ${h(item.unit || "")}
                        </td>

                        <td>
                          ${formatQuoteMoney(
                            item.unit_price
                          )}
                        </td>

                        <td>
                          <strong>
                            ${formatQuoteMoney(
                              item.total
                            )}
                          </strong>
                        </td>

                      </tr>
                    `)
                    .join("")
                }

              </tbody>

            </table>

          </div>

        </div>

        <div class="quote-summary-total">

          <span>
            Total
          </span>

          <strong>
            ${formatQuoteMoney(
              quote.total
            )}
          </strong>

        </div>

        ${
          quote.notes
            ? `
              <div class="quote-detail-block">

                <div class="quote-detail-block-title">

                  <span class="quote-detail-block-icon">
                    📝
                  </span>

                  <div>

                    <span class="quote-detail-block-label">
                      NOTAS
                    </span>

                  </div>

                </div>

                <div class="quote-description-modern">
                  ${h(quote.notes)}
                </div>

              </div>
            `
            : ""
        }

        <div class="quote-detail-actions-modern">

          <button
            type="button"
            class="quote-modal-secondary"
            onclick="closeQuoteSummaryModal()"
          >
            Cerrar
          </button>

          <button
            type="button"
            class="quote-create-large"
            onclick="openQuotePdf(${quote.id})"
          >
            📄 Ver PDF
          </button>

        </div>

      </div>
    `;

    modal.style.display = "flex";

    modal.classList.add("active");

  } catch (error) {

    console.error(
      "Error viendo presupuesto:",
      error
    );

    alert(
      "No se pudo cargar el presupuesto: " +
      error.message
    );
  }
}


// =========================================================
// CERRAR MODAL RESUMEN
// =========================================================

function closeQuoteSummaryModal() {

  const modal =
    $("quoteSummaryModal");

  if (!modal) {
    return;
  }

  modal.classList.remove(
    "active"
  );

  modal.style.display =
    "none";
}


// =========================================================
// PDF
// =========================================================

function openQuotePdf(id) {

  window.open(
    `/api/admin/quotes/${id}/pdf`,
    "_blank"
  );
}


// =========================================================
// WHATSAPP
// =========================================================

function sendQuoteWhatsApp(id) {

  const quote =
    getAdminQuote(id);

  if (!quote) {

    alert(
      "No se encontró el presupuesto."
    );

    return;
  }

  if (!quote.client_phone) {

    alert(
      "El cliente no tiene un número de teléfono registrado."
    );

    return;
  }

  if (!quote.access_token) {

    alert(
      "Este presupuesto no tiene un enlace público disponible."
    );

    return;
  }

  // -------------------------------------------------------
  // LIMPIAR TELÉFONO
  // -------------------------------------------------------

  let phone =
    String(
      quote.client_phone
    ).replace(
      /\D/g,
      ""
    );

  if (!phone) {

    alert(
      "El número de teléfono no es válido."
    );

    return;
  }

  // -------------------------------------------------------
  // ENLACE PÚBLICO
  // -------------------------------------------------------

  const publicUrl =
    `${window.location.origin}/presupuesto/${quote.access_token}`;

  // -------------------------------------------------------
  // TOTAL
  // -------------------------------------------------------

  const total =
    formatQuoteMoney(
      quote.total
    );

  // -------------------------------------------------------
  // MENSAJE
  // -------------------------------------------------------

  const message =
`Hola ${quote.client_name || ""} 👋

Te envío el presupuesto ${quote.quote_number} de JR Electricidad.

💰 Total: ${total}

Podés consultar el presupuesto completo en el siguiente enlace:

${publicUrl}

Saludos,
JR Electricidad ⚡`;

  // -------------------------------------------------------
  // WHATSAPP
  // -------------------------------------------------------

  const whatsappUrl =
    `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  window.open(
    whatsappUrl,
    "_blank"
  );
}
let quoteRequests = [];
let currentQuoteRequest = null;
let editingQuoteId = null;

const REQUEST_STATUS_LABELS = {
  nueva: "🟡 Nueva",
  en_revision: "🔵 En revisión",
  presupuestando: "🟣 Presupuestando",
  presupuestada: "🟢 Presupuestada",
  aceptada: "🟢 Aceptada",
  programada: "📅 Programada",
  en_trabajo: "🔧 En trabajo",
  finalizada: "✅ Finalizada",
  cerrada: "⚫ Cerrada"
};

const REQUEST_PRIORITY_LABELS = {
  baja: "Baja",
  normal: "Normal",
  alta: "Alta",
  urgente: "🚨 Urgente"
};

function requestStatusLabel(status) {
  return REQUEST_STATUS_LABELS[status] || status || "Nueva";
}

function requestPriorityLabel(priority) {
  return REQUEST_PRIORITY_LABELS[priority] || priority || "Normal";
}

function formatRequestDate(value) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

async function loadRequestAssignees() {
  try {
    const users = await api("/api/admin/quote-requests/assignees");
    const controls = [$("quoteRequestAssignedFilter"), $("quoteRequestAssigned")].filter(Boolean);

    controls.forEach(select => {
      const current = select.value;
      const isFilter = select.id === "quoteRequestAssignedFilter";
      select.innerHTML = isFilter
        ? '<option value="">Todos los técnicos</option>'
        : '<option value="">Sin asignar</option>';

      users.forEach(user => {
        const option = document.createElement("option");
        option.value = user.id;
        option.textContent = user.name + (user.role === "admin" ? " · Admin" : "");
        select.appendChild(option);
      });

      if ([...select.options].some(o => o.value === current)) {
        select.value = current;
      }
    });
  } catch (error) {
    console.error("No se pudieron cargar los técnicos:", error);
  }
}

async function loadQuoteRequests() {
  const container = $("quoteRequestsList");
  const loading = $("quoteRequestsLoading");
  const pendingCounter = $("pendingQuotesCount");
  const pendingBadge = $("pendingQuotesBadge");

  if (!container) return;

  if (loading) loading.style.display = "flex";

  try {
    const params = new URLSearchParams();
    const values = {
      search: $("quoteRequestSearch")?.value.trim() || "",
      status: $("quoteRequestStatusFilter")?.value || "",
      priority: $("quoteRequestPriorityFilter")?.value || "",
      assigned_user_id: $("quoteRequestAssignedFilter")?.value || "",
      date_from: $("quoteRequestDateFrom")?.value || "",
      date_to: $("quoteRequestDateTo")?.value || ""
    };

    Object.entries(values).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    const query = params.toString();
    const data = await api("/api/admin/quote-requests" + (query ? "?" + query : ""));
    quoteRequests = Array.isArray(data) ? data : [];

    const pendingCount = quoteRequests.filter(r =>
      ["nueva", "en_revision", "presupuestando"].includes(r.status)
    ).length;

    if (pendingCounter) pendingCounter.textContent = pendingCount;
    if (pendingBadge) pendingBadge.textContent = pendingCount;
    if (loading) loading.style.display = "none";

    if (!quoteRequests.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><h3>No hay solicitudes</h3><p>No hay solicitudes que coincidan con los filtros.</p></div>';
      return;
    }

    container.innerHTML = quoteRequests.map(renderQuoteRequest).join("");
  } catch (error) {
    if (loading) loading.style.display = "none";
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>Error al cargar solicitudes</h3><p>${h(error.message)}</p><button type="button" class="admin-btn" onclick="loadQuoteRequests()">🔄 Reintentar</button></div>`;
  }
}

function renderQuoteRequest(request) {
  const initials = (request.name || "C").trim().split(/\s+/).slice(0, 2)
    .map(word => word.charAt(0).toUpperCase()).join("");

  return `
    <article class="quote-request-card">
      <div class="quote-request-card-header">
        <div class="quote-request-client">
          <div class="quote-request-avatar">${h(initials)}</div>
          <div>
            <h3>${h(request.name)}</h3>
            <div class="quote-request-number">Solicitud #${request.id}</div>
          </div>
        </div>
        <span class="quote-status">${h(requestStatusLabel(request.status))}</span>
      </div>

      <div class="quote-request-info">
        <div class="quote-request-info-row"><span>📱</span><span>${h(request.phone)}</span></div>
        ${request.email ? `<div class="quote-request-info-row"><span>✉️</span><span>${h(request.email)}</span></div>` : ""}
        ${request.locality ? `<div class="quote-request-info-row"><span>📍</span><span>${h(request.locality)}</span></div>` : ""}
      </div>

      <div class="quote-request-service">
        <span class="quote-request-service-label">Servicio solicitado</span>
        <strong>${h(request.service || "Servicio no especificado")}</strong>
      </div>

      <p class="quote-request-description">${h(request.description || "Sin descripción.")}</p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;">
        <span class="quote-status">Prioridad: ${h(requestPriorityLabel(request.priority))}</span>
        <span class="quote-status">👤 ${h(request.assigned_user_name || "Sin asignar")}</span>
        ${request.scheduled_at ? `<span class="quote-status">📅 ${h(formatRequestDate(request.scheduled_at))}</span>` : ""}
      </div>

      <div class="quote-request-footer">
        <span class="quote-request-date">🕐 ${h(formatRequestDate(request.created_at))}</span>
        <div class="quote-request-actions">
          <button type="button" class="quote-view-btn" onclick="openQuoteRequest(${Number(request.id)})">👁 Ver / gestionar</button>
          ${request.quote_id
            ? `<button type="button" class="quote-create-btn" onclick="viewQuote(${Number(request.quote_id)})">💰 Ver presupuesto</button>`
            : `<button type="button" class="quote-create-btn" onclick="convertRequestToQuote(${Number(request.id)})">💰 Convertir a presupuesto</button>`}
          ${request.job_id
            ? `<button type="button" class="quote-create-btn" onclick="window.location.hash='jobsSection'">🔧 Ver trabajo</button>`
            : `<button type="button" class="quote-create-btn" onclick="convertRequestToJob(${Number(request.id)})">🔧 Crear trabajo</button>`}
        </div>
      </div>
    </article>
  `;
}

async function openQuoteRequest(id) {
  try {
    const request = await api(`/api/admin/quote-requests/${id}`);
    currentQuoteRequest = request;

    const detail = $("quoteRequestDetail");
    if (!detail) throw new Error("No existe el contenedor de detalle de la solicitud.");

    const assignees = await api("/api/admin/quote-requests/assignees").catch(() => []);
    const historyHtml = (request.history || []).length
      ? request.history.map(item => `
        <div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)">
          <strong>${h(item.action)}</strong>
          <div>${h(item.old_status || "")} → ${h(item.new_status || "")}</div>
          <small>${h(item.actor_name || "Sistema")} · ${h(formatRequestDate(item.created_at))}</small>
        </div>`).join("")
      : "<p>Sin movimientos registrados.</p>";

    const attachmentsHtml = (request.attachments || []).length
      ? request.attachments.map(file => `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)">
          <a href="${h(file.url)}" target="_blank" rel="noopener noreferrer">${h(file.original_name)}</a>
          <button type="button" class="btn tiny" onclick="deleteRequestAttachment(${request.id},${file.id})">🗑</button>
        </div>`).join("")
      : "<p>No hay archivos adjuntos.</p>";

    detail.innerHTML = `
      <div class="quote-detail-modern">
        <div class="quote-detail-header">
          <div><span class="quote-section-label">GESTIÓN DE SOLICITUD</span><h2>Solicitud #${request.id}</h2></div>
          <span class="quote-detail-status">${h(requestStatusLabel(request.status))}</span>
        </div>

        <div class="quote-detail-block">
          <div class="quote-detail-block-title"><span class="quote-detail-block-icon">⚙️</span><div><span class="quote-detail-block-label">GESTIÓN</span></div></div>
          <div class="quote-contact-grid">
            <div><label>Estado</label><select id="quoteRequestStatus">
              ${Object.entries(REQUEST_STATUS_LABELS).map(([key,label]) => `<option value="${key}" ${request.status===key?"selected":""}>${h(label)}</option>`).join("")}
            </select></div>
            <div><label>Prioridad</label><select id="quoteRequestPriority">
              ${Object.entries(REQUEST_PRIORITY_LABELS).map(([key,label]) => `<option value="${key}" ${(request.priority||"normal")===key?"selected":""}>${h(label)}</option>`).join("")}
            </select></div>
            <div><label>Técnico</label><select id="quoteRequestAssigned"><option value="">Sin asignar</option>
              ${assignees.map(user => `<option value="${user.id}" ${Number(request.assigned_user_id)===Number(user.id)?"selected":""}>${h(user.name)}</option>`).join("")}
            </select></div>
            <div><label>Fecha programada</label><input type="datetime-local" id="quoteRequestScheduled" value="${request.scheduled_at ? String(request.scheduled_at).replace(" ","T").slice(0,16) : ""}"></div>
          </div>
          <label for="quoteRequestInternalNotes">Notas internas</label>
          <textarea id="quoteRequestInternalNotes" rows="4" maxlength="10000">${h(request.internal_notes || "")}</textarea>
          <button type="button" class="btn" onclick="saveQuoteRequestManagement(${request.id})">💾 Guardar cambios</button>
        </div>

        <div class="quote-detail-block">
          <div class="quote-detail-block-title"><span class="quote-detail-block-icon">👤</span><div><span class="quote-detail-block-label">CLIENTE</span><h3>${h(request.name)}</h3></div></div>
          <div class="quote-contact-grid">
            <div><small>Teléfono</small><strong>${h(request.phone)}</strong></div>
            <div><small>Email</small><strong>${h(request.email || "No indicado")}</strong></div>
            <div><small>Localidad</small><strong>${h(request.client_locality || "No indicada")}</strong></div>
            <div><small>Dirección</small><strong>${h(request.client_address || "No indicada")}</strong></div>
          </div>
        </div>

        <div class="quote-detail-block">
          <div class="quote-detail-block-title"><span class="quote-detail-block-icon">⚡</span><div><span class="quote-detail-block-label">TRABAJO SOLICITADO</span><h3>${h(request.service || "Sin servicio")}</h3></div></div>
          <div class="quote-description-modern">${h(request.description || "Sin descripción.")}</div>
          <div class="quote-request-created">📅 Fecha preferida: <strong>${h(request.preferred_date || "No indicada")}</strong><br>🕐 Recibida: <strong>${h(formatRequestDate(request.created_at))}</strong></div>
        </div>

        ${request.image_url ? `<div class="quote-detail-block"><div class="quote-detail-block-title"><span class="quote-detail-block-icon">📷</span><div><span class="quote-detail-block-label">FOTO ORIGINAL</span></div></div><a href="${h(request.image_url)}" target="_blank"><img src="${h(request.image_url)}" alt="Foto adjunta" style="display:block;width:100%;max-height:420px;object-fit:contain;border-radius:12px;background:#080a0f;"></a></div>` : ""}

        <div class="quote-detail-block">
          <div class="quote-detail-block-title"><span class="quote-detail-block-icon">📎</span><div><span class="quote-detail-block-label">ARCHIVOS</span></div></div>
          ${attachmentsHtml}
          <form id="requestAttachmentForm" style="margin-top:12px">
            <input type="file" id="requestAttachmentFile" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt" required>
            <button type="submit" class="btn tiny">📎 Adjuntar</button>
          </form>
        </div>

        <div class="quote-detail-block">
          <div class="quote-detail-block-title"><span class="quote-detail-block-icon">🕘</span><div><span class="quote-detail-block-label">HISTORIAL</span></div></div>
          ${historyHtml}
        </div>

        <div class="quote-detail-actions-modern">
          <button type="button" class="quote-modal-secondary" onclick="closeQuoteRequestModal()">Cerrar</button>
          ${request.quote_id ? `<button type="button" class="quote-create-large" onclick="viewQuote(${request.quote_id})">💰 Ver presupuesto</button>` : `<button type="button" class="quote-create-large" onclick="convertRequestToQuote(${request.id})">💰 Convertir a presupuesto</button>`}
          ${request.job_id ? "" : `<button type="button" class="quote-create-large" onclick="convertRequestToJob(${request.id})">🔧 Crear trabajo</button>`}
        </div>
      </div>
    `;

    const modal = $("quoteRequestModal");
    if (!modal) throw new Error("No existe el modal de solicitud.");
    modal.style.display = "flex";
    modal.classList.add("active");

    $("requestAttachmentForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const file = $("requestAttachmentFile")?.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      try {
        await api(`/api/admin/quote-requests/${request.id}/attachments`, { method:"POST", body:form });
        await openQuoteRequest(request.id);
      } catch (error) {
        alert(error.message);
      }
    });
  } catch (error) {
    alert("No se pudo cargar la solicitud: " + error.message);
  }
}

async function saveQuoteRequestManagement(id) {
  try {
    await api(`/api/admin/quote-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: $("quoteRequestStatus")?.value,
        priority: $("quoteRequestPriority")?.value,
        assigned_user_id: $("quoteRequestAssigned")?.value || null,
        scheduled_at: $("quoteRequestScheduled")?.value || null,
        internal_notes: $("quoteRequestInternalNotes")?.value || ""
      })
    });
    showMsg("Solicitud actualizada correctamente.");
    await loadQuoteRequests();
    await openQuoteRequest(id);
  } catch (error) {
    showMsg("No se pudo actualizar la solicitud: " + error.message, true);
  }
}

async function convertRequestToQuote(id) {
  try {
    const result = await api(`/api/admin/quote-requests/${id}/convert-to-quote`, { method:"POST" });
    alert(result.already_exists ? "La solicitud ya tiene un presupuesto." : `Presupuesto ${result.quote_number} creado en borrador.`);
    await loadQuoteRequests();
    if (result.quote_id && typeof editQuote === "function") {
      await editQuote(result.quote_id);
    }
  } catch (error) {
    alert("No se pudo convertir la solicitud: " + error.message);
  }
}

async function convertRequestToJob(id) {
  if (!confirm("¿Crear un trabajo a partir de esta solicitud?")) return;
  try {
    const result = await api(`/api/admin/quote-requests/${id}/convert-to-job`, { method:"POST" });
    alert(result.already_exists ? "La solicitud ya tiene un trabajo." : "Trabajo creado correctamente.");
    await loadQuoteRequests();
    closeQuoteRequestModal();
  } catch (error) {
    alert("No se pudo crear el trabajo: " + error.message);
  }
}

async function deleteRequestAttachment(requestId, attachmentId) {
  if (!confirm("¿Eliminar este archivo?")) return;
  try {
    await api(`/api/admin/quote-requests/${requestId}/attachments/${attachmentId}`, { method:"DELETE" });
    await openQuoteRequest(requestId);
  } catch (error) {
    alert(error.message);
  }
}

function closeQuoteRequestModal() {
  const modal = $("quoteRequestModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.style.display = "none";
}

function setupQuoteRequestFilters() {
  const search = $("quoteRequestSearch");
  const status = $("quoteRequestStatusFilter");
  const priority = $("quoteRequestPriorityFilter");
  const assigned = $("quoteRequestAssignedFilter");
  const dateFrom = $("quoteRequestDateFrom");
  const dateTo = $("quoteRequestDateTo");
  const refresh = $("refreshQuoteRequests");

  const reload = () => loadQuoteRequests();

  if (search) {
    let timer;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 250);
    });
  }

  [status, priority, assigned, dateFrom, dateTo].forEach(control => {
    if (control) control.addEventListener("change", reload);
  });

  if (refresh) refresh.addEventListener("click", reload);
}

// =========================================================
// INICIAR PRESUPUESTO
// =========================================================

function startCreateQuote(id) {
  if (id) {
    const found =
      quoteRequests.find(
        request =>
          Number(request.id) === Number(id)
      );

    if (found) {
      currentQuoteRequest =
        found;
    }
  }

  if (!currentQuoteRequest) {
    alert(
      "No se encontró la solicitud."
    );

    return;
  }

  closeQuoteRequestModal();

  const modal =
    $("createQuoteModal");

  if (!modal) {
    alert(
      "No existe el formulario de presupuesto."
    );

    return;
  }

  modal.style.display =
    "flex";

  modal.classList.add(
    "active"
  );

  const requestId =
    $("quoteRequestId");

  if (requestId) {
    requestId.value =
      currentQuoteRequest.id;
  }

  const clientInfo =
    $("quoteClientInfo");

  if (clientInfo) {
    clientInfo.innerHTML = `
      <strong>
        Cliente:
      </strong>

      ${escapeHtml(
        currentQuoteRequest.name
      )}

      <br>

      <strong>
        Servicio:
      </strong>

      ${
        escapeHtml(
          currentQuoteRequest.service ||
          "No especificado"
        )
      }
    `;
  }

  const issueDate =
    $("quoteIssueDate");

  if (issueDate) {
    issueDate.value =
      new Date()
        .toISOString()
        .slice(0, 10);
  }

  const items =
    $("quoteItems");

  if (items) {
    items.innerHTML =
      "";

    addQuoteItem();
  }

  calculateQuoteTotals();
}


// =========================================================
// AGREGAR CONCEPTO
// =========================================================

function addQuoteItem() {
  const container =
    $("quoteItems");

  if (!container) {
    return;
  }

  const row =
    document.createElement(
      "div"
    );

  row.className =
    "quote-item";

  row.innerHTML = `
    <input
      type="text"
      class="quote-item-description"
      placeholder="Ej: Instalación de tablero"
      maxlength="500"
    >

    <input
      type="number"
      class="quote-item-quantity"
      value="1"
      min="0"
      step="0.01"
      placeholder="Cantidad"
    >

    <select
      class="quote-item-unit"
    >

      <option value="unidad">
        Unidad
      </option>

      <option value="hora">
        Hora
      </option>

      <option value="metro">
        Metro
      </option>

      <option value="global">
        Global
      </option>

    </select>

    <input
      type="number"
      class="quote-item-price"
      value="0"
      min="0"
      step="0.01"
      placeholder="Precio"
    >

    <strong class="quote-item-total">
      $0,00
    </strong>

    <button
      type="button"
      class="quote-item-remove"
      title="Eliminar concepto"
    >
      🗑
    </button>
  `;

  container.appendChild(
    row
  );

  row
    .querySelectorAll(
      "input, select"
    )
    .forEach(
      element => {
        element.addEventListener(
          "input",
          calculateQuoteTotals
        );

        element.addEventListener(
          "change",
          calculateQuoteTotals
        );
      }
    );

  row
    .querySelector(
      ".quote-item-remove"
    )
    ?.addEventListener(
      "click",
      () => {
        row.remove();

        calculateQuoteTotals();
      }
    );

  calculateQuoteTotals();
}


const addQuoteItemButton =
  $("addQuoteItem");

if (addQuoteItemButton) {
  addQuoteItemButton.addEventListener(
    "click",
    addQuoteItem
  );
}


// =========================================================
// CALCULAR TOTALES
// =========================================================

function calculateQuoteTotals() {
  let subtotal =
    0;

  document
    .querySelectorAll(
      "#quoteItems .quote-item"
    )
    .forEach(
      row => {
        const quantity =
          Number(
            row.querySelector(
              ".quote-item-quantity"
            )?.value
          ) || 0;

        const price =
          Number(
            row.querySelector(
              ".quote-item-price"
            )?.value
          ) || 0;

        const total =
          quantity * price;

        subtotal +=
          total;

        const totalElement =
          row.querySelector(
            ".quote-item-total"
          );

        if (totalElement) {
          totalElement.textContent =
            formatQuoteMoney(
              total
            );
        }
      }
    );

  const discount =
    Number(
      $("quoteDiscount")?.value
    ) || 0;

  const total =
    Math.max(
      0,
      subtotal - discount
    );

  if ($("quoteSubtotal")) {
    $("quoteSubtotal").textContent =
      formatQuoteMoney(
        subtotal
      );
  }

  if ($("quoteTotal")) {
    $("quoteTotal").textContent =
      formatQuoteMoney(
        total
      );
  }
}


const quoteDiscount =
  $("quoteDiscount");

if (quoteDiscount) {
  quoteDiscount.addEventListener(
    "input",
    calculateQuoteTotals
  );
}


// =========================================================
// CERRAR MODAL CREAR PRESUPUESTO
// =========================================================

function closeCreateQuoteModal() {
  $("createQuoteModal").style.display =
    "none";

  editingQuoteId = null;

  $("createQuoteModalTitle").textContent =
    "Crear presupuesto";

  $("saveQuoteButton").textContent =
    "⚡ Guardar presupuesto";
}


const closeCreateQuoteButton =
  $("closeCreateQuoteModal");

if (closeCreateQuoteButton) {
  closeCreateQuoteButton.addEventListener(
    "click",
    closeCreateQuoteModal
  );
}


// =========================================================
// CREAR PRESUPUESTO
// =========================================================

const createQuoteForm =
  $("createQuoteForm");

if (createQuoteForm) {
  createQuoteForm.addEventListener(
    "submit",
    async function(e) {
      e.preventDefault();

      const items = [];

      document
        .querySelectorAll(
          "#quoteItems .quote-item"
        )
        .forEach(
          row => {
            const description =
              row.querySelector(
                ".quote-item-description"
              )?.value.trim();

            if (!description) {
              return;
            }

            items.push({
              description,

              quantity:
                Number(
                  row.querySelector(
                    ".quote-item-quantity"
                  )?.value
                ) || 0,

              unit:
                row.querySelector(
                  ".quote-item-unit"
                )?.value ||
                "unidad",

              unit_price:
                Number(
                  row.querySelector(
                    ".quote-item-price"
                  )?.value
                ) || 0
            });
          }
        );

      if (!items.length) {
        alert(
          "Agregá al menos un concepto."
        );

        return;
      }

      const quoteRequestId =
        Number(
          $("quoteRequestId")?.value
        );

      if (!quoteRequestId) {
        alert(
          "No se encontró la solicitud asociada."
        );

        return;
      }

      const data = {
        quote_request_id:
          quoteRequestId,

        issue_date:
          $("quoteIssueDate")?.value,

        expiration_date:
          $("quoteExpirationDate")?.value ||
          null,

        notes:
          $("quoteNotes")?.value.trim() ||
          "",

        discount:
          Number(
            $("quoteDiscount")?.value
          ) || 0,

        items
      };

      const button =
        this.querySelector(
          "button[type='submit']"
        );

      if (button) {
        button.disabled =
          true;

        button.textContent =
          "Creando...";
      }

      try {
       const isEditing =
  editingQuoteId !== null;

const url =
  isEditing
    ? `/api/admin/quotes/${editingQuoteId}`
    : "/api/admin/quotes";

const method =
  isEditing
    ? "PUT"
    : "POST";
const result = await api(
  url,
  {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  }
);

       if (isEditing) {
  alert(
    "Presupuesto actualizado correctamente."
  );
} else {
  alert(
    `Presupuesto ${result.quote_number} creado correctamente.`
  );
}

        closeCreateQuoteModal();

        this.reset();

        if ($("quoteItems")) {
          $("quoteItems").innerHTML =
            "";
        }

        await loadQuoteRequests();

        await loadQuotes();

      } catch (error) {
        console.error(
          "Error creando presupuesto:",
          error
        );

        alert(
          "❌ " +
          error.message
        );

      } finally {
  if (button) {
    button.disabled = false;

    button.textContent =
      editingQuoteId !== null
        ? "💾 Guardar cambios"
        : "⚡ Guardar presupuesto";
  }
}
    }
  );
}


// =========================================================
// CERRAR MODALES AL HACER CLICK AFUERA
// =========================================================

const quoteRequestModal =
  $("quoteRequestModal");

if (quoteRequestModal) {
  quoteRequestModal.addEventListener(
    "click",
    event => {
      if (
        event.target ===
        quoteRequestModal
      ) {
        closeQuoteRequestModal();
      }
    }
  );
}


const createQuoteModal =
  $("createQuoteModal");

if (createQuoteModal) {
  createQuoteModal.addEventListener(
    "click",
    event => {
      if (
        event.target ===
        createQuoteModal
      ) {
        closeCreateQuoteModal();
      }
    }
  );
}
// =========================================================
// MODAL RESUMEN PRESUPUESTO
// =========================================================

const quoteSummaryModal =
  $("quoteSummaryModal");

if (quoteSummaryModal) {

  quoteSummaryModal.addEventListener(
    "click",
    event => {

      if (
        event.target ===
        quoteSummaryModal
      ) {
        closeQuoteSummaryModal();
      }

    }
  );

}

// =========================================================
// LOGOUT
// =========================================================

const logoutBtn =
  $("logout");

if (logoutBtn) {
  logoutBtn.onclick =
    async () => {
      try {
        await api(
          "/api/logout",
          {
            method: "POST"
          }
        );
      } finally {
        location.href =
          "/login.html";
      }
    };
}


