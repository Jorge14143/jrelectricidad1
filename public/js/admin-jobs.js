// =====================================================
// GESTIÓN DE TRABAJOS
// =====================================================

async function loadJobs() {
  const list = document.getElementById("jobsList");
  const loading = document.getElementById("jobsLoading");
  const empty = document.getElementById("jobsEmpty");

  if (!list) return;

  try {
    if (loading) loading.hidden = false;
    if (empty) empty.hidden = true;

    const search =
      document.getElementById("jobsSearch")?.value.trim() || "";

    const status =
      document.getElementById("jobsStatusFilter")?.value || "";

    const dateFrom =
      document.getElementById("jobsDateFrom")?.value || "";

    const dateTo =
      document.getElementById("jobsDateTo")?.value || "";

    const params = new URLSearchParams();

    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    const response = await fetch(
      `/api/admin/jobs?${params.toString()}`,
      {
        credentials: "same-origin"
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "No se pudieron cargar los trabajos."
      );
    }

    const jobs = Array.isArray(data.jobs)
      ? data.jobs
      : [];

    list.innerHTML = "";

    if (!jobs.length) {
      if (empty) empty.hidden = false;
      return;
    }

    jobs.forEach(job => {
      list.appendChild(createJobCard(job));
    });

  } catch (error) {

    console.error("Error cargando trabajos:", error);

    list.innerHTML = `
      <div class="admin-error">
        ${escapeHtml(error.message)}
      </div>
    `;

  } finally {

    if (loading) loading.hidden = true;
  }
}


function createJobCard(job) {

  const card = document.createElement("div");

  card.className = "job-card";

  const statusInfo = getJobStatusInfo(job.status);

  const total = Number(job.total || 0);

  const createdAt = formatJobDate(job.created_at);
  const startedAt = formatJobDate(job.started_at);
  const completedAt = formatJobDate(job.completed_at);

  let actions = "";

  if (job.status === "aceptado") {

    actions = `
      <button
        type="button"
        class="btn btn-primary btn-small"
        onclick="startJob(${job.id})"
      >
        🔧 Iniciar trabajo
      </button>
    `;

  } else if (job.status === "en_proceso") {

    actions = `
      <button
        type="button"
        class="btn btn-primary btn-small"
        onclick="closeJob(${job.id})"
      >
        ⚫ Cerrar trabajo
      </button>
    `;

  }
  actions += `
    <button
      type="button"
      class="btn btn-secondary btn-small"
      onclick="openJobDetail(${job.id})"
    >
      👁️ Ver detalle
    </button>
  `;
  card.innerHTML = `
    <div class="job-card-header">

      <div>

        <strong>
          ${escapeHtml(job.client_name || "Sin nombre")}
        </strong>

        <span class="job-quote-number">
          ${escapeHtml(job.quote_number || "")}
        </span>

      </div>

      <span class="job-status ${statusInfo.className}">
        ${statusInfo.label}
      </span>

    </div>


    <div class="job-card-body">

      <div class="job-info">

        <span>
          📞 ${escapeHtml(job.client_phone || "Sin teléfono")}
        </span>

        <span>
          ⚡ ${escapeHtml(job.requested_service || "Sin servicio")}
        </span>

      </div>


      <div class="job-description">

        <strong>Trabajo:</strong>

        <p>
          ${escapeHtml(job.work_description || "Sin descripción")}
        </p>

      </div>


      <div class="job-total">

        <span>Total</span>

        <strong>
          ${formatJobMoney(total)}
        </strong>

      </div>


      <div class="job-dates">

        <span>
          📅 Creado:
          ${createdAt}
        </span>

        ${
          startedAt
            ? `<span>🔧 Inicio: ${startedAt}</span>`
            : ""
        }

        ${
          completedAt
            ? `<span>⚫ Finalizado: ${completedAt}</span>`
            : ""
        }

      </div>

    </div>


    ${
      actions
        ? `
          <div class="job-card-actions">
            ${actions}
          </div>
        `
        : ""
    }

  `;

  return card;
}


