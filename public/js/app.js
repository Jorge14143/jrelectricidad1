async function loadServices() {
  const box = document.getElementById("services");

  if (!box) return;

  try {
    const response = await fetch("/api/services");

    if (!response.ok) {
      throw new Error("No se pudieron obtener los servicios");
    }

    const services = await response.json();

    if (!services.length) {
      box.innerHTML = `
        <div class="empty-services">
          <div class="empty-icon">⚡</div>
          <h3>Próximamente</h3>
          <p>Estamos actualizando nuestros servicios.</p>
        </div>
      `;
      return;
    }

    const icons = [
      "⚡",
      "🔧",
      "🧰",
      "💡",
      "🏠",
      "🛠️"
    ];

    box.innerHTML = services.map((service, index) => {

      const title = escapeHtml(service.title);

      const description = escapeHtml(
        service.description ||
        "Servicio eléctrico profesional."
      );

      const icon = icons[index % icons.length];

      const price =
        service.price !== null &&
        service.price !== undefined
          ? `
            <div class="service-price">
              $ ${Number(service.price).toLocaleString("es-AR")}
            </div>
          `
          : `
            <div class="service-price">
              Consultar presupuesto
            </div>
          `;

      const whatsappMessage =
        encodeURIComponent(
          `Hola Jorge, quisiera consultar por el servicio: ${service.title}`
        );

      return `
        <article class="service service-reveal">

          <div class="service-icon">
            ${icon}
          </div>

          <h3>
            ${title}
          </h3>

          <p>
            ${description}
          </p>

          ${price}

          <a
            class="service-button"
            href="https://wa.me/543385684660?text=${whatsappMessage}"
            target="_blank"
            rel="noopener"
          >
            💬 Consultar
          </a>

        </article>
      `;

    }).join("");
// =========================================================
// ANIMACIÓN ESCALONADA DE SERVICIOS
// =========================================================

const serviceCards =
  box.querySelectorAll(".service-reveal");

serviceCards.forEach((card, index) => {

  setTimeout(() => {
    card.classList.add("service-visible");
  }, index * 120);

});
  } catch (error) {

    console.error(
      "Error cargando servicios:",
      error
    );

    box.innerHTML = `
      <div class="empty-services">
        <div class="empty-icon">⚠️</div>
        <h3>No se pudieron cargar los servicios</h3>
        <p>Intentá actualizar la página.</p>
      </div>
    `;
  }
}


function escapeHtml(value) {

  return String(value).replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character])
  );
}


loadServices();
async function loadUser() {

  const menu = document.getElementById("user-menu");

  if (!menu) return;

  try {

    const response = await fetch("/api/me");

    if (!response.ok) {
      return;
    }

    const data = await response.json();

    if (!data.user) {
      return;
    }

    const user = data.user;

    menu.innerHTML = `
      <div class="user-dropdown">

        <button
          class="user-button"
          id="user-button"
          type="button"
        >
          <span class="user-avatar">
            👤
          </span>

          <span class="user-name">
            ${escapeHtml(user.name)}
          </span>

          <span class="user-arrow">
            ▾
          </span>
        </button>


        <div
          class="user-dropdown-menu"
          id="user-dropdown-menu"
        >

          <div class="user-dropdown-header">

            <strong>
              ${escapeHtml(user.name)}
            </strong>

            <small>
              ${escapeHtml(user.email)}
            </small>

          </div>


          <div class="user-dropdown-line"></div>


          <a href="/">
            🏠 Inicio
          </a>
		  
		  <a href="/cuenta.html">
             👤 Mi cuenta
          </a>


          ${
            user.role === "admin"
              ? `
                <a href="/admin">
                  ⚙️ Panel de administración
                </a>
              `
              : ""
          }


          <button
            id="logout-btn"
            type="button"
          >
            🚪 Cerrar sesión
          </button>

        </div>

      </div>
    `;


    const userButton =
      document.getElementById("user-button");

    const dropdown =
      document.getElementById("user-dropdown-menu");


    userButton.addEventListener("click", function(event) {

      event.stopPropagation();

      dropdown.classList.toggle("show");

    });


    document.addEventListener("click", function() {

      dropdown.classList.remove("show");

    });


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

  document.body.classList.add("lightbox-open");
}

function closeLightbox() {
  if (!lightbox) return;

  lightbox.classList.remove("active");

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
// FORMULARIO DE SOLICITUD DE PRESUPUESTO
// ========================================

const quoteForm = document.getElementById("quoteForm");
const quoteMessage = document.getElementById("quoteMessage");

if (quoteForm) {

  quoteForm.addEventListener("submit", async function (e) {

    e.preventDefault();

    const submitButton =
      quoteForm.querySelector("button[type='submit']");

    const formData = new FormData(quoteForm);

    const data = {
      name: formData.get("name"),
      phone: formData.get("phone"),
      email: formData.get("email"),
      service: formData.get("service"),
      description: formData.get("description"),
      preferred_date: formData.get("preferred_date")
    };

    quoteMessage.textContent = "";
    quoteMessage.className = "quote-message";

    submitButton.disabled = true;
    submitButton.textContent = "Enviando...";

    try {

      const response = await fetch("/api/quote-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "No se pudo enviar la solicitud."
        );
      }

      quoteMessage.textContent =
        "✅ ¡Solicitud enviada correctamente! Te contactaré a la brevedad.";

      quoteMessage.classList.add("success");

      quoteForm.reset();

    } catch (error) {

      console.error(
        "Error enviando presupuesto:",
        error
      );

      quoteMessage.textContent =
        "❌ " + error.message;

      quoteMessage.classList.add("error");

    } finally {

      submitButton.disabled = false;
      submitButton.textContent =
        "⚡ Solicitar presupuesto";
    }

  });

}
loadGallery();

loadUser();