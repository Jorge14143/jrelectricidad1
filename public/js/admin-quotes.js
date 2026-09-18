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
    vencido: "Vencido"
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

// =========================================================
// FORMATO MONEDA PRESUPUESTOS
// =========================================================

function formatQuoteMoney(value) {
  return Number(value || 0).toLocaleString(
    "es-AR",
    {
      style: "currency",
      currency: "ARS"
    }
  );
}


// =========================================================
// CARGAR SOLICITUDES
// =========================================================
async function loadQuoteRequests() {
  const container = $("quoteRequestsList");
  const loading = $("quoteRequestsLoading");
  const pendingCounter = $("pendingQuotesCount");
  const pendingBadge = $("pendingQuotesBadge");

  if (!container) {
    console.error("No existe #quoteRequestsList");
    return;
  }

  // Mostrar loader inicial
  if (loading) {
    loading.style.display = "flex";
  }

  try {
    const params = new URLSearchParams();

    const search = $("quoteRequestSearch")?.value.trim() || "";
    const statusFilter = $("quoteRequestStatusFilter")?.value || "";
    const dateFrom = $("quoteRequestDateFrom")?.value || "";
    const dateTo = $("quoteRequestDateTo")?.value || "";

    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    const query = params.toString();
    const data = await api(
      "/api/admin/quote-requests" +
      (query ? "?" + query : "")
    );

    console.log("Solicitudes recibidas:", data);

    quoteRequests = Array.isArray(data)
      ? data
      : (
          Array.isArray(data.requests)
            ? data.requests
            : []
        );

    const pendingCount = quoteRequests.filter(
      request => request.status === "pendiente"
    ).length;

    if (pendingCounter) {
  pendingCounter.textContent = pendingCount;
}

if (pendingBadge) {
  pendingBadge.textContent = pendingCount;
}

    // Ocultar loader
    if (loading) {
    loading.style.display = "none";
	 }
    // Limpiar solamente la lista
    container.innerHTML = "";

    if (!quoteRequests.length) {
      container.innerHTML = `
        <div class="empty-state">

          <div class="empty-state-icon">
            📋
          </div>

          <h3>
            No hay solicitudes
          </h3>

          <p>
            Todavía no recibiste ninguna solicitud de presupuesto.
          </p>

        </div>
      `;

      return;
    }

    quoteRequests.forEach(request => {
      container.insertAdjacentHTML(
        "beforeend",
        renderQuoteRequest(request)
      );
    });

  } catch (error) {
    console.error(
      "Error cargando solicitudes:",
      error
    );

    // Ocultar loader también si hay error
    if (loading) {
      loading.style.display = "none";
    }

    container.innerHTML = `
      <div class="empty-state">

        <div class="empty-state-icon">
          ⚠️
        </div>

        <h3>
          Error al cargar solicitudes
        </h3>

        <p>
          ${escapeHtml(error.message)}
        </p>

        <button
          type="button"
          class="admin-btn"
          onclick="loadQuoteRequests()"
        >
          🔄 Reintentar
        </button>

      </div>
      `;
  }

}

// =========================================================
// MOSTRAR SOLICITUD
// =========================================================

