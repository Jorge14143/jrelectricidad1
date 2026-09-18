const $ = (id) => document.getElementById(id);

// =========================================================
// UTILIDADES
// =========================================================

function h(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}
function money(v) {
  if (v === null || v === "" || v === undefined) {
    return "Sin precio";
  }

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2
  }).format(Number(v));
}

function showMsg(text, error = false) {
  const el = $("msg");

  if (!el) return;

  el.textContent = text;
  el.className = `notice ${error ? "error" : "success"}`;
  el.hidden = false;

  clearTimeout(showMsg.timer);

  showMsg.timer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}


// =========================================================
// API
// =========================================================

async function api(url, options = {}) {
  const r = await fetch(url, {
    credentials: "include",
    ...options
  });

  let data = {};

  try {
    data = await r.json();
  } catch (_) {}

  if (!r.ok) {
    throw new Error(data.error || "Ocurrió un error.");
  }

  return data;
}
// =========================================================
// USUARIO ADMINISTRADOR
// =========================================================
async function loadAdminUser() {
  try {
    const data = await api("/api/me");

    if (!data || !data.user) return;

    const user = data.user;
    const name = String(user.name || "Administrador").trim();

    const avatar = $("adminUserAvatar");
    const userName = $("adminUserName");
    const welcome = $("adminWelcomeTitle");

    if (avatar) {
      avatar.textContent = name.charAt(0).toUpperCase();
    }

    if (userName) {
      userName.textContent = name;
    }

    if (welcome) {
      const firstName = name.split(/\s+/)[0] || "Administrador";
      welcome.textContent = `Buenos días, ${firstName} 👋`;
    }
  } catch (error) {
    console.error(
      "No se pudo cargar el usuario administrador:",
      error
    );
  }
}
function setupAccountSettings() {
  const profileForm = $("profileSettingsForm");
const passwordForm = $("passwordSettingsForm");

if (passwordForm) {
  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const currentPassword = $("currentPassword")?.value || "";
    const newPassword = $("newPassword")?.value || "";
    const confirmPassword = $("confirmPassword")?.value || "";

    if (!currentPassword) {
      showSettingsMessage(
        "Ingresá tu contraseña actual.",
        "error"
      );
      return;
    }

    if (newPassword.length < 8) {
      showSettingsMessage(
        "La nueva contraseña debe tener al menos 8 caracteres.",
        "error"
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      showSettingsMessage(
        "Las nuevas contraseñas no coinciden.",
        "error"
      );
      return;
    }

    try {
      const data = await api("/api/admin/account/password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });

      showSettingsMessage(
        data.message || "La contraseña fue cambiada correctamente.",
        "success"
      );

      passwordForm.reset();

    } catch (error) {
      console.error("Error cambiando contraseña:", error);

      showSettingsMessage(
        error.message || "No se pudo cambiar la contraseña.",
        "error"
      );
    }
  });
}
  if (profileForm) {
    profileForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const name = $("settingsName")?.value.trim();
      const email = $("settingsEmail")?.value.trim();

      if (!name || !email) {
        showSettingsMessage("Completá el nombre y el email.", "error");
        return;
      }

      try {
        const data = await api("/api/admin/account", {
  method: "PUT",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    name,
    email
  })
});
        showSettingsMessage(
          data.message || "Los datos fueron actualizados correctamente.",
          "success"
        );

        // Actualizar los datos visibles del administrador
        await loadAdminUser();
      } catch (error) {
        console.error("Error actualizando los datos:", error);

        showSettingsMessage(
          error.message || "No se pudieron actualizar los datos.",
          "error"
        );
      }
    });
  }
}

function showSettingsMessage(message, type = "success") {
  const box = $("settingsMessage");

  if (!box) return;

  box.textContent = message;
  box.className = `settings-message ${type}`;
  box.style.display = "block";

  clearTimeout(window.settingsMessageTimer);

  window.settingsMessageTimer = setTimeout(() => {
    box.style.display = "none";
  }, 4000);
}
async function loadAccountSettings() {
  try {
    const data = await api("/api/admin/account");

    console.log("CONFIGURACIÓN CUENTA:", data);

    if (!data || !data.user) return;

    const nameInput = $("settingsName");
    const emailInput = $("settingsEmail");

    console.log("CAMPOS:", {
      nameInput,
      emailInput
    });

    if (nameInput) {
      nameInput.value = data.user.name || "";
    }

    if (emailInput) {
      emailInput.value = data.user.email || "";
    }
  } catch (error) {
    console.error("No se pudo cargar la configuración de cuenta:", error);
  }
}

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


// =========================================================
// SERVICIOS
// =========================================================

function editService(x) {
  $("serviceId").value = x.id;

  $("serviceTitle").value =
    x.title || "";

  $("serviceDescription").value =
    x.description || "";

  $("servicePrice").value =
    x.price ?? "";

  $("serviceFormTitle").textContent =
    "Editar servicio";

  $("serviceSubmit").textContent =
    "Guardar cambios";

  $("cancelEdit").hidden =
    false;

  window.scrollTo({
    top: 120,
    behavior: "smooth"
  });
}


function resetServiceForm() {
  const form = $("serviceForm");

  if (form) {
    form.reset();
  }

  $("serviceId").value = "";

  $("serviceFormTitle").textContent =
    "Agregar servicio";

  $("serviceSubmit").textContent =
    "Agregar servicio";

  $("cancelEdit").hidden =
    true;
}


const serviceForm = $("serviceForm");

if (serviceForm) {
  serviceForm.onsubmit = async e => {
    e.preventDefault();

    const id =
      $("serviceId").value;

    const payload = {
      title:
        $("serviceTitle").value.trim(),

      description:
        $("serviceDescription").value.trim(),

      price:
        $("servicePrice").value
    };

    try {
      if (id) {
        const current =
          await api("/api/admin/services");

        const item =
          current.find(
            x => Number(x.id) === Number(id)
          );

        payload.active =
          item ? !!item.active : true;

        await api(
          `/api/admin/services/${id}`,
          {
            method: "PUT",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(payload)
          }
        );

        showMsg(
          "Servicio actualizado correctamente."
        );

      } else {
        await api(
          "/api/admin/services",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(payload)
          }
        );

        showMsg(
          "Servicio agregado correctamente."
        );
      }

      resetServiceForm();

      await load();

    } catch (e) {
      showMsg(
        e.message,
        true
      );
    }
  };
}


const cancelEdit =
  $("cancelEdit");

if (cancelEdit) {
  cancelEdit.onclick =
    resetServiceForm;
}


async function toggleService(id, active) {
  try {
    const services =
      await api("/api/admin/services");

    const x =
      services.find(
        s => Number(s.id) === Number(id)
      );

    if (!x) return;

    await api(
      `/api/admin/services/${id}`,
      {
        method: "PUT",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          title:
            x.title,

          description:
            x.description,

          price:
            x.price,

          active:
            !active
        })
      }
    );

    showMsg(
      active
        ? "Servicio ocultado."
        : "Servicio publicado."
    );

    await load();

  } catch (e) {
    showMsg(
      e.message,
      true
    );
  }
}


