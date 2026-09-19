"use strict";

let adminDocuments = [];

const DOCUMENT_TYPE_LABELS = {
  quote_pdf: "Presupuesto PDF",
  job_report: "Informe de trabajo",
  work_completion: "Constancia de trabajo",
  client_attachment: "Adjunto de cliente",
  request_attachment: "Adjunto de solicitud",
  other: "Otro"
};

function documentEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function documentSize(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}

function documentDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("es-AR");
}

async function loadDocuments() {
  const list = $("documentsList");
  if (!list) return;

  list.innerHTML = '<p class="muted">Cargando documentos...</p>';

  try {
    const params = new URLSearchParams();
    const search = $("documentsSearch")?.value.trim();
    const type = $("documentsTypeFilter")?.value;
    if (search) params.set("q", search);
    if (type) params.set("type", type);

    const data = await api("/api/admin/documents?" + params.toString());
    adminDocuments = Array.isArray(data.documents) ? data.documents : [];
    renderDocuments();
  } catch (error) {
    console.error("Error cargando documentos:", error);
    list.innerHTML = '<p class="admin-error">' + documentEscape(error.message) + "</p>";
  }
}

function renderDocuments() {
  const list = $("documentsList");
  if (!list) return;

  if (!adminDocuments.length) {
    list.innerHTML = '<div class="documents-empty"><span>📄</span><p>No hay documentos que coincidan con los filtros.</p></div>';
    return;
  }

  list.innerHTML = adminDocuments.map(doc => {
    const label = DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type || "Otro";
    const relation = [
      doc.client_name ? "👤 " + documentEscape(doc.client_name) : "",
      doc.quote_id ? "📋 Presupuesto #" + Number(doc.quote_id) : "",
      doc.quote_request_id ? "📝 Solicitud #" + Number(doc.quote_request_id) : "",
      doc.job_id ? "🔧 Trabajo #" + Number(doc.job_id) : ""
    ].filter(Boolean).join(" · ");

    return `
      <article class="document-card">
        <div class="document-card-main">
          <div class="document-card-title">
            <div>
              <h3>${documentEscape(doc.title)}</h3>
              <span class="document-type-badge">${documentEscape(label)}</span>
            </div>
            <span class="document-version">v${Number(doc.current_version || 1)}</span>
          </div>
          <p>${documentEscape(doc.description || doc.original_name || "Sin descripción")}</p>
          <div class="document-meta">
            <span>📎 ${documentEscape(doc.original_name || "-")}</span>
            <span>💾 ${documentSize(doc.size_bytes)}</span>
            <span>🕒 ${documentDate(doc.updated_at || doc.version_created_at)}</span>
            ${relation ? '<span>' + relation + '</span>' : ""}
          </div>
          <small class="document-hash">SHA-256: ${documentEscape(doc.sha256 || "-")}</small>
        </div>
        <div class="document-card-actions">
          <button type="button" class="btn tiny" onclick="downloadDocument(${Number(doc.id)})">⬇️ Descargar</button>
          <button type="button" class="btn tiny ghost" onclick="showDocumentVersions(${Number(doc.id)})">🕘 Versiones</button>
          <button type="button" class="btn tiny ghost" onclick="addDocumentVersion(${Number(doc.id)})">➕ Nueva versión</button>
          <button type="button" class="btn tiny danger" onclick="deleteDocument(${Number(doc.id)})">🗑 Eliminar</button>
        </div>
      </article>
    `;
  }).join("");
}

async function uploadDocument(event) {
  event.preventDefault();

  const file = $("documentFile")?.files?.[0];
  if (!file) {
    showMsg("Seleccioná un archivo.", true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showMsg("El archivo supera el límite de 10 MB.", true);
    return;
  }

  const form = $("documentUploadForm");
  const data = new FormData(form);

  try {
    const result = await api("/api/admin/documents/upload", {
      method: "POST",
      body: data
    });
    showMsg("Documento guardado correctamente.");
    form.reset();
    await loadDocuments();
    return result;
  } catch (error) {
    showMsg(error.message || "No se pudo guardar el documento.", true);
  }
}

async function downloadDocument(id, version = null) {
  const params = version ? "?version=" + encodeURIComponent(version) : "";
  try {
    const response = await fetch("/api/admin/documents/" + Number(id) + "/download" + params, {
      credentials: "include"
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "No se pudo descargar el documento.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/i);
    const name = match ? match[1] : "documento";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showMsg(error.message || "No se pudo descargar el documento.", true);
  }
}

async function showDocumentVersions(id) {
  try {
    const data = await api("/api/admin/documents/" + Number(id));
    const versions = Array.isArray(data.versions) ? data.versions : [];

    if (!versions.length) {
      showMsg("Este documento no tiene versiones registradas.", true);
      return;
    }

    const lines = versions.map(v =>
      "v" + Number(v.version_number) +
      " — " + (v.original_name || "archivo") +
      " — " + documentSize(v.size_bytes) +
      " — " + documentDate(v.created_at)
    );

    alert("Historial de versiones\n\n" + lines.join("\n"));
  } catch (error) {
    showMsg(error.message || "No se pudo obtener el historial.", true);
  }
}

async function addDocumentVersion(id) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.txt,.doc,.docx,.xls,.xlsx";

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showMsg("El archivo supera el límite de 10 MB.", true);
      return;
    }

    const form = new FormData();
    form.append("file", file);

    try {
      await api("/api/admin/documents/" + Number(id) + "/versions", {
        method: "POST",
        body: form
      });
      showMsg("Nueva versión guardada correctamente.");
      await loadDocuments();
    } catch (error) {
      showMsg(error.message || "No se pudo crear la versión.", true);
    }
  };

  input.click();
}

async function deleteDocument(id) {
  if (!confirm("¿Eliminar este documento y todas sus versiones? Esta acción no se puede deshacer.")) return;

  try {
    await api("/api/admin/documents/" + Number(id), { method: "DELETE" });
    showMsg("Documento eliminado correctamente.");
    await loadDocuments();
  } catch (error) {
    showMsg(error.message || "No se pudo eliminar el documento.", true);
  }
}

async function createQuoteDocument() {
  const value = prompt("Ingresá el ID del presupuesto que querés convertir en PDF:");
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return;

  try {
    await api("/api/admin/documents/from-quote/" + id, { method: "POST" });
    showMsg("PDF del presupuesto generado correctamente.");
    await loadDocuments();
  } catch (error) {
    showMsg(error.message || "No se pudo generar el PDF.", true);
  }
}

async function createJobDocument(type) {
  const value = prompt("Ingresá el ID del trabajo:");
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return;

  try {
    await api("/api/admin/documents/from-job/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type })
    });
    showMsg(type === "work_completion"
      ? "Constancia de trabajo generada correctamente."
      : "Informe de trabajo generado correctamente.");
    await loadDocuments();
  } catch (error) {
    showMsg(error.message || "No se pudo generar el documento.", true);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("documentUploadForm")?.addEventListener("submit", uploadDocument);
  $("refreshDocuments")?.addEventListener("click", loadDocuments);
  $("documentsSearch")?.addEventListener("input", loadDocuments);
  $("documentsTypeFilter")?.addEventListener("change", loadDocuments);
  $("createQuoteDocument")?.addEventListener("click", createQuoteDocument);
  $("createJobReport")?.addEventListener("click", () => createJobDocument("job_report"));
  $("createWorkCompletion")?.addEventListener("click", () => createJobDocument("work_completion"));

  if ($("documentsSection")) loadDocuments();
});
