    dropdown.addEventListener("click", function(event) {

      event.stopPropagation();

    });


    document
      .getElementById("logout-btn")
      .addEventListener("click", logoutUser);


  } catch (error) {

    console.error(
      "Error obteniendo usuario:",
      error
    );

  }
}


async function logoutUser() {

  try {

    await fetch("/api/logout", {
      method: "POST"
    });

    window.location.href = "/";

  } catch (error) {

    console.error(
      "Error cerrando sesión:",
      error
    );

  }

}
async function loadGallery() {
  const gallery = document.getElementById("gallery");

  if (!gallery) return;

  try {
    const response = await fetch("/api/gallery");

    if (!response.ok) {
      throw new Error("No se pudo cargar la galería.");
    }

    const works = await response.json();

    if (!works.length) {
      gallery.innerHTML = `
        <div class="gallery-empty">
          <span>⚡</span>
          <p>Próximamente mostraremos nuestros trabajos realizados.</p>
        </div>
      `;
      return;
    }

    gallery.innerHTML = works.map(work => `
      <article class="gallery-item">
        <img
          src="${escapeHtml(work.image_url)}"
          alt="${escapeHtml(work.title)}"
          loading="lazy"
        >

        <div class="gallery-info">
          ${work.featured ? '<span class="gallery-featured-label">⭐ TRABAJO DESTACADO</span>' : ""}
          <h3>${escapeHtml(work.title)}</h3>
          ${
            work.description
              ? `<p>${escapeHtml(work.description)}</p>`
              : ""
          }
        </div>
      </article>
    `).join("");

  } catch (error) {
    console.error("Error cargando galería:", error);

    gallery.innerHTML = `
      <div class="gallery-empty">
        <span>⚠️</span>
        <p>No se pudieron cargar los trabajos.</p>
      </div>
    `;
  }
}
// ================================
// VISOR DE IMÁGENES - LIGHTBOX
// ================================

const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxTitle = document.getElementById("lightboxTitle");
const lightboxDescription = document.getElementById("lightboxDescription");
const lightboxClose = document.getElementById("lightboxClose");

function openLightbox(work) {
  if (!lightbox) return;

  lightboxImage.src = work.image_url;
  lightboxImage.alt = work.title || "Trabajo realizado";

  lightboxTitle.textContent = work.title || "";

  lightboxDescription.textContent =
    work.description || "";

  lightbox.classList.add("active");
  lightbox.setAttribute("aria-hidden", "false");

  document.body.classList.add("lightbox-open");
}

function closeLightbox() {
  if (!lightbox) return;

  lightbox.classList.remove("active");
  lightbox.setAttribute("aria-hidden", "true");

  document.body.classList.remove("lightbox-open");

  lightboxImage.src = "";
}

// Cerrar con botón
if (lightboxClose) {
  lightboxClose.addEventListener("click", closeLightbox);
}

// Cerrar haciendo clic en el fondo
if (lightbox) {
  lightbox.addEventListener("click", function (e) {
    if (e.target === lightbox) {
      closeLightbox();
    }
  });
}

// Cerrar con ESC
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    closeLightbox();
  }
});

// Abrir imagen de la galería
document.addEventListener("click", function (e) {

  const item = e.target.closest(".gallery-item");

  if (!item) return;

  const image = item.querySelector("img");

  if (!image) return;

  const title =
    item.querySelector(".gallery-info h3")?.textContent || "";

  const description =
    item.querySelector(".gallery-info p")?.textContent || "";

  openLightbox({
    image_url: image.src,
    title: title,
    description: description
  });
});
// ========================================