async function del(id) {
  if (
    !confirm(
      "¿Eliminar este servicio definitivamente?"
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/admin/services/${id}`,
      {
        method: "DELETE"
      }
    );

    showMsg(
      "Servicio eliminado."
    );

    await load();

  } catch (e) {
    showMsg(
      e.message,
      true
    );
  }
}


// =========================================================
// USUARIOS
// =========================================================

async function toggleRole(id, role) {
  const next =
    role === "admin"
      ? "user"
      : "admin";

  if (
    !confirm(
      `¿Cambiar este usuario a ${next}?`
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/admin/users/${id}/role`,
      {
        method: "PUT",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            role: next
          })
      }
    );

    showMsg(
      "Rol actualizado."
    );

    await load();

  } catch (e) {
    showMsg(
      e.message,
      true
    );
  }
}


async function deleteUser(id, name) {
  if (
    !confirm(
      `¿Eliminar al usuario "${name}"? Esta acción no se puede deshacer.`
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/admin/users/${id}`,
      {
        method: "DELETE"
      }
    );

    showMsg(
      "Usuario eliminado."
    );

    await load();

  } catch (e) {
    showMsg(
      e.message,
      true
    );
  }
}

async function moveGallery(id, direction) {

  try {

    const result = await api(
      `/api/admin/gallery/${id}/order`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          direction
        })
      }
    );

    showMsg(
      result.message ||
      "Orden actualizado correctamente."
    );

    await loadGallery();

  } catch (e) {

    console.error(
      "Error cambiando orden:",
      e
    );

    showMsg(
      "No se pudo cambiar el orden: " +
      e.message,
      true
    );

  }

}
// =========================================================
// GALERÍA - CARGAR
// =========================================================

async function loadGallery() {
  const container =
    $("adminGallery");

  if (!container) {
    return;
  }

  try {
    const gallery =
      await api("/api/admin/gallery");

    if (!gallery.length) {
      container.innerHTML = `
        <p class="muted gallery-empty">
          Todavía no hay trabajos cargados.
        </p>
      `;

      return;
    }

    container.innerHTML =
      gallery.map(x => `
        <article
          class="gallery-admin-item
          ${x.active ? "" : "inactive"}"
        >

          <div class="gallery-admin-image">
            <img
              src="${h(x.image_url)}"
              alt="${h(x.title)}"
              loading="lazy"
            >
          </div>

          <div class="gallery-admin-info">

            <div class="gallery-admin-title">

              <h3>
                ${h(x.title)}
              </h3>

              <span
                class="status ${x.active ? "on" : "off"}"
              >
                ${
                  x.active
                    ? "Publicado"
                    : "Oculto"
                }
              </span>

            </div>

            <p>
              ${h(
                x.description ||
                "Sin descripción"
              )}
            </p>

            <small class="muted">
              ${
                x.image_url
                  ? h(x.image_url)
                  : ""
              }
            </small>

            <div class="row-actions">
<button
  class="btn tiny ghost"
  onclick="moveGallery(${x.id}, 'up')"
  title="Subir"
>
  ⬆️
</button>

<button
  class="btn tiny ghost"
  onclick="moveGallery(${x.id}, 'down')"
  title="Bajar"
>
  ⬇️
</button>
              <button
                class="btn tiny"
                onclick='editGallery(${JSON.stringify(x)})'
              >
                Editar
              </button>

              <button
                class="btn tiny ghost"
                onclick="toggleGallery(${x.id}, ${x.active ? 1 : 0})"
              >
                ${
                  x.active
                    ? "Ocultar"
                    : "Publicar"
                }
              </button>

              <button
                class="btn tiny danger"
                onclick="deleteGallery(${x.id}, '${h(x.title)}')"
              >
                Eliminar
              </button>

            </div>

          </div>

        </article>
      `).join("");

  } catch (e) {
    console.error(
      "Error cargando galería:",
      e
    );

    showMsg(
      "No se pudo cargar la galería: " +
      e.message,
      true
    );
  }
}


// =========================================================
// GALERÍA - PREVISUALIZACIÓN
// =========================================================

const galleryImage =
  $("galleryImage");

if (galleryImage) {
  galleryImage.addEventListener(
    "change",
    () => {
      const file =
        galleryImage.files[0];

      const preview =
        $("galleryPreview");

      if (!preview) {
        return;
      }

      if (!file) {
        preview.innerHTML = "";
        return;
      }

      if (!file.type.startsWith("image/")) {
        preview.innerHTML = `
          <p class="notice error">
            El archivo seleccionado no es una imagen válida.
          </p>
        `;

        galleryImage.value = "";

        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        preview.innerHTML = `
          <p class="notice error">
            La imagen no puede superar los 5 MB.
          </p>
        `;

        galleryImage.value = "";

        return;
      }

      const url =
        URL.createObjectURL(file);

      preview.innerHTML = `
        <div class="gallery-preview-card">

          <img
            src="${url}"
            alt="Vista previa"
          >

        </div>
      `;
    }
  );
}


// =========================================================
// GALERÍA - EDITAR
// =========================================================

function editGallery(x) {
  $("galleryId").value =
    x.id;

  $("galleryTitle").value =
    x.title || "";

  $("galleryDescription").value =
    x.description || "";

  $("galleryActive").checked =
    !!x.active;
$("galleryFeatured").checked = !!x.featured;
  if ($("galleryImage")) {
    $("galleryImage").value = "";
  }

  if ($("galleryPreview")) {
    $("galleryPreview").innerHTML =
      x.image_url
        ? `
          <div class="gallery-preview-card">

            <img
              src="${h(x.image_url)}"
              alt="${h(x.title)}"
            >

            <small class="muted">
              Imagen actual
            </small>

          </div>
        `
        : "";
  }

  $("gallerySubmit").textContent =
    "Guardar cambios";

  $("galleryCancel").hidden =
    false;

  document
    .querySelector(".gallery-admin-panel")
    ?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
}


// =========================================================
// GALERÍA - REINICIAR FORMULARIO
// =========================================================

function resetGalleryForm() {
  const form =
    $("galleryForm");

  if (form) {
    form.reset();
  }
$("galleryFeatured").checked = false;
  $("galleryId").value = "";

  $("gallerySubmit").textContent =
    "📸 Agregar trabajo";

  $("galleryCancel").hidden =
    true;

  if ($("galleryPreview")) {
    $("galleryPreview").innerHTML = "";
  }
}


// =========================================================
// GALERÍA - GUARDAR
// =========================================================

const galleryForm =
  $("galleryForm");

if (galleryForm) {
  galleryForm.onsubmit = async e => {
    e.preventDefault();

    const id =
      $("galleryId").value.trim();

    const title =
      $("galleryTitle").value.trim();

    const description =
      $("galleryDescription").value.trim();

    const active =
      $("galleryActive").checked;
const featured =
  $("galleryFeatured").checked;
    const imageInput =
      $("galleryImage");

    if (!title) {
      showMsg(
        "El título es obligatorio.",
        true
      );

      return;
    }

    if (title.length > 150) {
      showMsg(
        "El título es demasiado largo.",
        true
      );

      return;
    }

    if (description.length > 500) {
      showMsg(
        "La descripción es demasiado larga.",
        true
      );

      return;
    }

    if (
      !id &&
      (!imageInput ||
       !imageInput.files.length)
    ) {
      showMsg(
        "Debes seleccionar una imagen.",
        true
      );

      return;
    }

    const formData =
      new FormData();

    formData.append(
      "title",
      title
    );

    formData.append(
      "description",
      description
    );

    formData.append(
      "active",
      active ? "1" : "0"
	  
    );
formData.append(
  "featured",
  featured ? "1" : "0"
);
    if (
      imageInput &&
      imageInput.files.length
    ) {
      formData.append(
        "image",
        imageInput.files[0]
      );
    }

    try {
      const url =
        id
          ? `/api/admin/gallery/${id}`
          : "/api/admin/gallery";

      const method =
        id
          ? "PUT"
          : "POST";

      const result =
        await api(
          url,
          {
            method,
            body: formData
          }
        );

      console.log(
        "Galería guardada:",
        result
      );

      showMsg(
        result.message ||
        (
          id
            ? "Trabajo actualizado correctamente."
            : "Trabajo agregado correctamente."
        )
      );

      resetGalleryForm();

      await loadGallery();

    } catch (e) {
      console.error(
        "Error guardando galería:",
        e
      );

      showMsg(
        e.message ||
        "No se pudo guardar el trabajo.",
        true
      );
    }
  };
}


// =========================================================
// GALERÍA - CANCELAR
// =========================================================

const galleryCancel =
  $("galleryCancel");

if (galleryCancel) {
  galleryCancel.onclick =
    resetGalleryForm;
}


// =========================================================
// GALERÍA - PUBLICAR / OCULTAR
// =========================================================

async function toggleGallery(id, active) {
  try {
    const gallery =
      await api("/api/admin/gallery");

    const item =
      gallery.find(
        x => Number(x.id) === Number(id)
      );

    if (!item) {
      showMsg(
        "Trabajo no encontrado.",
        true
      );

      return;
    }

    const formData =
      new FormData();

    formData.append(
      "title",
      item.title || ""
    );

    formData.append(
      "description",
      item.description || ""
    );

    formData.append(
      "active",
      active ? "0" : "1"
    );

    formData.append(
      "featured",
      item.featured ? "1" : "0"
    );

    await api(
      `/api/admin/gallery/${id}`,
      {
        method: "PUT",
        body: formData
      }
    );

    showMsg(
      active
        ? "Trabajo ocultado."
        : "Trabajo publicado."
    );

    await loadGallery();

  } catch (e) {
    showMsg(
      e.message,
      true
    );
  }
}


// =========================================================
// GALERÍA - ELIMINAR
// =========================================================

async function deleteGallery(id, title) {
  if (
    !confirm(
      `¿Eliminar el trabajo "${title}" definitivamente?`
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/admin/gallery/${id}`,
      {
        method: "DELETE"
      }
    );

    showMsg(
      "Trabajo eliminado correctamente."
    );

    await loadGallery();

  } catch (e) {
    showMsg(
      e.message,
      true
    );
  }
}