function renderQuoteRequest(request) {
  const statusLabels = {
    pendiente:
      "🟡 Pendiente",

    contactado:
      "🔵 Contactado",

    presupuestado:
      "🟢 Presupuestado",

    cerrado:
      "⚫ Cerrado"
  };

  const status =
    statusLabels[request.status] ||
    request.status ||
    "Pendiente";

  const date =
    request.created_at
      ? new Date(
          request.created_at
        ).toLocaleString(
          "es-AR",
          {
            dateStyle: "short",
            timeStyle: "short"
          }
        )
      : "Sin fecha";

  const initials =
    (request.name || "C")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(
        word =>
          word.charAt(0).toUpperCase()
      )
      .join("");

  return `
    <article class="quote-request-card">

      <div class="quote-request-card-header">

        <div class="quote-request-client">

          <div class="quote-request-avatar">
            ${escapeHtml(initials)}
          </div>

          <div>

            <h3>
              ${escapeHtml(request.name)}
            </h3>

            <div class="quote-request-number">
              Solicitud #${request.id}
            </div>

          </div>

        </div>

        <span class="quote-status">
          ${escapeHtml(status)}
        </span>

      </div>

      <div class="quote-request-info">

        <div class="quote-request-info-row">

          <span>📱</span>

          <span>
            ${escapeHtml(request.phone)}
          </span>

        </div>

        ${
          request.email
            ? `
              <div class="quote-request-info-row">

                <span>✉️</span>

                <span>
                  ${escapeHtml(request.email)}
                </span>

              </div>
            `
            : ""
        }

      </div>

      <div class="quote-request-service">

        <span class="quote-request-service-label">
          Servicio solicitado
        </span>

        <strong>
          ${
            escapeHtml(
              request.service ||
              "Servicio no especificado"
            )
          }
        </strong>

      </div>

      <p class="quote-request-description">
        ${
          escapeHtml(
            request.description ||
            "Sin descripción."
          )
        }
      </p>

      <div class="quote-request-footer">

        <span class="quote-request-date">
          🕐
          ${escapeHtml(date)}
        </span>

        <div class="quote-request-actions">

          <button
            type="button"
            class="quote-view-btn"
            onclick="openQuoteRequest(${request.id})"
          >
            👁 Ver solicitud
          </button>

          ${
            request.status === "pendiente" ||
            request.status === "contactado"
              ? `
                <button
                  type="button"
                  class="quote-create-btn"
                  onclick="startCreateQuote(${request.id})"
                >
                  💰 Crear presupuesto
                </button>
              `
              : ""
          }

        </div>

      </div>

    </article>
  `;
}


// =========================================================
// ABRIR SOLICITUD
// =========================================================

