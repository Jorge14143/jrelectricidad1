// =========================================================
// AUTENTICACIÓN
// =========================================================

// =========================================================
// NOTIFICACIONES DEL ADMINISTRADOR
// =========================================================

let adminNotifications = [];

function notificationTime(value) {
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


function notificationIcon(type) {
  if (type === "quote_accepted") {
    return "🟢";
  }

  if (type === "quote_rejected") {
    return "🔴";
  }

  return "🔔";
}


function notificationTitle(type) {
  if (type === "quote_accepted") {
    return "Presupuesto aceptado";
  }

  if (type === "quote_rejected") {
    return "Presupuesto rechazado";
  }

  return "Notificación";
}


function renderNotifications(data) {
  const list = $("notificationsList");
  const badge = $("notificationsBadge");
  const count = $("notificationsCount");

  if (!list) return;

  adminNotifications = Array.isArray(data.notifications)
    ? data.notifications
    : [];

  const unread = Number(data.unread || 0);

  if (badge) {
    badge.textContent = unread;

    if (unread > 0) {
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  if (count) {
    count.textContent =
      unread > 0
        ? `${unread} sin leer`
        : "Sin notificaciones nuevas";
  }

  if (!adminNotifications.length) {
    list.innerHTML = `
      <div class="notifications-empty">
        <div class="notifications-empty-icon">🔔</div>
        <p>No hay notificaciones.</p>
      </div>
    `;

    return;
  }

  list.innerHTML = adminNotifications.map(notification => {
    const unreadClass =
      Number(notification.is_read) === 0
        ? "notification-unread"
        : "";

    return `
      <article
        class="notification-item ${unreadClass}"
        data-notification-id="${Number(notification.id)}"
      >

        <div class="notification-icon">
          ${notificationIcon(notification.type)}
        </div>

        <div class="notification-content">

          <strong>
            ${h(notificationTitle(notification.type))}
          </strong>

          <p>
            ${h(notification.message)}
          </p>

          <small>
            ${h(notificationTime(notification.created_at))}
          </small>

        </div>

        ${
          Number(notification.is_read) === 0
            ? `
              <button
                class="notification-read-button"
                type="button"
                onclick="markNotificationRead(${Number(notification.id)})"
                title="Marcar como leída"
              >
                ✓
              </button>
            `
            : ""
        }

      </article>
    `;
  }).join("");
}


async function loadNotifications() {
  try {
    const data = await api("/api/admin/notifications");

    renderNotifications(data);

  } catch (error) {
    console.error(
      "Error cargando notificaciones:",
      error
    );

    const list = $("notificationsList");

    if (list) {
      list.innerHTML = `
        <div class="notifications-error">
          No se pudieron cargar las notificaciones.
        </div>
      `;
    }
  }
}


async function markNotificationRead(id) {
  try {
    await api(
      `/api/admin/notifications/${id}/read`,
      {
        method: "POST"
      }
    );

    await loadNotifications();

  } catch (error) {
    console.error(
      "Error marcando notificación como leída:",
      error
    );

    showMsg(
      "No se pudo marcar la notificación.",
      true
    );
  }
}


async function markAllNotificationsRead() {
  try {
    await api(
      "/api/admin/notifications/read-all",
      {
        method: "POST"
      }
    );

    await loadNotifications();

  } catch (error) {
    console.error(
      "Error marcando notificaciones:",
      error
    );

    showMsg(
      "No se pudieron marcar las notificaciones.",
      true
    );
  }
}


function setupNotifications() {
  const button = $("notificationsButton");
  const panel = $("notificationsPanel");
  const markAll = $("markAllNotificationsRead");

  if (!button || !panel) {
    return;
  }

  button.addEventListener("click", event => {
    event.stopPropagation();

    const isOpen = !panel.hidden;

    panel.hidden = isOpen;

    button.setAttribute(
      "aria-expanded",
      String(!isOpen)
    );

    if (!isOpen) {
      loadNotifications();
    }
  });

  if (markAll) {
    markAll.addEventListener(
      "click",
      event => {
        event.stopPropagation();

        markAllNotificationsRead();
      }
    );
  }

  document.addEventListener("click", event => {
    if (
      !panel.hidden &&
      !panel.contains(event.target) &&
      !button.contains(event.target)
    ) {
      panel.hidden = true;

      button.setAttribute(
        "aria-expanded",
        "false"
      );
    }
  });
}

function setupSidebarNotifications() {
  const sidebarButton = $("sidebarNotificationsButton");
  const notificationsButton = $("notificationsButton");

  if (!sidebarButton || !notificationsButton) {
    return;
  }

  sidebarButton.addEventListener("click", event => {
    event.preventDefault();
    notificationsButton.click();
  });
}
