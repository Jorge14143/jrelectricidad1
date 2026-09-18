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
