(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let creating = false;
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }
  function formatBytes(value) {
    const n = Number(value || 0);
    if (!n) return "0 B";
    const units = ["B","KB","MB","GB","TB"];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return (n / Math.pow(1024, i)).toFixed(i ? 2 : 0) + " " + units[i];
  }
  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("es-AR");
  }
  function setStatus(message, error = false) {
    const el = $("backupStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = "backup-status" + (error ? " is-error" : "");
  }
  async function loadBackups() {
    const list = $("backupsList");
    if (list) list.innerHTML = '<div class="backup-empty">Cargando backups...</div>';
    try {
      const response = await fetch("/api/admin/backups", { credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar los backups.");
      if ($("backupRetentionDays")) $("backupRetentionDays").textContent = data.retentionDays + " días";
      if ($("backupTotal")) $("backupTotal").textContent = String(data.total || 0);
      const rows = Array.isArray(data.backups) ? data.backups : [];
      if (!rows.length) {
        if (list) list.innerHTML = '<div class="backup-empty">Todavía no hay backups creados.</div>';
        return;
      }
      if (list) {
        list.innerHTML = rows.map(row => {
          const status = row.status === "completed" ? "Completado" : row.status;
          const actions = row.status === "completed"
            ? '<a class="btn btn-secondary" href="/api/admin/backups/' + Number(row.id) + '/download">⬇ Descargar</a>' +
              '<button type="button" class="btn backup-delete" data-id="' + Number(row.id) + '">🗑 Eliminar</button>'
            : "";
          return '<article class="backup-item">' +
            '<div class="backup-item-icon">💾</div>' +
            '<div class="backup-item-main">' +
            '<strong title="' + esc(row.filename) + '">' + esc(row.filename) + '</strong>' +
            '<small>' + formatDate(row.created_at) + ' · ' + formatBytes(row.size_bytes) + ' · ' + esc(status) + ' · ' + esc(row.created_by_name || "Sistema") + '</small>' +
            '<code title="' + esc(row.sha256 || "") + '">' + esc(row.sha256 || "Sin SHA-256") + '</code>' +
            '</div><div class="backup-item-actions">' + actions + '</div></article>';
        }).join("");
      }
      list?.querySelectorAll(".backup-delete").forEach(button => {
        button.addEventListener("click", () => deleteBackup(button.dataset.id));
      });
    } catch (error) {
      if (list) list.innerHTML = '<div class="backup-empty is-error">' + esc(error.message) + '</div>';
    }
  }
  async function createBackup() {
    if (creating) return;
    creating = true;
    const button = $("createBackupButton");
    if (button) { button.disabled = true; button.textContent = "⏳ Creando backup..."; }
    setStatus("Generando copia de seguridad. Esto puede tardar unos segundos...");
    try {
      const response = await fetch("/api/admin/backups", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: "{}"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo crear el backup.");
      setStatus("Backup creado: " + data.filename + " (" + formatBytes(data.size_bytes) + ").");
      await loadBackups();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      creating = false;
      if (button) { button.disabled = false; button.textContent = "💾 Crear backup ahora"; }
    }
  }
  async function cleanupBackups() {
    const button = $("cleanupBackupsButton");
    if (button) button.disabled = true;
    try {
      const response = await fetch("/api/admin/backups/cleanup", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: "{}"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo limpiar.");
      setStatus(data.message || "Limpieza completada.");
      await loadBackups();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }
  async function deleteBackup(id) {
    if (!confirm("¿Eliminar definitivamente este backup?")) return;
    try {
      const response = await fetch("/api/admin/backups/" + encodeURIComponent(id), {
        method: "DELETE", credentials: "same-origin"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar.");
      setStatus(data.message || "Backup eliminado.");
      await loadBackups();
    } catch (error) {
      setStatus(error.message, true);
    }
  }
  function setup() {
    if (!$("backupsSection")) return;
    $("createBackupButton")?.addEventListener("click", createBackup);
    $("cleanupBackupsButton")?.addEventListener("click", cleanupBackups);
    $("refreshBackupsButton")?.addEventListener("click", loadBackups);
    loadBackups();
  }
  window.loadAdminBackups = loadBackups;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();