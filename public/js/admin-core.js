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

    if (newPassword.length < 12) {
      showSettingsMessage(
        "La nueva contraseña debe tener al menos 12 caracteres.",
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

async function loadBusinessSettings() {
  try {
    const data = await api("/api/admin/settings");
    const s = data?.settings || {};
    const map = {
      businessName:"business_name", legalName:"legal_name", businessPhone:"phone",
      businessWhatsapp:"whatsapp", businessEmail:"email", businessCity:"city",
      businessAddress:"address", businessHours:"hours", businessLogo:"logo_url",
      pdfFooter:"pdf_footer", pdfNotes:"pdf_notes", currencyCode:"currency_code",
      currencySymbol:"currency_symbol", taxName:"tax_name", taxRate:"tax_rate",
      quotePrefix:"quote_prefix", quoteNextNumber:"quote_next_number",
      jobPrefix:"job_prefix", jobNextNumber:"job_next_number",
      quoteValidityDays:"quote_validity_days", quoteDefaultNotes:"quote_default_notes",
      quoteTerms:"quote_terms", commercialConditions:"commercial_conditions"
    };
    for (const [id,key] of Object.entries(map)) {
      const el = $(id);
      if (el) el.value = s[key] ?? "";
    }
    if ($("whatsappEnabled")) $("whatsappEnabled").checked = Boolean(s.whatsapp_enabled);
    if ($("whatsappAutoNotifications")) $("whatsappAutoNotifications").checked = Boolean(s.whatsapp_auto_notifications);
    if ($("taxEnabled")) $("taxEnabled").checked = Boolean(s.tax_enabled);
  } catch (error) {
    console.error("No se pudo cargar la configuración comercial:", error);
  }
}

function setupBusinessSettings() {
  const form = $("businessSettingsForm");
  if (!form) return;

  loadBusinessSettings();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      business_name: $("businessName")?.value.trim(),
      legal_name: $("legalName")?.value.trim(),
      phone: $("businessPhone")?.value.trim(),
      whatsapp: $("businessWhatsapp")?.value.trim(),
      whatsapp_enabled: Boolean($("whatsappEnabled")?.checked),
      whatsapp_auto_notifications: Boolean($("whatsappAutoNotifications")?.checked),
      email: $("businessEmail")?.value.trim(),
      address: $("businessAddress")?.value.trim(),
      city: $("businessCity")?.value.trim(),
      hours: $("businessHours")?.value.trim(),
      logo_url: $("businessLogo")?.value.trim(),
      pdf_footer: $("pdfFooter")?.value.trim(),
      pdf_notes: $("pdfNotes")?.value.trim(),
      currency_code: $("currencyCode")?.value.trim(),
      currency_symbol: $("currencySymbol")?.value.trim(),
      tax_enabled: Boolean($("taxEnabled")?.checked),
      tax_name: $("taxName")?.value.trim(),
      tax_rate: Number($("taxRate")?.value || 0),
      quote_prefix: $("quotePrefix")?.value.trim(),
      quote_next_number: Number($("quoteNextNumber")?.value || 1),
      job_prefix: $("jobPrefix")?.value.trim(),
      job_next_number: Number($("jobNextNumber")?.value || 1),
      quote_validity_days: Number($("quoteValidityDays")?.value || 15),
      quote_default_notes: $("quoteDefaultNotes")?.value.trim(),
      quote_terms: $("quoteTerms")?.value.trim(),
      commercial_conditions: $("commercialConditions")?.value.trim()
    };

    try {
      const data = await api("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      showSettingsMessage(data.message || "Configuración guardada correctamente.", "success");
      await loadBusinessSettings();
    } catch (error) {
      showSettingsMessage(error.message || "No se pudo guardar la configuración.", "error");
    }
  });
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

