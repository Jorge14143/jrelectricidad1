"use strict";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

async function loadUser() {
  const menu = document.getElementById("user-menu");
  if (!menu) return;

  try {
    const response = await fetch("/api/me", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) return;

    const data = await response.json();
    if (!data.user) return;

    const user = data.user;

    menu.innerHTML = `
      <div class="user-dropdown">
        <button class="user-button" id="user-button" type="button" aria-expanded="false">
          <span class="user-avatar">👤</span>
          <span class="user-name">${escapeHtml(user.name)}</span>
          <span class="user-arrow">▾</span>
        </button>

        <div class="user-dropdown-menu" id="user-dropdown-menu">
          <div class="user-dropdown-header">
            <strong>${escapeHtml(user.name)}</strong>
            <small>${escapeHtml(user.email)}</small>
          </div>

          <div class="user-dropdown-line"></div>

          <a href="/">🏠 Inicio</a>
          <a href="/cuenta.html">👤 Mi cuenta</a>
          ${user.role === "admin" ? '<a href="/admin">⚙️ Panel de administración</a>' : ""}
          <button id="logout-btn" type="button">🚪 Cerrar sesión</button>
        </div>
      </div>
    `;

    const userButton = document.getElementById("user-button");
    const dropdown = document.getElementById("user-dropdown-menu");
    const logoutButton = document.getElementById("logout-btn");

    userButton?.addEventListener("click", event => {
      event.stopPropagation();
      const open = dropdown.classList.toggle("show");
      userButton.setAttribute("aria-expanded", String(open));
    });

    dropdown?.addEventListener("click", event => {
      event.stopPropagation();
    });

    document.addEventListener("click", () => {
      dropdown?.classList.remove("show");
      userButton?.setAttribute("aria-expanded", "false");
    }, { once: false });

    logoutButton?.addEventListener("click", logoutUser);
  } catch (error) {
    console.error("Error obteniendo usuario:", error);
  }
}

async function logoutUser() {
  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin"
    });
  } finally {
    window.location.href = "/";
  }
}

loadUser();