async function openQuoteRequest(id) {
  try {
    const request =
      await api(
        `/api/admin/quote-requests/${id}`
      );

    currentQuoteRequest =
      request;

    const detail =
      $("quoteRequestDetail");

    if (!detail) {
      throw new Error(
        "No existe el contenedor de detalle de la solicitud."
      );
    }

    const statusLabels = {
      pendiente:
        "🟡 Pendiente",

      contactado:
        "🔵 Contactado",

      presupuestado:
        "🟢 Presupuestado",

      cerrado:
        "⚫ Cerrado"
    };

    const status =
      statusLabels[request.status] ||
      request.status ||
      "Pendiente";

    const createdDate =
      request.created_at
        ? new Date(
            request.created_at
          ).toLocaleString(
            "es-AR",
            {
              dateStyle: "long",
              timeStyle: "short"
            }
          )
        : "No disponible";

    let preferredDate =
      "No indicada";

    if (request.preferred_date) {
      const raw =
        String(
          request.preferred_date
        ).slice(0, 10);

      const parts =
        raw.split("-");

      if (parts.length === 3) {
        preferredDate =
          new Date(
            Number(parts[0]),
            Number(parts[1]) - 1,
            Number(parts[2])
          ).toLocaleDateString(
            "es-AR",
            {
              dateStyle: "long"
            }
          );
      }
    }

    detail.innerHTML = `
      <div class="quote-detail-modern">

        <div class="quote-detail-header">

          <div>

            <span class="quote-section-label">
              SOLICITUD DE PRESUPUESTO
            </span>

            <h2>
              Solicitud #${request.id}
            </h2>

          </div>

          <div class="quote-request-status-control">
            <label for="quoteRequestStatus">Estado</label>
            <select id="quoteRequestStatus">
              <option value="pendiente" ${request.status === "pendiente" ? "selected" : ""}>Pendiente</option>
              <option value="contactado" ${request.status === "contactado" ? "selected" : ""}>Contactado</option>
              <option value="presupuestado" ${request.status === "presupuestado" ? "selected" : ""}>Presupuestado</option>
              <option value="cerrado" ${request.status === "cerrado" ? "selected" : ""}>Cerrado</option>
            </select>
          </div>

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
                ${escapeHtml(request.name)}
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
                  ${escapeHtml(request.phone)}
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
                  ${
                    escapeHtml(
                      request.email ||
                      "No indicado"
                    )
                  }
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
                TRABAJO SOLICITADO
              </span>

              <h3>
                ${
                  escapeHtml(
                    request.service ||
                    "Servicio no especificado"
                  )
                }
              </h3>

            </div>

          </div>

          <div class="quote-date-box">

            <span>
              📅
            </span>

            <div>

              <small>
                Fecha preferida
              </small>

              <strong>
                ${escapeHtml(preferredDate)}
              </strong>

            </div>

          </div>

        </div>

        <div class="quote-detail-block">

          <div class="quote-detail-block-title">

            <span class="quote-detail-block-icon">
              📝
            </span>

            <div>

              <span class="quote-detail-block-label">
                DESCRIPCIÓN DEL TRABAJO
              </span>

            </div>

          </div>

          <div class="quote-description-modern">
            ${
              escapeHtml(
                request.description ||
                "El cliente no agregó una descripción."
              )
            }
          </div>

        </div>

        <div class="quote-request-created">

          🕐 Solicitud recibida el

          <strong>
            ${escapeHtml(createdDate)}
          </strong>

        </div>

        <div class="quote-detail-actions-modern">

          <button
            type="button"
            class="quote-modal-secondary"
            onclick="closeQuoteRequestModal()"
          >
            Cerrar
          </button>

          ${
            request.status === "pendiente" ||
            request.status === "contactado"
              ? `
                <button
                  type="button"
                  class="quote-create-large"
                  onclick="startCreateQuote(${request.id})"
                >
                  💰 Crear presupuesto
                </button>
              `
              : ""
          }

        </div>

      </div>
    `;

    const modal =
      $("quoteRequestModal");

    if (!modal) {
      throw new Error(
        "No existe el modal de solicitud."
      );
    }

    modal.style.display =
      "flex";

    modal.classList.add(
      "active"
    );

  } catch (error) {
    console.error(
      "Error abriendo solicitud:",
      error
    );

    alert(
      "No se pudo cargar la solicitud: " +
      error.message
    );
  }
}


// =========================================================
// CERRAR MODAL SOLICITUD
// =========================================================

async function updateQuoteRequestStatus(id, status) {
  try {
    await api(`/api/admin/quote-requests/${id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });

    const request = quoteRequests.find(
      item => Number(item.id) === Number(id)
    );

    if (request) {
      request.status = status;
    }

    showMsg("Estado de la solicitud actualizado correctamente.");
    await loadQuoteRequests();

  } catch (error) {
    console.error(
      "Error actualizando estado de solicitud:",
      error
    );

    showMsg(
      "No se pudo actualizar el estado: " + error.message,
      true
    );
  }
}


function closeQuoteRequestModal() {
  const modal =
    $("quoteRequestModal");

  if (!modal) {
    return;
  }

  modal.classList.remove(
    "active"
  );

  modal.style.display =
    "none";
}


document.addEventListener("change", event => {
  if (event.target.id === "quoteRequestStatus" && currentQuoteRequest) {
    updateQuoteRequestStatus(
      currentQuoteRequest.id,
      event.target.value
    );
  }
});

function setupQuoteRequestFilters() {
  const search = $("quoteRequestSearch");
  const status = $("quoteRequestStatusFilter");
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

  [status, dateFrom, dateTo].forEach(control => {
    if (control) control.addEventListener("change", reload);
  });

  if (refresh) {
    refresh.addEventListener("click", reload);
  }
}

const closeQuoteRequestButton =
  $("closeQuoteRequestModal");

if (closeQuoteRequestButton) {
  closeQuoteRequestButton.addEventListener(
    "click",
    closeQuoteRequestModal
  );
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


