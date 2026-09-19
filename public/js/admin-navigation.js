// =========================================================
// NAVEGACIÓN ADMIN — UNA SECCIÓN A LA VEZ
// =========================================================

function setupAdminNavigation() {

  const sections = [
    "dashboardStats",
    "dashboardAnalytics",
    "quoteRequestsSection",
    "quotesSection",
    "jobsSection",
    "jobsHistorySection",
    "clientsSection",
    "usersSection",
    "servicesSection",
    "gallerySection",
    "materialsSection",
    "whatsappSection",
    "emailSection",
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
        (id === targetId || (targetId === "dashboardStats" && id === "dashboardAnalytics")) ? "" : "none";
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



async function loadBusinessSettings() {
  try {
    const data = await api("/api/admin/settings");
    const s = data.settings || {};

    const fields = {
      businessName: s.business_name,
      legalName: s.legal_name,
      businessPhone: s.phone,
      businessWhatsapp: s.whatsapp,
      businessEmail: s.email,
      businessAddress: s.address,
      businessCity: s.city,
      businessHours: s.hours,
      businessLogo: s.logo_url,
      pdfFooter: s.pdf_footer,
      pdfNotes: s.pdf_notes
    };

    Object.entries(fields).forEach(([id, value]) => {
      const el = $(id);
      if (el) el.value = value || "";
    });
  } catch (error) {
    showMsg(error.message, true);
  }
}

function setupBusinessSettings() {
  const form = $("businessSettingsForm");
  if (!form) return;

  loadBusinessSettings();

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const body = {
      business_name: $("businessName")?.value.trim() || "",
      legal_name: $("legalName")?.value.trim() || "",
      phone: $("businessPhone")?.value.trim() || "",
      whatsapp: $("businessWhatsapp")?.value.trim() || "",
      email: $("businessEmail")?.value.trim() || "",
      address: $("businessAddress")?.value.trim() || "",
      city: $("businessCity")?.value.trim() || "",
      hours: $("businessHours")?.value.trim() || "",
      logo_url: $("businessLogo")?.value.trim() || "",
      pdf_footer: $("pdfFooter")?.value.trim() || "",
      pdf_notes: $("pdfNotes")?.value.trim() || ""
    };

    const button = form.querySelector("button[type='submit']");
    if (button) button.disabled = true;

    try {
      const result = await api("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      showMsg(result.message || "Configuración guardada.");
    } catch (error) {
      showMsg(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });
}
