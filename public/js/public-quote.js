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

        const actionsHtml = showActions
          ? `
            <div id="quoteActions" class="quote-actions">

              <button
                type="button"
                class="quote-reject-btn"
                onclick="respondQuote('reject')"
              >
                ✕ Rechazar presupuesto
              </button>

              <button
                type="button"
                class="quote-accept-btn"
                onclick="respondQuote('accept')"
              >
                ✓ Aceptar presupuesto
              </button>

            </div>

            <div
              id="quoteResponse"
              class="quote-response"
            ></div>
          `
          : "";

        /*
          =====================================================
          HTML PRINCIPAL
          =====================================================
        */

        quoteContainer.innerHTML = `

          <div class="quote-card">

            <header class="quote-header">

              <div class="quote-brand">
                ⚡ JR ELECTRICIDAD
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

                    </div>
                  `
                  : ""
              }


              <div
                style="
                  margin-top:24px;
                  color:#858e9b;
                  font-size:12px;
                "
              >

                <strong style="color:#b9c0ca;">
                  Fecha de emisión:
                </strong>

                ${formatDate(quote.issue_date)}

                ${
                  quote.expiration_date
                    ? `
                      &nbsp;&nbsp;|&nbsp;&nbsp;

                      <strong style="color:#b9c0ca;">
                        Vencimiento:
                      </strong>

                      ${formatDate(quote.expiration_date)}
                    `
                    : ""
                }

                &nbsp;&nbsp;|&nbsp;&nbsp;

                <strong style="color:#b9c0ca;">
                  Estado:
                </strong>

                ${escapeHtml(
                  getStatusText(quote.status)
                )}

              </div>


              ${actionsHtml}

            </section>

          </div>
        `;

      } catch (error) {

        console.error(
          "Error cargando presupuesto:",
          error
        );

        quoteContainer.innerHTML = `
          <div class="quote-card">

            <div class="quote-error">

              <div style="
                font-size:32px;
                margin-bottom:12px;
              ">
                ⚠
              </div>

              <div style="
                font-size:16px;
                font-weight:800;
                margin-bottom:8px;
              ">
                No se pudo cargar el presupuesto
              </div>

              <div>
                ${escapeHtml(error.message)}
              </div>

            </div>

          </div>
        `;
      }
    }

    /*
      =========================================================
      ACEPTAR / RECHAZAR
      =========================================================
    */

    async function respondQuote(action) {

      const actionContainer =
        document.getElementById("quoteActions");

      const responseBox =
        document.getElementById("quoteResponse");

      if (!actionContainer || !responseBox) {
        console.error(
          "No se encontraron los controles del presupuesto."
        );

        return;
      }

      let message = "";

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