// =========================================================
// SOLICITUDES DE PRESUPUESTO
// =========================================================

// =========================================================
// PRESUPUESTOS GUARDADOS
// =========================================================

function formatQuoteDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  return new Date(value).toLocaleDateString(
    "es-AR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  );
}


function quoteStatusLabel(status) {
  const labels = {
    borrador: "Borrador",
    enviado: "Enviado",
    aceptado: "Aceptado",
    rechazado: "Rechazado",
    vencido: "Vencido"
  };

  return labels[status] || status || "Borrador";
}


async function loadQuotes() {
  const container = $("quotesList");

  if (!container) {
    return;
  }

  container.innerHTML = `
    <p class="muted quote-list-loading">
      Cargando presupuestos...
    </p>
  `;

  try {
    const quotes = await api("/api/admin/quotes");

    if (!quotes.length) {
      container.innerHTML = `
        <div class="quote-list-empty">
          <span>💰</span>
          <p>Todavía no hay presupuestos guardados.</p>
        </div>
      `;

      return;
    }

    container.innerHTML = `
      <div class="table-wrap quotes-table-wrap">

        <table class="table quotes-table">

          <thead>
            <tr>
              <th>Nº</th>
              <th>Cliente</th>
              <th>Solicitud</th>
              <th>Fecha</th>
              <th>Conceptos</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>

          <tbody>

            ${quotes.map(quote => {

              const quoteId =
                Number(quote.id);

              const phone =
                quote.client_phone || "";

              const hasPhone =
                phone.trim().length > 0;

              return `
                <tr>

                  <td>
                    <strong class="quote-number">
                      ${h(quote.quote_number)}
                    </strong>
                  </td>

                  <td>
                    <strong>
                      ${h(quote.client_name)}
                    </strong>

                    ${
                      quote.client_email
                        ? `
                          <small>
                            ${h(quote.client_email)}
                          </small>
                        `
                        : ""
                    }

                  </td>

                  <td>
                    ${h(
                      quote.requested_service ||
                      "Sin servicio"
                    )}
                  </td>

                  <td>
                    ${h(
                      formatQuoteDate(
                        quote.issue_date ||
                        quote.created_at
                      )
                    )}
                  </td>

                  <td>
                    ${Number(
                      quote.items_count || 0
                    )}
                  </td>

                  <td>
                    <strong class="quote-total-value">
                      ${formatQuoteMoney(
                        quote.total
                      )}
                    </strong>
                  </td>

                  <td>
                    <span class="quote-status">
                      ${h(
                        quoteStatusLabel(
                          quote.status
                        )
                      )}
                    </span>
                  </td>

                  <td>

                    <div class="quote-table-actions">
					<button
  type="button"
  class="btn tiny"
  onclick="editQuote(${quoteId})"
  title="Editar presupuesto"
>
  ✏️ Editar
</button>

                      <button
                        type="button"
                        class="btn tiny"
                        onclick="viewQuote(${quoteId})"
                        title="Ver presupuesto"
                      >
                        👁 Ver
                      </button>

                      <button
                        type="button"
                        class="btn tiny"
                        onclick="openQuotePdf(${quoteId})"
                        title="Ver PDF"
                      >
                        📄 PDF
                      </button>

                      ${
                        hasPhone && quote.access_token
                          ? `
                            <button
                              type="button"
                              class="quote-whatsapp-btn"
                              onclick="sendQuoteWhatsApp(${quoteId})"
                              title="Enviar por WhatsApp"
                            >
                              📲 WhatsApp
                            </button>
                          `
                          : `
                            <button
                              type="button"
                              class="quote-whatsapp-btn"
                              disabled
                              title="El cliente no tiene teléfono registrado"
                            >
                              📲 WhatsApp
                            </button>
                          `
                      }

                    </div>

                  </td>

                </tr>
              `;

            }).join("")}

          </tbody>

        </table>

      </div>
    `;

    // Guardamos los presupuestos para usarlos
    // desde los botones de acciones.
    window.adminQuotes = quotes;

  } catch (error) {

    console.error(
      "Error cargando presupuestos:",
      error
    );

    container.innerHTML = `
      <div class="quote-list-empty">

        <span>⚠️</span>

        <p>
          ${h(error.message)}
        </p>

      </div>
    `;
  }
}
// =========================================================
// ACCIONES DE PRESUPUESTOS
// =========================================================

