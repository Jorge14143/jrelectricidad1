// =========================================================
// NOTIFICACIONES DEL ADMINISTRADOR — V2
// =========================================================

let adminNotifications = [];
let notificationsTimer = null;

function notificationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function notificationIcon(type) {
  const icons = {
    quote_accepted: "🟢",
    quote_rejected: "🔴",
    quote_request_created: "📋",
    quote_request_status: "🔄",
    quote_sent: "📨",
    job_assigned: "👷",
    job_scheduled: "📅",
    job_started: "🔧",
    job_status_changed: "🔄",
    job_finished: "✅",
    job_closed: "🏁",
    gallery_published: "🖼️",
    security: "🔐",
    system: "⚙️"
  };
  return icons[type] || "🔔";
}

function notificationTitle(type) {
  const titles = {
    quote_accepted: "Presupuesto aceptado",
    quote_rejected: "Presupuesto rechazado",
    quote_request_created: "Nueva solicitud",
    quote_request_status: "Estado de solicitud actualizado",
    quote_sent: "Presupuesto enviado",
    job_assigned: "Trabajo asignado",
    job_scheduled: "Trabajo programado",
    job_started: "Trabajo iniciado",
    job_status_changed: "Estado de trabajo actualizado",
    job_finished: "Trabajo finalizado",
    job_closed: "Trabajo cerrado",
    gallery_published: "Galería actualizada",
    security: "Seguridad de cuenta",
    system: "Notificación del sistema"
  };
  return titles[type] || "Notificación";
}

function notificationPriorityLabel(priority) {
  return ({
    low: "Baja",
    normal: "Normal",
    high: "Alta",
    urgent: "Urgente"
  })[priority] || "Normal";
}

function renderNotificationBadges(unread) {
  const value = Number(unread || 0);
  const badges = [
    $("notificationsBadge"),
    $("sidebarNotificationsBadge")
  ];

  badges.forEach(badge => {
    if (!badge) return;
    badge.textContent = value > 99 ? "99+" : String(value);
    badge.hidden = value <= 0;
  });

  const count = $("notificationsCount");
  if (count) {
    count.textContent = value > 0
      ? `${value} sin leer`
      : "Sin notificaciones nuevas";
  }
}

function renderNotifications(data) {
  const list = $("notificationsList");
  if (!list) return;

  adminNotifications = Array.isArray(data.notifications)
    ? data.notifications
    : [];

  renderNotificationBadges(data.unread);

  if (!adminNotifications.length) {
    list.innerHTML = `
      <div class="notifications-empty">
        <div class="notifications-empty-icon">🔔</div>
        <p>No hay notificaciones pendientes.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = adminNotifications.map(notification => {
    const unread = Number(notification.is_read) === 0;
    const priority = String(notification.priority || "normal");
    const link = notification.link_url
      ? String(notification.link_url)
      : "";

    return `
      <article
        class="notification-item ${unread ? "notification-unread" : ""} notification-priority-${h(priority)}"
        data-notification-id="${Number(notification.id)}"
        data-notification-link="${h(link)}"
        tabindex="0"
        role="button"
      >
        <div class="notification-icon">
          ${notificationIcon(notification.type)}
        </div>

        <div class="notification-content">
          <div class="notification-title-row">
            <strong>${h(notificationTitle(notification.type))}</strong>
            <span class="notification-priority">${h(notificationPriorityLabel(priority))}</span>
          </div>

          <p>${h(notification.message)}</p>

          <small>${h(notificationTime(notification.created_at))}</small>
        </div>

        <div class="notification-actions">
          ${unread ? `
            <button
              class="notification-read-button"
              type="button"
              data-notification-read
              title="Marcar como leída"
              aria-label="Marcar como leída"
            >✓</button>
          ` : ""}
          <button
            class="notification-archive-button"
            type="button"
            data-notification-archive
            title="Archivar"
            aria-label="Archivar notificación"
          >×</button>
        </div>
      </article>
    `;
  }).join("");
}

async function loadNotifications({silent=false} = {}) {
  try {
    const data = await api("/api/admin/notifications");
    renderNotifications(data);
  } catch (error) {
    if (!silent) {
      console.error("Error cargando notificaciones:", error);
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
}

async function markNotificationRead(id) {
  try {
    await api(`/api/admin/notifications/${id}/read`, { method: "POST" });
    await loadNotifications({silent:true});
  } catch (error) {
    console.error("Error marcando notificación como leída:", error);
    showMsg("No se pudo marcar la notificación.", true);
  }
}

async function markAllNotificationsRead() {
  try {
    await api("/api/admin/notifications/read-all", { method: "POST" });
    await loadNotifications({silent:true});
  } catch (error) {
    console.error("Error marcando notificaciones:", error);
    showMsg("No se pudieron marcar las notificaciones.", true);
  }
}

async function archiveNotification(id) {
  try {
    await api(`/api/admin/notifications/${id}/archive`, { method: "POST" });
    await loadNotifications({silent:true});
  } catch (error) {
    console.error("Error archivando notificación:", error);
    showMsg("No se pudo archivar la notificación.", true);
  }
}

function openNotification(notification) {
  if (!notification) return;
  const id = Number(notification.id);
  if (Number(notification.is_read) === 0) {
    markNotificationRead(id);
  }
  const link = String(notification.link_url || "").trim();
  if (link) {
    window.location.href = link;
  }
}

function setupNotifications() {
  const list = $("notificationsList");
  list?.addEventListener("click", event => {
    const readButton = event.target.closest("[data-notification-read]");
    if (readButton) {
      event.stopPropagation();
      const item = readButton.closest("[data-notification-id]");
      if (item) markNotificationRead(Number(item.dataset.notificationId));
      return;
    }

    const archiveButton = event.target.closest("[data-notification-archive]");
    if (archiveButton) {
      event.stopPropagation();
      const item = archiveButton.closest("[data-notification-id]");
      if (item) archiveNotification(Number(item.dataset.notificationId));
      return;
    }

    const item = event.target.closest("[data-notification-id]");
    if (!item) return;

    const notification = adminNotifications.find(
      row => Number(row.id) === Number(item.dataset.notificationId)
    );
    openNotification(notification);
  });

  list?.addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key)) return;
    const item = event.target.closest("[data-notification-id]");
    if (!item) return;
    event.preventDefault();
    const notification = adminNotifications.find(
      row => Number(row.id) === Number(item.dataset.notificationId)
    );
    openNotification(notification);
  });

  const button = $("notificationsButton");
  const panel = $("notificationsPanel");
  const markAll = $("markAllNotificationsRead");

  if (!button || !panel) return;

  button.addEventListener("click", event => {
    event.stopPropagation();
    const isOpen = !panel.hidden;
    panel.hidden = isOpen;
    button.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) loadNotifications();
  });

  markAll?.addEventListener("click", event => {
    event.stopPropagation();
    markAllNotificationsRead();
  });

  document.addEventListener("click", event => {
    if (
      !panel.hidden &&
      !panel.contains(event.target) &&
      !button.contains(event.target)
    ) {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  });

  notificationsTimer = window.setInterval(
    () => loadNotifications({silent:true}),
    30000
  );
}

function setupSidebarNotifications() {
  const sidebarButton = $("sidebarNotificationsButton");
  const notificationsButton = $("notificationsButton");

  if (!sidebarButton || !notificationsButton) return;

  sidebarButton.addEventListener("click", event => {
    event.preventDefault();
    notificationsButton.click();
  });
}

