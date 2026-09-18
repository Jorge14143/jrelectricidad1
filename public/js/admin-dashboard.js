// =========================================================
// CARGAR PANEL
// =========================================================

async function load() {
  try {
    const [
      users,
      services,
      stats
    ] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/services"),
      api("/api/admin/stats")
    ]);

    await loadClients();

    // =====================================================
    // ESTADÍSTICAS
    // =====================================================

    if ($("statUsers")) {
      $("statUsers").textContent = stats.users;
    }

    if ($("statServices")) {
      $("statServices").textContent = stats.services;
    }

    if ($("statActive")) {
      $("statActive").textContent = stats.activeServices;
    }
if ($("statAcceptedQuotes")) {
  $("statAcceptedQuotes").textContent =
    stats.acceptedQuotes;
}

if ($("statJobsInProgress")) {
  $("statJobsInProgress").textContent =
    stats.jobsInProgress;
}

if ($("statCompletedJobs")) {
  $("statCompletedJobs").textContent =
    stats.completedJobs;
}
async function loadClients() {
  const container = $("clients");
  const loading = $("clientsLoading");
  const empty = $("clientsEmpty");

  if (!container) return;

  try {
    if (loading) loading.hidden = false;
    if (empty) empty.hidden = true;

    const search = $("clientsSearch")?.value.trim() || "";
    const query = search
      ? "?search=" + encodeURIComponent(search)
      : "";

    const data = await api("/api/admin/clients" + query);
    const clients = Array.isArray(data.clients) ? data.clients : [];

    container.innerHTML = "";

    if (!clients.length) {
      if (empty) empty.hidden = false;
      return;
    }

    container.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Contacto</th>
            <th>Solicitudes</th>
            <th>Presupuestos</th>
            <th>Última actividad</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${clients.map(client => `
            <tr>
              <td>
                <strong>${h(client.name || "Sin nombre")}</strong>
              </td>
              <td>
                <div>${h(client.phone || "Sin teléfono")}</div>
                <small>${h(client.email || "Sin email")}</small>
              </td>
              <td>${Number(client.requests || 0)}</td>
              <td>${Number(client.quotes || 0)}</td>
              <td>${client.last_activity ? new Date(client.last_activity).toLocaleDateString("es-AR") : "-"}</td>
              <td class="row-actions">
                <button
                  type="button"
                  class="btn tiny"
                  data-client-action="detail"
                  data-client-phone="${h(client.phone || "")}"
                  data-client-email="${h(client.email || "")}"
                >
                  Ver ficha
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

  } catch (error) {
    console.error("Error cargando clientes:", error);
    container.innerHTML = `
      <div class="admin-error">${h(error.message)}</div>
    `;
  } finally {
    if (loading) loading.hidden = true;
  }
}

function setupClients() {
  const search = $("clientsSearch");
  const refresh = $("refreshClients");
  const clear = $("clearClientsSearch");
  const container = $("clients");

  if (search) {
    let timer;

    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadClients(), 250);
    });
  }

  if (refresh) {
    refresh.addEventListener("click", () => loadClients());
  }

  if (clear) {
    clear.addEventListener("click", () => {
      if (search) search.value = "";
      loadClients();
    });
  }

  if (container) {
    container.addEventListener("click", event => {
      const button = event.target.closest("[data-client-action='detail']");
      if (!button) return;

      loadClientDetail(
        button.dataset.clientPhone || "",
        button.dataset.clientEmail || ""
      );
    });
  }

  const closeButton = $("closeClientDetail");
  const closeFooterButton = $("closeClientDetailButton");

  closeButton?.addEventListener("click", closeClientDetail);
  closeFooterButton?.addEventListener("click", closeClientDetail);
}

function closeClientDetail() {
  const modal = $("clientDetailModal");
  if (modal) modal.hidden = true;
}

async function loadClientDetail(phone, email) {
  const modal = $("clientDetailModal");
  const loading = $("clientDetailLoading");
  const errorBox = $("clientDetailError");
  const content = $("clientDetailContent");

  if (!modal || !phone) return;

  modal.hidden = false;
  if (loading) loading.hidden = false;
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }
  if (content) content.hidden = true;

  try {
    const params = new URLSearchParams({
      phone,
      email
    });

    const data = await api(
      "/api/admin/clients/detail?" + params.toString()
    );

    const client = data.client || {};

    $("clientDetailTitle").textContent =
      client.name || "Ficha del cliente";

    $("clientDetailContact").textContent =
      [client.phone, client.email].filter(Boolean).join(" · ") || "-";

    $("clientDetailRequests").textContent =
      client.requests ?? 0;

    $("clientDetailQuotes").textContent =
      client.quotes ?? 0;

    $("clientDetailJobs").textContent =
      client.totalJobs ?? 0;

    $("clientDetailCompletedJobs").textContent =
      client.completedJobs ?? 0;

    $("clientDetailTotal").textContent =
      money(client.totalQuoted);

    const requests = Array.isArray(data.requests)
      ? data.requests
      : [];

    $("clientDetailRequestsList").innerHTML =
      requests.length
        ? requests.map(item => `
          <div class="job-detail-section">
            <strong>${h(item.service || "Solicitud de presupuesto")}</strong>
            <p>${h(item.description || "Sin descripción")}</p>
            <small>
              Estado: ${h(item.status || "-")}
              · ${item.created_at ? new Date(item.created_at).toLocaleDateString("es-AR") : "-"}
            </small>
          </div>
        `).join("")
        : "<p class=\"muted\">No hay solicitudes.</p>";

    const quotes = Array.isArray(data.quotes)
      ? data.quotes
      : [];

    $("clientDetailQuotesList").innerHTML =
      quotes.length
        ? quotes.map(item => `
          <div class="job-detail-section">
            <div class="job-detail-grid">
              <div>
                <span>Presupuesto</span>
                <strong>${h(item.quote_number || "-")}</strong>
              </div>
              <div>
                <span>Estado</span>
                <strong>${h(item.status || "-")}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>${money(item.total)}</strong>
              </div>
              <div>
                <span>Trabajo</span>
                <strong>${h(item.job_status || "Sin trabajo")}</strong>
              </div>
            </div>
          </div>
        `).join("")
        : "<p class=\"muted\">No hay presupuestos.</p>";

    if (content) content.hidden = false;

  } catch (error) {
    console.error("Error cargando ficha del cliente:", error);

    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  } finally {
    if (loading) loading.hidden = true;
  }
}


    // =====================================================
    // USUARIOS
    // =====================================================

    if ($("users")) {
      $("users").innerHTML = users.length
        ? `
          <table class="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              ${users.map(x => `
                <tr>
                  <td>${h(x.name)}</td>

                  <td>${h(x.email)}</td>

                  <td>
                    <span class="role ${x.role}">
                      ${h(x.role)}
                    </span>
                  </td>

                  <td class="row-actions">

                    <button
                      class="btn tiny"
                      onclick="toggleRole(${x.id}, '${x.role}')"
                    >
                      ${
                        x.role === "admin"
                          ? "Hacer usuario"
                          : "Hacer admin"
                      }
                    </button>

                    <button
                      class="btn tiny danger"
                      onclick="deleteUser(${x.id}, '${h(x.name)}')"
                    >
                      Eliminar
                    </button>

                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `
        : `
          <p class="muted">
            No hay usuarios registrados.
          </p>
        `;
    }

    // =====================================================
    // SERVICIOS
    // =====================================================

    if ($("adminServices")) {
      $("adminServices").innerHTML = services.length
        ? services.map(x => `
          <div class="service-row ${x.active ? "" : "inactive"}">

            <div class="service-info">

              <div class="service-title-line">

                <b>${h(x.title)}</b>

                <span class="status ${x.active ? "on" : "off"}">
                  ${x.active ? "Activo" : "Oculto"}
                </span>

              </div>

              <small>
                ${h(x.description || "Sin descripción")}
              </small>

              <strong class="service-price">
                ${money(x.price)}
              </strong>

            </div>

            <div class="row-actions">

              <button
                class="btn tiny"
                onclick='editService(${JSON.stringify(x)})'
              >
                Editar
              </button>

              <button
                class="btn tiny ghost"
                onclick="toggleService(${x.id}, ${x.active ? 1 : 0})"
              >
                ${x.active ? "Ocultar" : "Publicar"}
              </button>

              <button
                class="btn tiny danger"
                onclick="del(${x.id})"
              >
                Eliminar
              </button>

            </div>

          </div>
        `).join("")
        : `
          <p class="muted">
            No hay servicios.
          </p>
        `;
    }

    // =====================================================
    // GALERÍA
    // =====================================================

    await loadGallery();

    // =====================================================
    // PRESUPUESTOS GUARDADOS
    // =====================================================

    await loadQuotes();

  } catch (e) {
    console.error("Error cargando panel:", e);

    showMsg(
      e.message,
      true
    );
  }
}


