"use strict";

    /*
      =========================================================
      PRESUPUESTO PÚBLICO
      =========================================================
    */

    const quoteContainer = document.getElementById("quoteContainer");

    /*
      Obtener token desde:

      /presupuesto/TOKEN
    */

    const pathParts = window.location.pathname
      .split("/")
      .filter(Boolean);

    const token = pathParts[pathParts.length - 1] || "";

    /*
      =========================================================
      FORMATO DE FECHA
      =========================================================
    */

    function formatDate(value) {
      if (!value) {
        return "-";
      }

      /*
        Si MySQL devuelve un objeto Date,
        usamos UTC para evitar que Argentina
        cambie el día por zona horaria.
      */

      if (value instanceof Date) {
        const day = String(value.getUTCDate()).padStart(2, "0");
        const month = String(value.getUTCMonth() + 1).padStart(2, "0");
        const year = value.getUTCFullYear();

        return `${day}/${month}/${year}`;
      }

      const text = String(value).trim().slice(0, 10);

      const match = text.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

      if (match) {
        return `${match[3]}/${match[2]}/${match[1]}`;
      }

      return text;
    }

    function formatDateTime(value) {
      if (!value) return "-";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString("es-AR");
    }

    /*
      =========================================================
      FORMATO DE DINERO
      =========================================================
    */

    function formatMoney(value) {
      const number = Number(value) || 0;

      return number.toLocaleString("es-AR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    /*
      =========================================================
      ESCAPE HTML
      =========================================================
    */

    function escapeHtml(value) {
      if (value === null || value === undefined) {
        return "";
      }

      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    /*
      =========================================================
      ESTADO
      =========================================================
    */

    function getStatusText(status) {
      switch (status) {
        case "borrador":
          return "Pendiente de respuesta";

        case "enviado":
          return "Enviado";

        case "aceptado":
          return "Aceptado";

        case "rechazado":
          return "Rechazado";

        case "vencido":
          return "Vencido";

        case "cerrado":
          return "Cerrado";

        default:
          return status || "-";
      }
    }

    /*
      =========================================================
      CARGAR PRESUPUESTO
      =========================================================
    */

    async function loadQuote() {

      if (!token) {
        quoteContainer.innerHTML = `
          <div class="quote-card">
            <div class="quote-error">
              Enlace de presupuesto inválido.
            </div>
          </div>
        `;

        return;
      }

      try {

        const response = await fetch(
          `/api/public/quotes/${encodeURIComponent(token)}`
        );

        if (!response.ok) {

          let errorMessage =
            "No se pudo cargar el presupuesto.";

          try {
            const errorData = await response.json();

            if (errorData && errorData.error) {
              errorMessage = errorData.error;
            }
          } catch (error) {
            // No hacemos nada.
          }

          throw new Error(errorMessage);
        }

        const quote = await response.json();

        let businessSettings = {
          business_name: "JR Electricidad",
          phone: "",
          email: ""
        };

        try {
          const settingsResponse = await fetch("/api/settings", {
            headers: { Accept: "application/json" }
          });

          if (settingsResponse.ok) {
            const settingsData = await settingsResponse.json();

            if (settingsData && settingsData.settings) {
              businessSettings = {
                ...businessSettings,
                ...settingsData.settings
              };
            }
          }
        } catch (settingsError) {
          console.warn(
            "No se pudo cargar la configuración pública:",
            settingsError
          );
        }

        if (!quote || !quote.id) {
          throw new Error(
            "El servidor no devolvió un presupuesto válido."
          );
        }

        /*
          =====================================================
          ITEMS
          =====================================================
        */

        const items = Array.isArray(quote.items)
          ? quote.items
          : [];

        let itemsHtml = "";

        if (items.length === 0) {

          itemsHtml = `
            <tr>
              <td colspan="4" style="text-align:center;">
                No hay conceptos cargados.
              </td>
            </tr>
          `;

        } else {

          itemsHtml = items.map(item => {

            const quantity =
              Number(item.quantity) || 0;

            const unitPrice =
              Number(item.unit_price) || 0;

            const total =
              Number(item.total) ||
              Number(item.item_total) ||
              quantity * unitPrice;

            return `
              <tr>
                <td>
                  ${escapeHtml(item.description || "-")}
                </td>

                <td>
                  ${escapeHtml(item.quantity ?? "-")}
                  ${escapeHtml(item.unit || "")}
                </td>

                <td>
                  $ ${formatMoney(unitPrice)}
                </td>

                <td>
                  $ ${formatMoney(total)}
                </td>
              </tr>
            `;

          }).join("");
        }

        /*
          =====================================================
          BOTONES
          =====================================================

          Solo aparecen mientras el presupuesto
          pueda recibir una respuesta.
        */

        const finalStatuses = [
          "aceptado",
          "rechazado",
          "cerrado"
        ];

        const showActions =
          !finalStatuses.includes(quote.status);

        const hasAcceptance = Boolean(quote.acceptance);
        const showActions =
          quote.status === "enviado" && !hasAcceptance;

        const actionsHtml = hasAcceptance
          ? `
            <div class="quote-response success">
              ✓ Esta propuesta ya fue ${escapeHtml(
                quote.acceptance.decision === "aceptado"
                  ? "aceptada"
                  : "rechazada"
              )}.
              <br>
              Fecha: ${escapeHtml(formatDateTime(quote.acceptance.created_at))}
            </div>
          `
          : showActions
            ? `
              <div id="quoteDecisionForm" class="quote-decision-form">
                <div class="quote-decision-title">Confirmar tu decisión</div>

                <label class="quote-label" for="publicCustomerName">Nombre completo</label>
                <input id="publicCustomerName" class="quote-input" type="text" maxlength="150" autocomplete="name" required>

                <label class="quote-label" for="publicCustomerEmail">Email</label>
                <input id="publicCustomerEmail" class="quote-input" type="email" maxlength="190" autocomplete="email" required>

                <label class="quote-label" for="publicCustomerPhone">Teléfono</label>
                <input id="publicCustomerPhone" class="quote-input" type="tel" maxlength="50" autocomplete="tel" required>

                <label class="quote-label" for="publicSignatureName">Firma digital — escribí tu nombre completo</label>
                <input id="publicSignatureName" class="quote-input" type="text" maxlength="150" autocomplete="name" required>

                <label class="quote-label" for="publicCustomerNote">Observación (opcional)</label>
                <textarea id="publicCustomerNote" class="quote-input" maxlength="2000"></textarea>

                <label class="quote-consent">
                  <input id="publicConsent" type="checkbox">
                  <span>Declaro que revisé el presupuesto, sus conceptos, importes y condiciones, y autorizo a JR Electricidad a registrar digitalmente mi decisión.</span>
                </label>

                <div id="quoteActions" class="quote-actions">
                  <button type="button" class="quote-reject-btn" data-action="reject">✕ Rechazar presupuesto</button>
                  <button type="button" class="quote-accept-btn" data-action="accept">✓ Aceptar presupuesto</button>
                </div>
              </div>

              <div id="quoteResponse" class="quote-response"></div>
            `
            : `
              <div class="quote-response">
                Este presupuesto no está disponible para una nueva decisión.
              </div>
            `;        /*
          =====================================================
          HTML PRINCIPAL
          =====================================================
        */

        quoteContainer.innerHTML = `

          <div class="quote-card">

            <header class="quote-header">

              <div class="quote-brand">
                ⚡ ${escapeHtml(businessSettings.business_name || "JR Electricidad")}
              </div>

              <div class="quote-subtitle">
                Presupuesto de trabajos eléctricos
              </div>

            </header>


            <section class="quote-content">

              <div class="quote-number">
                PRESUPUESTO ${escapeHtml(quote.quote_number)}
              </div>


              <div class="quote-client">

                <div class="quote-info">

                  <div class="quote-label">
                    Cliente
                  </div>

                  <div class="quote-value">
                    ${escapeHtml(
                      quote.client_name || "-"
                    )}
                  </div>

                </div>


                <div class="quote-info">

                  <div class="quote-label">
                    Teléfono
                  </div>

                  <div class="quote-value">
                    ${escapeHtml(
                      quote.client_phone || "-"
                    )}
                  </div>

                </div>


                <div class="quote-info">

                  <div class="quote-label">
                    Email
                  </div>

                  <div class="quote-value">
                    ${escapeHtml(
                      quote.client_email || "-"
                    )}
                  </div>

                </div>


                <div class="quote-info">

                  <div class="quote-label">
                    Servicio
                  </div>

                  <div class="quote-value">
                    ${escapeHtml(
                      quote.requested_service || "-"
                    )}
                  </div>

                </div>

              </div>


              <table class="quote-items">

                <thead>

                  <tr>
                    <th>Concepto</th>
                    <th>Cantidad</th>
                    <th>Precio unitario</th>
                    <th>Total</th>
                  </tr>

                </thead>

                <tbody>
                  ${itemsHtml}
                </tbody>

              </table>


              <div class="quote-totals">

                <div class="quote-total-row">

                  <span>
                    Subtotal
                  </span>

                  <strong>
                    $ ${formatMoney(quote.subtotal)}
                  </strong>

                </div>


                <div class="quote-total-row">

                  <span>
                    Descuento
                  </span>

                  <strong>
                    $ ${formatMoney(quote.discount)}
                  </strong>

                </div>


                <div class="quote-total-row quote-total-final">

                  <span>
                    TOTAL
                  </span>

                  <strong>
                    $ ${formatMoney(quote.total)}
                  </strong>

                </div>

              </div>


              ${
                quote.notes
                  ? `
                    <div class="quote-notes">

                      <div class="quote-notes-title">
                        Observaciones
                      </div>

                      <div class="quote-notes-text">
                        ${escapeHtml(quote.notes)}
                      </div>

                  async function respondQuote(action) {
      const actionContainer = document.getElementById("quoteActions");
      const responseBox = document.getElementById("quoteResponse");

      if (!actionContainer || !responseBox) return;

      if (!["accept","reject"].includes(action)) return;

      const name = document.getElementById("publicCustomerName")?.value.trim() || "";
      const email = document.getElementById("publicCustomerEmail")?.value.trim() || "";
      const phone = document.getElementById("publicCustomerPhone")?.value.trim() || "";
      const signatureName = document.getElementById("publicSignatureName")?.value.trim() || "";
      const note = document.getElementById("publicCustomerNote")?.value.trim() || "";
      const consent = Boolean(document.getElementById("publicConsent")?.checked);

      if (!name || !email || !phone || !signatureName) {
        responseBox.className = "quote-response error";
        responseBox.textContent = "Completá nombre, email, teléfono y firma digital.";
        return;
      }

      if (action === "accept" && !consent) {
        responseBox.className = "quote-response error";
        responseBox.textContent = "Para aceptar debés confirmar el consentimiento digital.";
        return;
      }

      const confirmed = confirm(
        action === "accept"
          ? "¿Querés aceptar este presupuesto y registrar esta decisión digitalmente?"
          : "¿Querés rechazar este presupuesto y registrar esta decisión digitalmente?"
      );
      if (!confirmed) return;

      const buttons = actionContainer.querySelectorAll("button");
      buttons.forEach(button => { button.disabled = true; });
      responseBox.className = "quote-response success";
      responseBox.textContent = action === "accept"
        ? "Registrando aceptación..."
        : "Registrando rechazo...";

      try {
        const response = await fetch(
          `/api/public/quotes/${encodeURIComponent(token)}/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              email,
              phone,
              signatureName,
              note,
              consent
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "No se pudo registrar la decisión.");
        }

        responseBox.className = "quote-response success";
        responseBox.textContent =
          data.message || "Decisión registrada correctamente.";

        actionContainer.style.display = "none";
        document.querySelector(".quote-decision-form")?.classList.add("completed");
      } catch (error) {
        console.error("Error respondiendo presupuesto:", error);
        responseBox.className = "quote-response error";
        responseBox.textContent =
          error.message || "No se pudo registrar la decisión.";

        buttons.forEach(button => { button.disabled = false; });
      }
    }

"";

      if (action === "accept") {

        const confirmed = confirm(
          "¿Querés aceptar este presupuesto?"
        );

        if (!confirmed) {
          return;
        }

        message = "Aceptando presupuesto...";

      } else if (action === "reject") {

        const confirmed = confirm(
          "¿Querés rechazar este presupuesto?"
        );

        if (!confirmed) {
          return;
        }

        message = "Rechazando presupuesto...";

      } else {
        return;
      }

      const buttons =
        actionContainer.querySelectorAll("button");

      buttons.forEach(button => {
        button.disabled = true;
      });

      responseBox.className = "quote-response success";
      responseBox.textContent = message;

      try {

        const response = await fetch(
          `/api/public/quotes/${encodeURIComponent(token)}/${action}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            }
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
            "No se pudo registrar la respuesta."
          );
        }

        responseBox.className =
          "quote-response success";

        responseBox.textContent =
          data.message ||
          (
            action === "accept"
              ? "✓ Presupuesto aceptado correctamente."
              : "✓ Presupuesto rechazado correctamente."
          );

        /*
          Ocultamos los botones después de responder.
        */

        actionContainer.style.display = "none";

      } catch (error) {

        console.error(
          "Error respondiendo presupuesto:",
          error
        );

        responseBox.className =
          "quote-response error";

        responseBox.textContent =
          error.message ||
          "No se pudo registrar la respuesta.";

        buttons.forEach(button => {
          button.disabled = false;
        });
      }
    }

    /*
      =========================================================
      INICIAR
      =========================================================
    */

    loadQuote();


document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  respondQuote(button.dataset.action);
});
