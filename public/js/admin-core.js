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