function getJobStatusInfo(status) {

  const statuses = {

    pendiente_presupuesto: {
      label: "🟡 Pendiente de presupuesto",
      className: "status-pending"
    },

    presupuesto_enviado: {
      label: "🔵 Presupuesto enviado",
      className: "status-sent"
    },

    aceptado: {
      label: "🟢 Aceptado / confirmado",
      className: "status-accepted"
    },

    en_proceso: {
      label: "🔧 En proceso",
      className: "status-progress"
    },

    rechazado: {
      label: "🔴 Rechazado",
      className: "status-rejected"
    },

    cerrado: {
      label: "⚫ Cerrado",
      className: "status-closed"
    }

  };

  return statuses[status] || {
    label: status || "Desconocido",
    className: ""
  };
}


async function startJob(jobId) {

  const confirmed = confirm(
    "¿Querés iniciar este trabajo?"
  );

  if (!confirmed) return;

  try {

    const response = await fetch(
      `/api/admin/jobs/${jobId}/status`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({
          status: "en_proceso"
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "No se pudo iniciar el trabajo."
      );
    }

    alert(
      data.message || "Trabajo iniciado correctamente."
    );

    await loadJobs();

  } catch (error) {

    console.error("Error iniciando trabajo:", error);

    alert(error.message);
  }
}


async function closeJob(jobId) {

  const confirmed = confirm(
    "¿Confirmás que el trabajo fue terminado?\n\n" +
    "Al cerrarlo se guardará automáticamente la fecha y hora de finalización."
  );

  if (!confirmed) return;

  try {

    const response = await fetch(
      `/api/admin/jobs/${jobId}/status`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({
          status: "cerrado"
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "No se pudo cerrar el trabajo."
      );
    }

    alert(
      data.message || "Trabajo cerrado correctamente."
    );

    await loadJobs();

  } catch (error) {

    console.error("Error cerrando trabajo:", error);

    alert(error.message);
  }
}


function formatJobMoney(value) {

  const number = Number(value || 0);

  return number.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS"
  });
}


function formatJobDate(value) {

  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}


function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// =====================================================
// EVENTOS DE FILTROS
// =====================================================

function setupJobs() {

  const search = document.getElementById("jobsSearch");
  const status = document.getElementById("jobsStatusFilter");
  const dateFrom = document.getElementById("jobsDateFrom");
  const dateTo = document.getElementById("jobsDateTo");
  const showAll = document.getElementById("showAllJobs");
  const showClosed = document.getElementById("showClosedJobs");
  const refresh = document.getElementById("refreshJobs");
  const clear = document.getElementById("clearJobsFilters");

  if (!search) return;


  let searchTimer = null;

  search.addEventListener("input", () => {

    clearTimeout(searchTimer);

    searchTimer = setTimeout(() => {
      loadJobs();
    }, 350);

  });
showAll?.addEventListener("click", () => {
  if (status) status.value = "";
  loadJobs();
});

showClosed?.addEventListener("click", () => {
  if (status) status.value = "cerrado";
  loadJobs();
});

  status?.addEventListener("change", loadJobs);

  dateFrom?.addEventListener("change", loadJobs);

  dateTo?.addEventListener("change", loadJobs);

  refresh?.addEventListener("click", loadJobs);


  clear?.addEventListener("click", () => {

    search.value = "";

    if (status) status.value = "";
    if (dateFrom) dateFrom.value = "";
    if (dateTo) dateTo.value = "";

    loadJobs();
  });


  loadJobs();
  
}
// =====================================================
// DETALLE DEL TRABAJO
// =====================================================

