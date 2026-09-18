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
    "clientsSection",
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
setupClients();

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
