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


const closeCreateQuoteModalButton =
  document.getElementById("closeCreateQuoteModalBtn");

if (closeCreateQuoteModalButton) {
  closeCreateQuoteModalButton.addEventListener(
    "click",
    closeCreateQuoteModal
  );
}


if (typeof setupJobsHistory === "function") {
  setupJobsHistory();
}

if (typeof setupQuoteRequestFilters === "function") {
  setupQuoteRequestFilters();
}

setupGalleryFilters();
