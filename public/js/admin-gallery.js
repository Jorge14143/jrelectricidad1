let adminGalleryData = [];

async function loadGallery() {
  const container = $("adminGallery");
  if (!container) return;
  try {
    adminGalleryData = await api("/api/admin/gallery");
    renderAdminGallery();
  } catch (e) { console.error("Error cargando galería:", e); showMsg("No se pudo cargar la galería: " + e.message, true); }
}

function renderAdminGallery() {
  const container = $("adminGallery");
  if (!container) return;
  const search = ($("gallerySearch")?.value || "").trim().toLowerCase();
  const filter = $("galleryStatusFilter")?.value || "";
  const items = adminGalleryData.filter(x => {
    const text = (String(x.title || "") + " " + String(x.description || "")).toLowerCase();
    return (!search || text.includes(search)) && (!filter || (filter === "active" && Number(x.active) === 1) || (filter === "inactive" && Number(x.active) === 0) || (filter === "featured" && Number(x.featured) === 1));
  });
  if (!items.length) { container.innerHTML = '<p class="muted gallery-empty">No hay trabajos que coincidan con los filtros.</p>'; return; }
  container.innerHTML = items.map(x => `<article class="gallery-admin-item ${x.active ? "" : "inactive"}"><div class="gallery-admin-image"><img src="${h(x.image_url)}" alt="${h(x.title)}" loading="lazy"></div><div class="gallery-admin-info"><div class="gallery-admin-title"><h3>${h(x.title)}</h3><span class="status ${x.active ? "on" : "off"}">${x.active ? "Publicado" : "Oculto"}</span></div><p>${h(x.description || "Sin descripción")}</p><div class="gallery-admin-badges">${x.featured ? '<span class="gallery-featured-badge">⭐ Destacado</span>' : ""}<small class="muted">${h(x.image_url || "")}</small></div><div class="row-actions"><button class="btn tiny ghost" onclick="moveGallery(${x.id}, 'up')">⬆️</button><button class="btn tiny ghost" onclick="moveGallery(${x.id}, 'down')">⬇️</button><button class="btn tiny" onclick='editGallery(${JSON.stringify(x)})'>Editar</button><button class="btn tiny ghost" onclick="toggleGallery(${x.id}, ${x.active ? 1 : 0})">${x.active ? "Ocultar" : "Publicar"}</button><button class="btn tiny danger" onclick="deleteGallery(${x.id}, '${h(x.title)}')">Eliminar</button></div></div></article>`).join("");
}

function setupGalleryFilters() {
  $("gallerySearch")?.addEventListener("input", renderAdminGallery);
  $("galleryStatusFilter")?.addEventListener("change", renderAdminGallery);
  $("clearGalleryFilters")?.addEventListener("click", () => { $("gallerySearch").value = ""; $("galleryStatusFilter").value = ""; renderAdminGallery(); });
  $("refreshGallery")?.addEventListener("click", loadGallery);
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