async function openJobDetail(jobId) {

  const modal = document.getElementById("jobDetailModal");
  const loading = document.getElementById("jobDetailLoading");
  const errorBox = document.getElementById("jobDetailError");
  const content = document.getElementById("jobDetailContent");

  if (!modal) return;

  modal.hidden = false;

  if (loading) loading.hidden = false;
  if (errorBox) errorBox.hidden = true;
  if (content) content.hidden = true;

  try {

    const response = await fetch(
      `/api/admin/jobs/${jobId}`,
      {
        credentials: "same-origin"
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "No se pudo obtener el trabajo."
      );
    }

    const job = data.job;

    document.getElementById("jobDetailTitle").textContent =
      `Trabajo ${job.quote_number || ""}`;

    const statusInfo = getJobStatusInfo(job.status);

    document.getElementById("jobDetailStatus").textContent =
      statusInfo.label;

    document.getElementById("jobDetailClient").textContent =
      job.client_name || "-";

    document.getElementById("jobDetailPhone").textContent =
      job.client_phone || "-";

    document.getElementById("jobDetailEmail").textContent =
      job.client_email || "-";

    document.getElementById("jobDetailService").textContent =
      job.requested_service || "-";

    document.getElementById("jobDetailQuote").textContent =
      job.quote_number || "-";

    document.getElementById("jobDetailIssueDate").textContent =
      formatJobDateOnly(job.issue_date);

    document.getElementById("jobDetailDescription").textContent =
      job.work_description || "Sin descripción.";

    document.getElementById("jobDetailSubtotal").textContent =
      formatJobMoney(job.subtotal);

    document.getElementById("jobDetailDiscount").textContent =
      formatJobMoney(job.discount);

    document.getElementById("jobDetailTotal").textContent =
      formatJobMoney(job.total);

    document.getElementById("jobDetailCreated").textContent =
      formatJobDate(job.created_at) || "-";

    document.getElementById("jobDetailStarted").textContent =
      formatJobDate(job.started_at) || "-";

    document.getElementById("jobDetailCompleted").textContent =
      formatJobDate(job.completed_at) || "-";

    document.getElementById("jobDetailNotes").textContent =
      job.notes || "Sin observaciones.";

    const itemsContainer =
      document.getElementById("jobDetailItems");

    itemsContainer.innerHTML = "";

    if (Array.isArray(job.items) && job.items.length) {

      job.items.forEach(item => {

        const row = document.createElement("div");

        row.className = "job-detail-item";

        row.innerHTML = `
          <div>
            <strong>
              ${escapeHtml(item.description || "")}
            </strong>

            <span>
              ${Number(item.quantity || 0)}
              ${escapeHtml(item.unit || "")}
              ×
              ${formatJobMoney(item.unit_price)}
            </span>
          </div>

          <strong>
            ${formatJobMoney(item.total)}
          </strong>
        `;

        itemsContainer.appendChild(row);

      });

    } else {

      itemsContainer.innerHTML = `
        <div class="job-detail-empty">
          No hay conceptos registrados.
        </div>
      `;

    }

    if (loading) loading.hidden = true;
    if (content) content.hidden = false;

  } catch (error) {

    console.error(
      "Error obteniendo detalle del trabajo:",
      error
    );

    if (loading) loading.hidden = true;

    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }

  }

}


function closeJobDetail() {
  const modal =
    document.getElementById("jobDetailModal");

  if (!modal) return;

  modal.hidden = true;

  const loading =
    document.getElementById("jobDetailLoading");

  const errorBox =
    document.getElementById("jobDetailError");

  const content =
    document.getElementById("jobDetailContent");

  if (loading) {
    loading.hidden = true;
  }

  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  if (content) {
    content.hidden = true;
  }
}


function formatJobDateOnly(value) {

  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

}
// =====================================================
// HISTORIAL DE TRABAJOS CERRADOS
// =====================================================

