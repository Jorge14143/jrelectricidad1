// =========================================================
// CARGAR PANEL
// =========================================================

async function load() {
  try {
    const [
      users,
      services,
      stats
    ] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/services"),
      api("/api/admin/stats")
    ]);

    await loadClients();

    // =====================================================
    // ESTADÍSTICAS
    // =====================================================

    if ($("statUsers")) {
      $("statUsers").textContent = stats.users;
    }

    if ($("statServices")) {
      $("statServices").textContent = stats.services;
    }

    if ($("statActive")) {
      $("statActive").textContent = stats.activeServices;
    }
if ($("statAcceptedQuotes")) {
  $("statAcceptedQuotes").textContent =
    stats.acceptedQuotes;
}

if ($("statJobsInProgress")) {
  $("statJobsInProgress").textContent =
    stats.jobsInProgress;
}

if ($("statCompletedJobs")) {
  $("statCompletedJobs").textContent =
    stats.completedJobs;
}




    // =====================================================
    // USUARIOS
    // =====================================================

    if ($("users")) {
      $("users").innerHTML = users.length
        ? `
          <table class="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              ${users.map(x => `
                <tr>
                  <td>${h(x.name)}</td>

                  <td>${h(x.email)}</td>

                  <td>
                    <span class="role ${x.role}">
                      ${h(x.role)}
                    </span>
                  </td>

                  <td class="row-actions">

                    <button
                      class="btn tiny"
                      onclick="toggleRole(${x.id}, '${x.role}')"
                    >
                      ${
                        x.role === "admin"
                          ? "Hacer usuario"
                          : "Hacer admin"
                      }
                    </button>

                    <button
                      class="btn tiny danger"
                      onclick="deleteUser(${x.id}, '${h(x.name)}')"
                    >
                      Eliminar
                    </button>

                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `
        : `
          <p class="muted">
            No hay usuarios registrados.
          </p>
        `;
    }

    // =====================================================
    // SERVICIOS
    // =====================================================

    if ($("adminServices")) {
      $("adminServices").innerHTML = services.length
        ? services.map(x => `
          <div class="service-row ${x.active ? "" : "inactive"}">

            <div class="service-info">

              <div class="service-title-line">

                <b>${h(x.title)}</b>

                <span class="status ${x.active ? "on" : "off"}">
                  ${x.active ? "Activo" : "Oculto"}
                </span>

              </div>

              <small>
                ${h(x.description || "Sin descripción")}
              </small>

              <strong class="service-price">
                ${money(x.price)}
              </strong>

            </div>

            <div class="row-actions">

              <button
                class="btn tiny"
                onclick='editService(${JSON.stringify(x)})'
              >
                Editar
              </button>

              <button
                class="btn tiny ghost"
                onclick="toggleService(${x.id}, ${x.active ? 1 : 0})"
              >
                ${x.active ? "Ocultar" : "Publicar"}
              </button>

              <button
                class="btn tiny danger"
                onclick="del(${x.id})"
              >
                Eliminar
              </button>

            </div>

          </div>
        `).join("")
        : `
          <p class="muted">
            No hay servicios.
          </p>
        `;
    }

    // =====================================================
    // GALERÍA
    // =====================================================

    await loadGallery();

    // =====================================================
    // PRESUPUESTOS GUARDADOS
    // =====================================================

    await loadQuotes();

  } catch (e) {
    console.error("Error cargando panel:", e);

    showMsg(
      e.message,
      true
    );
  }
}