function getAdminQuote(id) {
  const quotes =
    Array.isArray(window.adminQuotes)
      ? window.adminQuotes
      : [];

  return quotes.find(
    quote =>
      Number(quote.id) === Number(id)
  );
}


// =========================================================
// VER PRESUPUESTO
// =========================================================
async function editQuote(id) {
  try {
    const quote =
      await api(`/api/admin/quotes/${id}`);

    const cachedQuote =
      getAdminQuote(id);

    editingQuoteId =
      Number(id);

    $("createQuoteModalTitle").textContent =
      "Editar presupuesto";

    $("saveQuoteButton").textContent =
      "💾 Guardar cambios";

    $("quoteRequestId").value =
      quote.quote_request_id ||
      cachedQuote?.quote_request_id ||
      "";

    $("quoteIssueDate").value =
      quote.issue_date
        ? String(quote.issue_date).slice(0, 10)
        : "";

    $("quoteExpirationDate").value =
      quote.expiration_date
        ? String(quote.expiration_date).slice(0, 10)
        : "";

    $("quoteDiscount").value =
      Number(quote.discount || 0);

    $("quoteNotes").value =
      quote.notes || "";

    $("quoteClientInfo").innerHTML = `
      <div class="quote-client-summary-main">
        <strong>${h(
          quote.name ||
          quote.client_name ||
          cachedQuote?.client_name ||
          ""
        )}</strong>

        ${
          quote.email ||
          quote.client_email ||
          cachedQuote?.client_email
            ? `
              <span>
                ${h(
                  quote.email ||
                  quote.client_email ||
                  cachedQuote?.client_email ||
                  ""
                )}
              </span>
            `
            : ""
        }

        ${
          quote.phone ||
          quote.client_phone ||
          cachedQuote?.client_phone
            ? `
              <span>
                ${h(
                  quote.phone ||
                  quote.client_phone ||
                  cachedQuote?.client_phone ||
                  ""
                )}
              </span>
            `
            : ""
        }
      </div>
    `;

    const itemsContainer =
      $("quoteItems");

    itemsContainer.innerHTML = "";

    const items =
      Array.isArray(quote.items)
        ? quote.items
        : [];

    if (!items.length) {
      addQuoteItem();
    } else {
      for (const item of items) {
        addQuoteItem();

        const rows =
          itemsContainer.querySelectorAll(
            ".quote-item"
          );

        const row =
          rows[rows.length - 1];

        const description =
          row.querySelector(
            ".quote-item-description"
          );

        const quantity =
          row.querySelector(
            ".quote-item-quantity"
          );

        const unit =
          row.querySelector(
            ".quote-item-unit"
          );

        const unitPrice =
          row.querySelector(
            ".quote-item-price"
          );

        if (description) {
          description.value =
            item.description || "";
        }

        if (quantity) {
          quantity.value =
            item.quantity ?? 1;
        }

        if (unit) {
          unit.value =
            item.unit || "unidad";
        }

        if (unitPrice) {
          unitPrice.value =
            item.unit_price ?? 0;
        }
      }
    }

    calculateQuoteTotals();

    $("createQuoteModal").style.display =
      "flex";

  } catch (error) {
    console.error(
      "Error cargando presupuesto para editar:",
      error
    );

    showMsg(
      "No se pudo cargar el presupuesto: " +
      error.message,
      true
    );
  }
}
async function viewQuote(id) {
  try {

    const quote =
      await api(
        `/api/admin/quotes/${id}`
      );

    const modal =
      $("quoteSummaryModal");

    const detail =
      $("quoteSummaryDetail");

    if (!modal || !detail) {
      console.error(
        "No existe el modal de resumen del presupuesto."
      );

      // Si el modal no existe, mostramos el presupuesto
      // directamente en una nueva pestaña como alternativa.
      window.open(
        `/api/admin/quotes/${id}`,
        "_blank"
      );

      return;
    }

    detail.innerHTML = `
      <div class="quote-detail-modern">

        <div class="quote-detail-header">

          <div>

            <span class="quote-section-label">
              PRESUPUESTO
            </span>

            <h2>
              ${h(quote.quote_number)}
            </h2>

          </div>

          <span class="quote-detail-status">
            ${h(
              quoteStatusLabel(
                quote.status
              )
            )}
          </span>

        </div>

        <div class="quote-detail-block">

          <div class="quote-detail-block-title">

            <span class="quote-detail-block-icon">
              👤
            </span>

            <div>

              <span class="quote-detail-block-label">
                CLIENTE
              </span>

              <h3>
                ${h(quote.name || "-")}
              </h3>

            </div>

          </div>

          <div class="quote-contact-grid">

            <div class="quote-contact-item">

              <span class="quote-contact-icon">
                📱
              </span>

              <div>

                <small>
                  Teléfono
                </small>

                <strong>
                  ${h(quote.phone || "-")}
                </strong>

              </div>

            </div>

            <div class="quote-contact-item">

              <span class="quote-contact-icon">
                ✉️
              </span>

              <div>

                <small>
                  Email
                </small>

                <strong>
                  ${h(quote.email || "No indicado")}
                </strong>

              </div>

            </div>

          </div>

        </div>

        <div class="quote-detail-block">

          <div class="quote-detail-block-title">

            <span class="quote-detail-block-icon">
              ⚡
            </span>

            <div>

              <span class="quote-detail-block-label">
                SERVICIO
              </span>

              <h3>
                ${h(
                  quote.service ||
                  "Sin servicio"
                )}
              </h3>

            </div>

          </div>

        </div>

        <div class="quote-detail-block">

          <div class="quote-detail-block-title">

            <span class="quote-detail-block-icon">
              🧾
            </span>

            <div>

              <span class="quote-detail-block-label">
                CONCEPTOS
              </span>

            </div>

          </div>

          <div class="table-wrap">

            <table class="table">

              <thead>

                <tr>
                  <th>Concepto</th>
                  <th>Cantidad</th>
                  <th>Precio</th>
                  <th>Total</th>
                </tr>

              </thead>

              <tbody>

                ${
                  (quote.items || [])
                    .map(item => `
                      <tr>

                        <td>
                          ${h(item.description)}
                        </td>

                        <td>
                          ${h(item.quantity)}
                          ${h(item.unit || "")}
                        </td>

                        <td>
                          ${formatQuoteMoney(
                            item.unit_price
                          )}
                        </td>

                        <td>
                          <strong>
                            ${formatQuoteMoney(
                              item.total
                            )}
                          </strong>
                        </td>

                      </tr>
                    `)
                    .join("")
                }

              </tbody>

            </table>

          </div>

        </div>

        <div class="quote-summary-total">

          <span>
            Total
          </span>

          <strong>
            ${formatQuoteMoney(
              quote.total
            )}
          </strong>

        </div>

        ${
          quote.notes
            ? `
              <div class="quote-detail-block">

                <div class="quote-detail-block-title">

                  <span class="quote-detail-block-icon">
                    📝
                  </span>

                  <div>

                    <span class="quote-detail-block-label">
                      NOTAS
                    </span>

                  </div>

                </div>

                <div class="quote-description-modern">
                  ${h(quote.notes)}
                </div>

              </div>
            `
            : ""
        }

        <div class="quote-detail-actions-modern">

          <button
            type="button"
            class="quote-modal-secondary"
            onclick="closeQuoteSummaryModal()"
          >
            Cerrar
          </button>

          <button
            type="button"
            class="quote-create-large"
            onclick="openQuotePdf(${quote.id})"
          >
            📄 Ver PDF
          </button>

        </div>

      </div>
    `;

    modal.style.display = "flex";

    modal.classList.add("active");

  } catch (error) {

    console.error(
      "Error viendo presupuesto:",
      error
    );

    alert(
      "No se pudo cargar el presupuesto: " +
      error.message
    );
  }
}


