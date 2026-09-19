(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const state = { page: 1, limit: 50 };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function filters() {
    return new URLSearchParams({
      page: state.page, limit: state.limit,
      q: $("auditSearch")?.value.trim() || "",
      action: $("auditActionFilter")?.value || "",
      entity_type: $("auditEntityFilter")?.value || "",
      date_from: $("auditDateFrom")?.value || "",
      date_to: $("auditDateTo")?.value || ""
    });
  }

  function renderRows(rows) {
    const body = $("auditTableBody");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">No hay registros para los filtros seleccionados.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(row => {
      const metadata = row.metadata ? JSON.stringify(row.metadata, null, 2) : "";
      return '<tr>' +
        '<td>' + esc(new Date(row.created_at).toLocaleString("es-AR")) + '</td>' +
        '<td>' + esc(row.actor_name || "Sistema") + '<small>' + esc(row.actor_email || "") + '</small></td>' +
        '<td><strong>' + esc(row.action) + '</strong></td>' +
        '<td>' + esc(row.entity_type || "—") + (row.entity_id ? '<small>#' + esc(row.entity_id) + '</small>' : "") + '</td>' +
        '<td>' + esc(row.ip_address || "—") + '</td>' +
        '<td title="' + esc(row.request_id || "") + '">' + esc(row.request_id || "—") + '</td>' +
        '<td><details><summary>Ver</summary><pre>' + esc(metadata || "Sin detalles") + '</pre></details></td>' +
        '</tr>';
    }).join("");
  }

  function populateSelect(id, values, label) {
    const el = $(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = '<option value="">' + esc(label) + '</option>' +
      values.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join("");
    el.value = values.includes(current) ? current : "";
  }

  async function loadAudit() {
    const stateEl = $("auditState");
    if (stateEl) { stateEl.style.display = ""; stateEl.textContent = "Cargando auditoría..."; }
    try {
      const data = await api("/api/admin/audit?" + filters().toString());
      renderRows(data.audit || []);
      populateSelect("auditActionFilter", data.filters?.actions || [], "Todas las acciones");
      populateSelect("auditEntityFilter", data.filters?.entity_types || [], "Todas las entidades");
      const total = Number(data.total || 0);
      const pages = Math.max(1, Number(data.total_pages || 1));
      if (stateEl) stateEl.style.display = "none";
      if ($("auditSummary")) $("auditSummary").textContent = total.toLocaleString("es-AR") + " registros · " + pages.toLocaleString("es-AR") + " página(s)";
      if ($("auditPageInfo")) $("auditPageInfo").textContent = "Página " + data.page + " de " + pages;
      if ($("auditPrevButton")) $("auditPrevButton").disabled = data.page <= 1;
      if ($("auditNextButton")) $("auditNextButton").disabled = data.page >= pages;
    } catch (error) {
      if (stateEl) { stateEl.style.display = ""; stateEl.textContent = error.message || "No se pudo cargar la auditoría."; }
    }
  }

  function exportAudit() {
    const params = filters();
    params.delete("page"); params.delete("limit"); params.delete("q");
    window.open("/api/admin/audit/export?" + params.toString(), "_blank", "noopener");
  }

  function setup() {
    if (!$("auditSection")) return;
    $("auditRefreshButton")?.addEventListener("click", () => { state.page = 1; loadAudit(); });
    $("auditPrevButton")?.addEventListener("click", () => { if (state.page > 1) { state.page--; loadAudit(); } });
    $("auditNextButton")?.addEventListener("click", () => { state.page++; loadAudit(); });
    $("auditExportButton")?.addEventListener("click", exportAudit);
    ["auditSearch","auditActionFilter","auditEntityFilter","auditDateFrom","auditDateTo"].forEach(id => {
      $(id)?.addEventListener(id === "auditSearch" ? "input" : "change", () => {
        state.page = 1;
        clearTimeout(window.auditSearchTimer);
        window.auditSearchTimer = setTimeout(loadAudit, id === "auditSearch" ? 250 : 0);
      });
    });
    window.loadAdminAudit = loadAudit;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();
