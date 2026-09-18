let adminGalleryData = [];

// =========================================================
// GALERÍA - CARGAR
// =========================================================

async function loadGallery() {
  const container = $("adminGallery");
  if (!container) return;
  try {
    adminGalleryData = await api("/api/admin/gallery");
    renderAdminGallery();
  } catch (e) {
    console.error("Error cargando galería:", e);
    showMsg("No se pudo cargar la galería: " + e.message, true);
  }
}

function renderAdminGallery() {
  const container = $("adminGallery");
  if (!container) return;
  const search = ($("gallerySearch")?.value || "").trim().toLowerCase();
  const filter = $("galleryStatusFilter")?.value || "";
  const items = adminGalleryData.filter(item => {
    const text = (String(item.title || "") + " " + String(item.description || "")).toLowerCase();
    if (search && !text.includes(search)) return false;
    if (!filter) return true;
    if (filter === "active") return Number(item.active) === 1;
    if (filter === "inactive") return Number(item.active) === 0;
    if (filter === "featured") return Number(item.featured) === 1;
    return true;
  });
  if (!items.length) {
    container.innerHTML = '<p class="muted gallery-empty">No hay trabajos que coincidan con los filtros.</p>';
    return;
  }
  container.innerHTML = items.map(x => {
    const safeTitle = h(x.title || "");
    const safeImage = h(x.image_url || "");
    const safeDescription = h(x.description || "Sin descripción");
    const active = Number(x.active) === 1;
    const featured = Number(x.featured) === 1;
    return '<article class="gallery-admin-item ' + (active ? "" : "inactive") + '">' +
      '<div class="gallery-admin-image"><img src="' + safeImage + '" alt="' + safeTitle + '" loading="lazy"></div>' +
      '<div class="gallery-admin-info"><div class="gallery-admin-title"><h3>' + safeTitle + '</h3>' +
      '<span class="status ' + (active ? "on" : "off") + '">' + (active ? "Publicado" : "Oculto") + '</span></div>' +
      '<p>' + safeDescription + '</p><div class="gallery-admin-badges">' +
      (featured ? '<span class="gallery-featured-badge">⭐ Destacado</span>' : "") +
      '<small class="muted">' + safeImage + '</small></div><div class="row-actions">' +
      '<button class="btn tiny ghost" type="button" onclick="moveGallery(' + Number(x.id) + ', \'up\')">⬆️</button>' +
      '<button class="btn tiny ghost" type="button" onclick="moveGallery(' + Number(x.id) + ', \'down\')">⬇️</button>' +
      '<button class="btn tiny" type="button" onclick=\'editGallery(' + JSON.stringify(x).replace(/'/g, "&#39;") + ')\'>Editar</button>' +
      '<button class="btn tiny ghost" type="button" onclick="toggleGallery(' + Number(x.id) + ', ' + (active ? 1 : 0) + ')">' + (active ? "Ocultar" : "Publicar") + '</button>' +
      '<button class="btn tiny danger" type="button" onclick="deleteGallery(' + Number(x.id) + ', \' ' + h(x.title || "") + '\')">Eliminar</button>' +
      '</div></div></article>';
  }).join("");
}

function setupGalleryFilters() {
  $("gallerySearch")?.addEventListener("input", renderAdminGallery);
  $("galleryStatusFilter")?.addEventListener("change", renderAdminGallery);
  $("clearGalleryFilters")?.addEventListener("click", () => {
    if ($("gallerySearch")) $("gallerySearch").value = "";
    if ($("galleryStatusFilter")) $("galleryStatusFilter").value = "";
    renderAdminGallery();
  });
  $("refreshGallery")?.addEventListener("click", loadGallery);
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
// GALERÍA - ORDEN
// =========================================================

async function moveGallery(id, direction) {
  const current = adminGalleryData
    .find(item => Number(item.id) === Number(id));

  if (!current) {
    showMsg("Trabajo no encontrado.", true);
    return;
  }

  const ordered = [...adminGalleryData]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  const index = ordered.findIndex(
    item => Number(item.id) === Number(id)
  );

  const targetIndex =
    direction === "up" ? index - 1 : index + 1;

  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) {
    return;
  }

  const target = ordered[targetIndex];

  try {
    await api(`/api/admin/gallery/${current.id}/order`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        targetId: Number(target.id)
      })
    });

    await loadGallery();
  } catch (e) {
    console.error("Error cambiando orden de galería:", e);
    showMsg(e.message || "No se pudo cambiar el orden.", true);
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