// =========================================================
// CERRAR MODAL RESUMEN
// =========================================================

function closeQuoteSummaryModal() {

  const modal =
    $("quoteSummaryModal");

  if (!modal) {
    return;
  }

  modal.classList.remove(
    "active"
  );

  modal.style.display =
    "none";
}


// =========================================================
// PDF
// =========================================================

function openQuotePdf(id) {

  window.open(
    `/api/admin/quotes/${id}/pdf`,
    "_blank"
  );
}


// =========================================================
// WHATSAPP
// =========================================================

function sendQuoteWhatsApp(id) {

  const quote =
    getAdminQuote(id);

  if (!quote) {

    alert(
      "No se encontró el presupuesto."
    );

    return;
  }

  if (!quote.client_phone) {

    alert(
      "El cliente no tiene un número de teléfono registrado."
    );

    return;
  }

  if (!quote.access_token) {

    alert(
      "Este presupuesto no tiene un enlace público disponible."
    );

    return;
  }

  // -------------------------------------------------------
  // LIMPIAR TELÉFONO
  // -------------------------------------------------------

  let phone =
    String(
      quote.client_phone
    ).replace(
      /\D/g,
      ""
    );

  if (!phone) {

    alert(
      "El número de teléfono no es válido."
    );

    return;
  }

  // -------------------------------------------------------
  // ENLACE PÚBLICO
  // -------------------------------------------------------

  const publicUrl =
    `${window.location.origin}/presupuesto/${quote.access_token}`;

  // -------------------------------------------------------
  // TOTAL
  // -------------------------------------------------------

  const total =
    formatQuoteMoney(
      quote.total
    );

  // -------------------------------------------------------
  // MENSAJE
  // -------------------------------------------------------

  const message =
`Hola ${quote.client_name || ""} 👋

Te envío el presupuesto ${quote.quote_number} de JR Electricidad.

💰 Total: ${total}

Podés consultar el presupuesto completo en el siguiente enlace:

${publicUrl}

Saludos,
JR Electricidad ⚡`;

  // -------------------------------------------------------
  // WHATSAPP
  // -------------------------------------------------------

  const whatsappUrl =
    `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  window.open(
    whatsappUrl,
    "_blank"
  );
}
let quoteRequests = [];
let currentQuoteRequest = null;
let editingQuoteId = null;

// =========================================================
// FORMATO MONEDA PRESUPUESTOS
// =========================================================

function formatQuoteMoney(value) {
  return Number(value || 0).toLocaleString(
    "es-AR",
    {
      style: "currency",
      currency: "ARS"
    }
  );
}


// =========================================================
// CARGAR SOLICITUDES
// =========================================================
async function loadQuoteRequests() {
  const container = $("quoteRequestsList");
  const loading = $("quoteRequestsLoading");
  const pendingCounter = $("pendingQuotesCount");
  const pendingBadge = $("pendingQuotesBadge");

  if (!container) {
    console.error("No existe #quoteRequestsList");
    return;
  }

  // Mostrar loader inicial
  if (loading) {
    loading.style.display = "flex";
  }

  try {
    const data = await api("/api/admin/quote-requests");

    console.log("Solicitudes recibidas:", data);

    quoteRequests = Array.isArray(data)
      ? data
      : (
          Array.isArray(data.requests)
            ? data.requests
            : []
        );

    const pendingCount = quoteRequests.filter(
      request => request.status === "pendiente"
    ).length;

    if (pendingCounter) {
  pendingCounter.textContent = pendingCount;
}

if (pendingBadge) {
  pendingBadge.textContent = pendingCount;
}

    // Ocultar loader
    if (loading) {
    loading.style.display = "none";
	 }
    // Limpiar solamente la lista
    container.innerHTML = "";

    if (!quoteRequests.length) {
      container.innerHTML = `
        <div class="empty-state">

          <div class="empty-state-icon">
            📋
          </div>

          <h3>
            No hay solicitudes
          </h3>

          <p>
            Todavía no recibiste ninguna solicitud de presupuesto.
          </p>

        </div>
      `;

      return;
    }

    quoteRequests.forEach(request => {
      container.insertAdjacentHTML(
        "beforeend",
        renderQuoteRequest(request)
      );
    });

  } catch (error) {
    console.error(
      "Error cargando solicitudes:",
      error
    );

    // Ocultar loader también si hay error
    if (loading) {
      loading.style.display = "none";
    }

    container.innerHTML = `
      <div class="empty-state">

        <div class="empty-state-icon">
          ⚠️
        </div>

        <h3>
          Error al cargar solicitudes
        </h3>

        <p>
          ${escapeHtml(error.message)}
        </p>

        <button
          type="button"
          class="admin-btn"
          onclick="loadQuoteRequests()"
        >
          🔄 Reintentar
        </button>

      </div>
      `;
  }

}

// =========================================================
// MOSTRAR SOLICITUD
// =========================================================

function renderQuoteRequest(request) {
  const statusLabels = {
    pendiente:
      "🟡 Pendiente",

    contactado:
      "🔵 Contactado",

    presupuestado:
      "🟢 Presupuestado",

    cerrado:
      "⚫ Cerrado"
  };

  const status =
    statusLabels[request.status] ||
    request.status ||
    "Pendiente";

  const date =
    request.created_at
      ? new Date(
          request.created_at
        ).toLocaleString(
          "es-AR",
          {
            dateStyle: "short",
            timeStyle: "short"
          }
        )
      : "Sin fecha";

  const initials =
    (request.name || "C")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(
        word =>
          word.charAt(0).toUpperCase()
      )
      .join("");

  return `
    <article class="quote-request-card">

      <div class="quote-request-card-header">

        <div class="quote-request-client">

          <div class="quote-request-avatar">
            ${escapeHtml(initials)}
          </div>

          <div>

            <h3>
              ${escapeHtml(request.name)}
            </h3>

            <div class="quote-request-number">
              Solicitud #${request.id}
            </div>

          </div>

        </div>

        <span class="quote-status">
          ${escapeHtml(status)}
        </span>

      </div>

      <div class="quote-request-info">

        <div class="quote-request-info-row">

          <span>📱</span>

          <span>
            ${escapeHtml(request.phone)}
          </span>

        </div>

        ${
          request.email
            ? `
              <div class="quote-request-info-row">

                <span>✉️</span>

                <span>
                  ${escapeHtml(request.email)}
                </span>

              </div>
            `
            : ""
        }

      </div>

      <div class="quote-request-service">

        <span class="quote-request-service-label">
          Servicio solicitado
        </span>

        <strong>
          ${
            escapeHtml(
              request.service ||
              "Servicio no especificado"
            )
          }
        </strong>

      </div>

      <p class="quote-request-description">
        ${
          escapeHtml(
            request.description ||
            "Sin descripción."
          )
        }
      </p>

      <div class="quote-request-footer">

        <span class="quote-request-date">
          🕐
          ${escapeHtml(date)}
        </span>

        <div class="quote-request-actions">

          <button
            type="button"
            class="quote-view-btn"
            onclick="openQuoteRequest(${request.id})"
          >
            👁 Ver solicitud
          </button>

          ${
            request.status === "pendiente" ||
            request.status === "contactado"
              ? `
                <button
                  type="button"
                  class="quote-create-btn"
                  onclick="startCreateQuote(${request.id})"
                >
                  💰 Crear presupuesto
                </button>
              `
              : ""
          }

        </div>

      </div>

    </article>
  `;
}


// =========================================================
// ABRIR SOLICITUD
// =========================================================

async function openQuoteRequest(id) {
  try {
    const request =
      await api(
        `/api/admin/quote-requests/${id}`
      );

    currentQuoteRequest =
      request;

    const detail =
      $("quoteRequestDetail");

    if (!detail) {
      throw new Error(
        "No existe el contenedor de detalle de la solicitud."
      );
    }

    const statusLabels = {
      pendiente:
        "🟡 Pendiente",

      contactado:
        "🔵 Contactado",

      presupuestado:
        "🟢 Presupuestado",

      cerrado:
        "⚫ Cerrado"
    };

    const status =
      statusLabels[request.status] ||
      request.status ||
      "Pendiente";

    const createdDate =
      request.created_at
        ? new Date(
            request.created_at
          ).toLocaleString(
            "es-AR",
            {
              dateStyle: "long",
              timeStyle: "short"
            }
          )
        : "No disponible";

    let preferredDate =
      "No indicada";

    if (request.preferred_date) {
      const raw =
        String(
          request.preferred_date
        ).slice(0, 10);

      const parts =
        raw.split("-");

      if (parts.length === 3) {
        preferredDate =
          new Date(
            Number(parts[0]),
            Number(parts[1]) - 1,
            Number(parts[2])
          ).toLocaleDateString(
            "es-AR",
            {
              dateStyle: "long"
            }
          );
      }
    }

    detail.innerHTML = `
      <div class="quote-detail-modern">

        <div class="quote-detail-header">

          <div>

            <span class="quote-section-label">
              SOLICITUD DE PRESUPUESTO
            </span>

            <h2>
              Solicitud #${request.id}
            </h2>

          </div>

          <span class="quote-detail-status">
            ${escapeHtml(status)}
          </span>

        </div>

        <div class="quote-detail-block">

          <div class="quote-detail-block-title">

            <span class="quote-detail-block-icon">
              👤
            </span>

            <div>

              <span class="quote-detail-block-label">
                CLIENTE
              </span>

              <h3>
                ${escapeHtml(request.name)}
              </h3>

            </div>

          </div>

          <div class="quote-contact-grid">

            <div class="quote-contact-item">

              <span class="quote-contact-icon">
                📱
              </span>

              <div>

                <small>
                  Teléfono
                </small>

                <strong>
                  ${escapeHtml(request.phone)}
                </strong>

              </div>

            </div>

            <div class="quote-contact-item">

              <span class="quote-contact-icon">
                ✉️
              </span>

              <div>

                <small>
                  Email
                </small>

                <strong>
                  ${
                    escapeHtml(
                      request.email ||
                      "No indicado"
                    )
                  }
                </strong>

              </div>

            </div>

          </div>

        </div>

        <div class="quote-detail-block">

          <div class="quote-detail-block-title">

            <span class="quote-detail-block-icon">
              ⚡
            </span>

            <div>

              <span class="quote-detail-block-label">
                TRABAJO SOLICITADO
              </span>

              <h3>
                ${
                  escapeHtml(
                    request.service ||
                    "Servicio no especificado"
                  )
                }
              </h3>

            </div>

          </div>

          <div class="quote-date-box">

            <span>
              📅
            </span>

            <div>

              <small>
                Fecha preferida
              </small>

              <strong>
                ${escapeHtml(preferredDate)}
              </strong>

            </div>

          </div>

        </div>

        <div class="quote-detail-block">

          <div class="quote-detail-block-title">

            <span class="quote-detail-block-icon">
              📝
            </span>

            <div>

              <span class="quote-detail-block-label">
                DESCRIPCIÓN DEL TRABAJO
              </span>

            </div>

          </div>

          <div class="quote-description-modern">
            ${
              escapeHtml(
                request.description ||
                "El cliente no agregó una descripción."
              )
            }
          </div>

        </div>

        <div class="quote-request-created">

          🕐 Solicitud recibida el

          <strong>
            ${escapeHtml(createdDate)}
          </strong>

        </div>

        <div class="quote-detail-actions-modern">

          <button
            type="button"
            class="quote-modal-secondary"
            onclick="closeQuoteRequestModal()"
          >
            Cerrar
          </button>

          ${
            request.status === "pendiente" ||
            request.status === "contactado"
              ? `
                <button
                  type="button"
                  class="quote-create-large"
                  onclick="startCreateQuote(${request.id})"
                >
                  💰 Crear presupuesto
                </button>
              `
              : ""
          }

        </div>

      </div>
    `;

    const modal =
      $("quoteRequestModal");

    if (!modal) {
      throw new Error(
        "No existe el modal de solicitud."
      );
    }

    modal.style.display =
      "flex";

    modal.classList.add(
      "active"
    );

  } catch (error) {
    console.error(
      "Error abriendo solicitud:",
      error
    );

    alert(
      "No se pudo cargar la solicitud: " +
      error.message
    );
  }
}


// =========================================================
// CERRAR MODAL SOLICITUD
// =========================================================

function closeQuoteRequestModal() {
  const modal =
    $("quoteRequestModal");

  if (!modal) {
    return;
  }

  modal.classList.remove(
    "active"
  );

  modal.style.display =
    "none";
}


const closeQuoteRequestButton =
  $("closeQuoteRequestModal");

if (closeQuoteRequestButton) {
  closeQuoteRequestButton.addEventListener(
    "click",
    closeQuoteRequestModal
  );
}


// =========================================================
// INICIAR PRESUPUESTO
// =========================================================

function startCreateQuote(id) {
  if (id) {
    const found =
      quoteRequests.find(
        request =>
          Number(request.id) === Number(id)
      );

    if (found) {
      currentQuoteRequest =
        found;
    }
  }

  if (!currentQuoteRequest) {
    alert(
      "No se encontró la solicitud."
    );

    return;
  }

  closeQuoteRequestModal();

  const modal =
    $("createQuoteModal");

  if (!modal) {
    alert(
      "No existe el formulario de presupuesto."
    );

    return;
  }

  modal.style.display =
    "flex";

  modal.classList.add(
    "active"
  );

  const requestId =
    $("quoteRequestId");

  if (requestId) {
    requestId.value =
      currentQuoteRequest.id;
  }

  const clientInfo =
    $("quoteClientInfo");

  if (clientInfo) {
    clientInfo.innerHTML = `
      <strong>
        Cliente:
      </strong>

      ${escapeHtml(
        currentQuoteRequest.name
      )}

      <br>

      <strong>
        Servicio:
      </strong>

      ${
        escapeHtml(
          currentQuoteRequest.service ||
          "No especificado"
        )
      }
    `;
  }

  const issueDate =
    $("quoteIssueDate");

  if (issueDate) {
    issueDate.value =
      new Date()
        .toISOString()
        .slice(0, 10);
  }

  const items =
    $("quoteItems");

  if (items) {
    items.innerHTML =
      "";

    addQuoteItem();
  }

  calculateQuoteTotals();
}


// =========================================================
// AGREGAR CONCEPTO
// =========================================================

function addQuoteItem() {
  const container =
    $("quoteItems");

  if (!container) {
    return;
  }

  const row =
    document.createElement(
      "div"
    );

  row.className =
    "quote-item";

  row.innerHTML = `
    <input
      type="text"
      class="quote-item-description"
      placeholder="Ej: Instalación de tablero"
      maxlength="500"
    >

    <input
      type="number"
      class="quote-item-quantity"
      value="1"
      min="0"
      step="0.01"
      placeholder="Cantidad"
    >

    <select
      class="quote-item-unit"
    >

      <option value="unidad">
        Unidad
      </option>

      <option value="hora">
        Hora
      </option>

      <option value="metro">
        Metro
      </option>

      <option value="global">
        Global
      </option>

    </select>

    <input
      type="number"
      class="quote-item-price"
      value="0"
      min="0"
      step="0.01"
      placeholder="Precio"
    >

    <strong class="quote-item-total">
      $0,00
    </strong>

    <button
      type="button"
      class="quote-item-remove"
      title="Eliminar concepto"
    >
      🗑
    </button>
  `;

  container.appendChild(
    row
  );

  row
    .querySelectorAll(
      "input, select"
    )
    .forEach(
      element => {
        element.addEventListener(
          "input",
          calculateQuoteTotals
        );

        element.addEventListener(
          "change",
          calculateQuoteTotals
        );
      }
    );

  row
    .querySelector(
      ".quote-item-remove"
    )
    ?.addEventListener(
      "click",
      () => {
        row.remove();

        calculateQuoteTotals();
      }
    );

  calculateQuoteTotals();
}


const addQuoteItemButton =
  $("addQuoteItem");

if (addQuoteItemButton) {
  addQuoteItemButton.addEventListener(
    "click",
    addQuoteItem
  );
}


// =========================================================
// CALCULAR TOTALES
// =========================================================

function calculateQuoteTotals() {
  let subtotal =
    0;

  document
    .querySelectorAll(
      "#quoteItems .quote-item"
    )
    .forEach(
      row => {
        const quantity =
          Number(
            row.querySelector(
              ".quote-item-quantity"
            )?.value
          ) || 0;

        const price =
          Number(
            row.querySelector(
              ".quote-item-price"
            )?.value
          ) || 0;

        const total =
          quantity * price;

        subtotal +=
          total;

        const totalElement =
          row.querySelector(
            ".quote-item-total"
          );

        if (totalElement) {
          totalElement.textContent =
            formatQuoteMoney(
              total
            );
        }
      }
    );

  const discount =
    Number(
      $("quoteDiscount")?.value
    ) || 0;

  const total =
    Math.max(
      0,
      subtotal - discount
    );

  if ($("quoteSubtotal")) {
    $("quoteSubtotal").textContent =
      formatQuoteMoney(
        subtotal
      );
  }

  if ($("quoteTotal")) {
    $("quoteTotal").textContent =
      formatQuoteMoney(
        total
      );
  }
}


const quoteDiscount =
  $("quoteDiscount");

if (quoteDiscount) {
  quoteDiscount.addEventListener(
    "input",
    calculateQuoteTotals
  );
}


// =========================================================
// CERRAR MODAL CREAR PRESUPUESTO
// =========================================================

function closeCreateQuoteModal() {
  $("createQuoteModal").style.display =
    "none";

  editingQuoteId = null;

  $("createQuoteModalTitle").textContent =
    "Crear presupuesto";

  $("saveQuoteButton").textContent =
    "⚡ Guardar presupuesto";
}


const closeCreateQuoteButton =
  $("closeCreateQuoteModal");

if (closeCreateQuoteButton) {
  closeCreateQuoteButton.addEventListener(
    "click",
    closeCreateQuoteModal
  );
}


// =========================================================
// CREAR PRESUPUESTO
// =========================================================

const createQuoteForm =
  $("createQuoteForm");

if (createQuoteForm) {
  createQuoteForm.addEventListener(
    "submit",
    async function(e) {
      e.preventDefault();

      const items = [];

      document
        .querySelectorAll(
          "#quoteItems .quote-item"
        )
        .forEach(
          row => {
            const description =
              row.querySelector(
                ".quote-item-description"
              )?.value.trim();

            if (!description) {
              return;
            }

            items.push({
              description,

              quantity:
                Number(
                  row.querySelector(
                    ".quote-item-quantity"
                  )?.value
                ) || 0,

              unit:
                row.querySelector(
                  ".quote-item-unit"
                )?.value ||
                "unidad",

              unit_price:
                Number(
                  row.querySelector(
                    ".quote-item-price"
                  )?.value
                ) || 0
            });
          }
        );

      if (!items.length) {
        alert(
          "Agregá al menos un concepto."
        );

        return;
      }

      const quoteRequestId =
        Number(
          $("quoteRequestId")?.value
        );

      if (!quoteRequestId) {
        alert(
          "No se encontró la solicitud asociada."
        );

        return;
      }

      const data = {
        quote_request_id:
          quoteRequestId,

        issue_date:
          $("quoteIssueDate")?.value,

        expiration_date:
          $("quoteExpirationDate")?.value ||
          null,

        notes:
          $("quoteNotes")?.value.trim() ||
          "",

        discount:
          Number(
            $("quoteDiscount")?.value
          ) || 0,

        items
      };

      const button =
        this.querySelector(
          "button[type='submit']"
        );

      if (button) {
        button.disabled =
          true;

        button.textContent =
          "Creando...";
      }

      try {
       const isEditing =
  editingQuoteId !== null;

const url =
  isEditing
    ? `/api/admin/quotes/${editingQuoteId}`
    : "/api/admin/quotes";

const method =
  isEditing
    ? "PUT"
    : "POST";
const result = await api(
  url,
  {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  }
);

       if (isEditing) {
  alert(
    "Presupuesto actualizado correctamente."
  );
} else {
  alert(
    `Presupuesto ${result.quote_number} creado correctamente.`
  );
}

        closeCreateQuoteModal();

        this.reset();

        if ($("quoteItems")) {
          $("quoteItems").innerHTML =
            "";
        }

        await loadQuoteRequests();

        await loadQuotes();

      } catch (error) {
        console.error(
          "Error creando presupuesto:",
          error
        );

        alert(
          "❌ " +
          error.message
        );

      } finally {
  if (button) {
    button.disabled = false;

    button.textContent =
      editingQuoteId !== null
        ? "💾 Guardar cambios"
        : "⚡ Guardar presupuesto";
  }
}
    }
  );
}


// =========================================================
// CERRAR MODALES AL HACER CLICK AFUERA
// =========================================================

const quoteRequestModal =
  $("quoteRequestModal");

if (quoteRequestModal) {
  quoteRequestModal.addEventListener(
    "click",
    event => {
      if (
        event.target ===
        quoteRequestModal
      ) {
        closeQuoteRequestModal();
      }
    }
  );
}


const createQuoteModal =
  $("createQuoteModal");

if (createQuoteModal) {
  createQuoteModal.addEventListener(
    "click",
    event => {
      if (
        event.target ===
        createQuoteModal
      ) {
        closeCreateQuoteModal();
      }
    }
  );
}
// =========================================================
// MODAL RESUMEN PRESUPUESTO
// =========================================================

const quoteSummaryModal =
  $("quoteSummaryModal");

if (quoteSummaryModal) {

  quoteSummaryModal.addEventListener(
    "click",
    event => {

      if (
        event.target ===
        quoteSummaryModal
      ) {
        closeQuoteSummaryModal();
      }

    }
  );

}

// =========================================================
// LOGOUT
// =========================================================

const logoutBtn =
  $("logout");

if (logoutBtn) {
  logoutBtn.onclick =
    async () => {
      try {
        await api(
          "/api/logout",
          {
            method: "POST"
          }
        );
      } finally {
        location.href =
          "/login.html";
      }
    };
}


// =========================================================
// INICIAR PANEL
// =========================================================

if (typeof load === "function") {
  load()
    .then(
      () => {
        console.log("Panel administrativo cargado correctamente.");
      }
    )
    .catch(
      error => {
        console.error(
          "Error cargando panel:",
          error
        );

        showMsg(
          error.message || "No se pudo cargar el panel.",
          true
        );
      }
    );
}


// =========================================================
// AUTENTICACIÓN / SESIÓN
// =========================================================
// =========================================================
// CARGAR SOLICITUDES AL INICIAR
// =========================================================
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
// =========================================================
// NAVEGACIÓN ADMIN — UNA SECCIÓN A LA VEZ
// =========================================================

function setupAdminNavigation() {

  const sections = [
    "dashboardStats",
    "quoteRequestsSection",
    "quotesSection",
    "jobsSection",
    "jobsHistorySection",
    "usersSection",
    "servicesSection",
    "gallerySection",
    "settingsSection"
  ];

  const navItems = document.querySelectorAll(
    ".admin-nav-item[href^='#'], .admin-submenu a[href^='#']"
  );

  function showSection(targetId) {

    sections.forEach(id => {

      const section = document.getElementById(id);

      if (!section) return;

      section.style.display =
        id === targetId ? "" : "none";
    });

    // La bienvenida solamente aparece en Dashboard
    const welcome = document.querySelector(".admin-welcome");

    if (welcome) {
      welcome.style.display =
        targetId === "dashboardStats" ? "" : "none";
    }

    // Mensaje general
    const message = document.getElementById("msg");

    if (message) {
      message.style.display =
        targetId === "dashboardStats" ? "" : "none";
    }

    // Activar la opción seleccionada
    navItems.forEach(item => {

      const href = item.getAttribute("href");

      if (href === `#${targetId}`) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }

    });

    // Volver arriba
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }


  navItems.forEach(item => {

    item.addEventListener("click", event => {

      const href = item.getAttribute("href");

      if (!href || !href.startsWith("#")) {
        return;
      }

      const targetId = href.substring(1);

      if (!sections.includes(targetId)) {
        return;
      }

      event.preventDefault();

      showSection(targetId);

    });

  });


  // Dashboard al entrar
  showSection("dashboardStats");
}
// =========================================================
// SUBMENÚS DEL SIDEBAR
// =========================================================

function setupSidebarMenus() {

  const menuToggles = document.querySelectorAll(
    ".admin-nav-toggle[data-menu]"
  );

  menuToggles.forEach(toggle => {

    toggle.addEventListener("click", () => {

      const menuId = toggle.getAttribute("data-menu");
      const menu = document.getElementById(menuId);

      if (!menu) return;

      const isOpen = menu.classList.contains("open");

      // Cerrar todos los submenús
      document
        .querySelectorAll(".admin-submenu")
        .forEach(submenu => {
          submenu.classList.remove("open");
        });

      document
        .querySelectorAll(".admin-nav-toggle")
        .forEach(button => {
          button.classList.remove("active");
        });

      // Abrir el seleccionado
      if (!isOpen) {
        menu.classList.add("open");
        toggle.classList.add("active");
      }

    });

  });

}

setupSidebarMenus();

// Inicializar navegación
setupAdminNavigation();

loadQuoteRequests();
setupSidebarNotifications();
setupNotifications();
loadNotifications();
setupJobs();
setupJobsHistory();
loadAdminUser();
loadAccountSettings();
setupAccountSettings();