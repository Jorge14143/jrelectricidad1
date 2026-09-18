"use strict";

async function loadGallery() {
  const gallery = document.getElementById("gallery");
  if (!gallery) return;

  try {
    const response = await fetch("/api/gallery", {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("No se pudo cargar la galería.");
    }

    const works = await response.json();

    if (!Array.isArray(works) || !works.length) {
      gallery.innerHTML = `
        <div class="gallery-empty">
          <span>⚡</span>
          <p>Próximamente mostraremos nuestros trabajos realizados.</p>
        </div>
      `;
      return;
    }

    gallery.innerHTML = works.map(work => `
      <article class="gallery-item" tabindex="0" role="button"
        aria-label="Ver trabajo: ${escapeHtml(work.title)}">
        <img
          src="${escapeHtml(work.image_url)}"
          alt="${escapeHtml(work.title)}"
          loading="lazy"
          decoding="async"
        >
        <div class="gallery-info">
          ${work.featured ? '<span class="gallery-featured-label">⭐ TRABAJO DESTACADO</span>' : ""}
          <h3>${escapeHtml(work.title)}</h3>
          ${work.description ? `<p>${escapeHtml(work.description)}</p>` : ""}
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

const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxTitle = document.getElementById("lightboxTitle");
const lightboxDescription = document.getElementById("lightboxDescription");
const lightboxClose = document.getElementById("lightboxClose");

function openLightbox(work) {
  if (!lightbox || !lightboxImage) return;

  lightboxImage.src = work.image_url;
  lightboxImage.alt = work.title || "Trabajo realizado";
  if (lightboxTitle) lightboxTitle.textContent = work.title || "";
  if (lightboxDescription) lightboxDescription.textContent = work.description || "";

  lightbox.classList.add("active");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("lightbox-open");
  lightboxClose?.focus();
}

function closeLightbox() {
  if (!lightbox) return;

  lightbox.classList.remove("active");
  lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("lightbox-open");

  if (lightboxImage) {
    lightboxImage.src = "";
  }
}

lightboxClose?.addEventListener("click", closeLightbox);

lightbox?.addEventListener("click", event => {
  if (event.target === lightbox) closeLightbox();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeLightbox();
});

document.addEventListener("click", event => {
  const item = event.target.closest(".gallery-item");
  if (!item) return;

  const image = item.querySelector("img");
  if (!image) return;

  openLightbox({
    image_url: image.currentSrc || image.src,
    title: item.querySelector(".gallery-info h3")?.textContent || "",
    description: item.querySelector(".gallery-info p")?.textContent || ""
  });
});

document.addEventListener("keydown", event => {
  if (!["Enter", " "].includes(event.key)) return;

  const item = event.target.closest(".gallery-item");
  if (!item) return;

  event.preventDefault();
  item.click();
});

loadGallery();
