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


