// =========================================================
// RESEÑAS DE CLIENTES — ADMIN V3
// =========================================================

let adminReviews = [];

function reviewStars(value) {
  const rating = Number(value || 0);
  return "★★★★★".split("").map((star, index) =>
    `<span class="${index < rating ? "is-on" : ""}">${star}</span>`
  ).join("");
}

function reviewStatusLabel(status) {
  return status === "approved" ? "Visible" : "Oculta";
}

function reviewStatusClass(status) {
  return status === "approved" ? "approved" : "hidden";
}

async function loadAdminReviews() {
  const container = $("adminReviewsList");
  if (!container) return;

  container.innerHTML = '<div class="admin-reviews-empty">Cargando reseñas...</div>';

  try {
    const data = await api("/api/admin/reviews");
    adminReviews = Array.isArray(data.reviews) ? data.reviews : [];

    if (!adminReviews.length) {
      container.innerHTML = `
        <div class="admin-reviews-empty">
          <div class="admin-reviews-empty-icon">⭐</div>
          <strong>Todavía no hay reseñas</strong>
          <p>Las reseñas aparecerán acá cuando un cliente complete un trabajo y deje su valoración.</p>
        </div>
      `;
      updateAdminReviewSummary();
      return;
    }

    container.innerHTML = `
      <div class="admin-reviews-table-wrap">
        <table class="admin-reviews-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Trabajo</th>
              <th>Calificación</th>
              <th>Comentario</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${adminReviews.map(review => `
              <tr>
                <td>
                  <strong>${h(review.user_name || "Cliente")}</strong>
                  <small>${h(review.user_email || "")}</small>
                </td>
                <td>
                  <strong>${h(review.service || "Trabajo")}</strong>
                  <small>Solicitud #${h(review.quote_id || "-")}</small>
                </td>
                <td>
                  <div class="admin-review-stars" aria-label="${Number(review.rating)} de 5">
                    ${reviewStars(review.rating)}
                  </div>
                </td>
                <td class="admin-review-comment">${h(review.comment || "")}</td>
                <td>${review.created_at ? new Date(review.created_at).toLocaleDateString("es-AR") : "-"}</td>
                <td><span class="admin-review-status ${reviewStatusClass(review.status)}">${reviewStatusLabel(review.status)}</span></td>
                <td>
                  <button
                    type="button"
                    class="btn tiny ${review.status === "approved" ? "danger" : ""}"
                    onclick="toggleAdminReviewStatus(${Number(review.id)}, '${review.status === "approved" ? "hidden" : "approved"}')"
                  >
                    ${review.status === "approved" ? "Ocultar" : "Publicar"}
                  </button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    updateAdminReviewSummary();
  } catch (error) {
    container.innerHTML = `<div class="admin-error">${h(error.message)}</div>`;
  }
}

function updateAdminReviewSummary() {
  const total = adminReviews.length;
  const visible = adminReviews.filter(x => x.status === "approved").length;
  const hidden = total - visible;
  const average = total
    ? (adminReviews.reduce((sum, item) => sum + Number(item.rating || 0), 0) / total).toFixed(1)
    : "—";

  $("adminReviewsTotal")?.replaceChildren(document.createTextNode(String(total)));
  $("adminReviewsVisible")?.replaceChildren(document.createTextNode(String(visible)));
  $("adminReviewsHidden")?.replaceChildren(document.createTextNode(String(hidden)));
  $("adminReviewsAverage")?.replaceChildren(document.createTextNode(average));
}

async function toggleAdminReviewStatus(id, status) {
  try {
    await api(`/api/admin/reviews/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });

    showMsg(status === "approved" ? "Reseña publicada." : "Reseña ocultada.");
    await loadAdminReviews();
  } catch (error) {
    showMsg(error.message, true);
  }
}

function setupAdminReviews() {
  $("refreshAdminReviews")?.addEventListener("click", loadAdminReviews);
}