async function loadJobsHistory() {
  const list = document.getElementById("jobsHistoryList");
  const loading = document.getElementById("jobsHistoryLoading");
  const empty = document.getElementById("jobsHistoryEmpty");

  if (!list) return;

  try {
    if (loading) loading.hidden = false;
    if (empty) empty.hidden = true;

    const response = await fetch(
      "/api/admin/jobs-history",
      {
        credentials: "same-origin"
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "No se pudo cargar el historial."
      );
    }

    const jobs = Array.isArray(data.jobs)
      ? data.jobs
      : [];

    list.innerHTML = "";

    if (!jobs.length) {
      if (empty) empty.hidden = false;
      return;
    }

    jobs.forEach(job => {
      list.appendChild(createHistoryCard(job));
    });

  } catch (error) {
    console.error(
      "Error cargando historial:",
      error
    );

    list.innerHTML = `
      <div class="admin-error">
        ${escapeHtml(error.message)}
      </div>
    `;

  } finally {
    if (loading) loading.hidden = true;
  }
}


function createHistoryCard(job) {
  const card = document.createElement("div");

  card.className = "job-history-card";

  const total = Number(job.total || 0);

  const completedAt =
    formatJobDate(job.completed_at);

  const startedAt =
    formatJobDate(job.started_at);

  card.innerHTML = `
    <div class="job-history-header">

      <div>
        <strong>
          ${escapeHtml(
            job.client_name || "Sin nombre"
          )}
        </strong>

        <span class="job-quote-number">
          ${escapeHtml(
            job.quote_number || ""
          )}
        </span>
      </div>

      <span class="job-status status-closed">
        ⚫ Cerrado
      </span>

    </div>


    <div class="job-history-body">

      <div class="job-history-info">

        <span>
          📞
          ${escapeHtml(
            job.client_phone ||
            "Sin teléfono"
          )}
        </span>

        <span>
          ⚡
          ${escapeHtml(
            job.requested_service ||
            "Sin servicio"
          )}
        </span>

      </div>


      <div class="job-history-work">

        <strong>
          Trabajo realizado
        </strong>

        <p>
          ${escapeHtml(
            job.work_description ||
            "Sin descripción"
          )}
        </p>

      </div>


      <div class="job-history-dates">

        <div>
          <span>📅 Presupuesto</span>

          <strong>
            ${formatJobDateOnly(
              job.issue_date
            )}
          </strong>
        </div>

        <div>
          <span>🔧 Inicio</span>

          <strong>
            ${startedAt || "-"}
          </strong>
        </div>

        <div>
          <span>⚫ Finalización</span>

          <strong>
            ${completedAt || "-"}
          </strong>
        </div>

      </div>


      <div class="job-history-total">

        <span>
          Total
        </span>

        <strong>
          ${formatJobMoney(total)}
        </strong>

      </div>


      <div class="job-history-actions">

        <button
          type="button"
          class="btn btn-secondary btn-small"
          onclick="openJobDetail(${job.id})"
        >
          👁️ Ver detalle
        </button>

      </div>

    </div>
  `;

  return card;
}


function setupJobsHistory() {
  const list =
    document.getElementById("jobsHistoryList");

  if (!list) return;

  loadJobsHistory();

  const closeButton =
    document.getElementById("closeJobDetail");

  const closeFooterButton =
    document.getElementById(
      "closeJobDetailButton"
    );

  const modal =
    document.getElementById("jobDetailModal");

  closeButton?.addEventListener(
    "click",
    closeJobDetail
  );

  closeFooterButton?.addEventListener(
    "click",
    closeJobDetail
  );

  modal?.addEventListener(
    "click",
    event => {
      if (event.target === modal) {
        closeJobDetail();
      }
    }
  );
}
function setupClients() {
  $("refreshClients")?.addEventListener("click", loadClients);

  $("clearClientsSearch")?.addEventListener("click", () => {
    if ($("clientsSearch")) $("clientsSearch").value = "";
    loadClients();
  });

  $("clientsSearch")?.addEventListener("keydown", event => {
    if (event.key === "Enter") loadClients();
  });
}


