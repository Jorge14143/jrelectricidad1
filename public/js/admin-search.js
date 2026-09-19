"use strict";

(() => {
  const input = document.getElementById("globalAdminSearch");
  const panel = document.getElementById("globalSearchResults");
  if (!input || !panel) return;

  let timer = null;
  let controller = null;

  const icons = {
    user: "👤",
    client: "👥",
    request: "📝",
    quote: "📋",
    job: "🔧",
    service: "🛠️",
    gallery: "🖼️",
    document: "📄"
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function close() {
    panel.hidden = true;
    panel.innerHTML = "";
  }

  function render(results, query) {
    if (!results.length) {
      panel.innerHTML = '<div class="global-search-empty">No se encontraron resultados para <strong>' +
        escapeHtml(query) + "</strong>.</div>";
      panel.hidden = false;
      return;
    }

    panel.innerHTML = results.map((item, index) => `
      <a class="global-search-result" href="${escapeHtml(item.link || "#")}" data-index="${index}">
        <span class="global-search-icon">${icons[item.result_type] || "🔎"}</span>
        <span class="global-search-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.section)} · ${escapeHtml(item.subtitle || "")}</small>
        </span>
      </a>
    `).join("");
    panel.hidden = false;
  }

  async function search() {
    const query = input.value.trim();
    if (query.length < 2) {
      close();
      return;
    }

    if (controller) controller.abort();
    controller = new AbortController();

    panel.innerHTML = '<div class="global-search-loading">Buscando...</div>';
    panel.hidden = false;

    try {
      const response = await fetch("/api/admin/search?q=" + encodeURIComponent(query), {
        credentials: "include",
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo buscar.");
      render(Array.isArray(data.results) ? data.results : [], query);
    } catch (error) {
      if (error.name === "AbortError") return;
      panel.innerHTML = '<div class="global-search-error">' + escapeHtml(error.message) + "</div>";
      panel.hidden = false;
    }
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(search, 180);
  });

  input.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      input.value = "";
      close();
      input.blur();
    }
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".admin-global-search")) close();
  });

  panel.addEventListener("click", () => {
    close();
  });
})();
