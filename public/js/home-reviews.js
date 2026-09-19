"use strict";

(() => {
  const list = document.getElementById("reviewsList");
  const panel = document.getElementById("reviewPanel");
  const loginHint = document.getElementById("reviewLoginHint");
  const form = document.getElementById("reviewForm");
  const jobSelect = document.getElementById("reviewJob");
  const starsBox = document.getElementById("reviewStars");
  const commentInput = document.getElementById("reviewComment");
  const message = document.getElementById("reviewMessage");

  if (!list) return;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));

  const stars = rating => "★★★★★".split("").map((s, i) =>
    `<span class="${i < Number(rating) ? "is-filled" : ""}">${s}</span>`
  ).join("");

  async function loadPublicReviews() {
    try {
      const response = await fetch("/api/reviews", { headers: { Accept:"application/json" } });
      if (!response.ok) throw new Error();
      const reviews = await response.json();

      if (!Array.isArray(reviews) || !reviews.length) {
        list.innerHTML = '<div class="reviews-empty-v3">Todavía no hay reseñas de clientes. Cuando un cliente comparta su experiencia, aparecerá aquí.</div>';
        return;
      }

      list.innerHTML = reviews.map(review => `
        <article class="review-card-v3">
          <div class="review-stars-display-v3">${stars(review.rating)}</div>
          <p>${escapeHtml(review.comment)}</p>
          <strong>${escapeHtml(review.client_name)}</strong>
          <small>Cliente de JR Electricidad</small>
        </article>
      `).join("");
    } catch {
      list.innerHTML = '<div class="reviews-empty-v3">No se pudieron cargar las reseñas en este momento.</div>';
    }
  }

  async function loadReviewEligibility() {
    try {
      const meResponse = await fetch("/api/me", { headers:{Accept:"application/json"} });
      if (!meResponse.ok) return;
      const me = await meResponse.json();
      if (!me || !me.user) return;

      if (loginHint) loginHint.hidden = true;

      const response = await fetch("/api/reviews/my", { headers:{Accept:"application/json"} });
      if (!response.ok) return;
      const jobs = await response.json();

      const pending = Array.isArray(jobs) ? jobs.filter(job => !job.review_id) : [];
      if (!pending.length) {
        if (panel) panel.hidden = true;
        return;
      }

      if (panel) panel.hidden = false;
      jobSelect.innerHTML = pending.map(job =>
        `<option value="${Number(job.quote_id)}">${escapeHtml(job.service || "Trabajo")} · Presupuesto ${escapeHtml(job.quote_number || "")}</option>`
      ).join("");

      let selectedRating = 5;
      starsBox.innerHTML = [1,2,3,4,5].map(value =>
        `<button type="button" class="review-star-button-v3 is-selected" data-rating="${value}" aria-label="${value} estrellas">${value <= selectedRating ? "★" : "☆"}</button>`
      ).join("");

      const paintStars = rating => {
        selectedRating = rating;
        starsBox.querySelectorAll("button").forEach(button => {
          const value = Number(button.dataset.rating);
          button.classList.toggle("is-selected", value <= rating);
          button.textContent = value <= rating ? "★" : "☆";
        });
      };

      starsBox.addEventListener("click", event => {
        const button = event.target.closest("button[data-rating]");
        if (button) paintStars(Number(button.dataset.rating));
      });

      form.addEventListener("submit", async event => {
        event.preventDefault();
        message.textContent = "";
        const submit = form.querySelector("button[type=submit]");
        submit.disabled = true;

        try {
          const response = await fetch("/api/reviews", {
            method:"POST",
            headers:{"Content-Type":"application/json","Accept":"application/json"},
            body:JSON.stringify({
              quote_id:Number(jobSelect.value),
              rating:selectedRating,
              comment:commentInput.value.trim()
            })
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "No se pudo guardar la reseña.");
          message.textContent = "✅ Gracias por compartir tu experiencia.";
          form.reset();
          panel.hidden = true;
          await loadPublicReviews();
        } catch(error) {
          message.textContent = "❌ " + error.message;
        } finally {
          submit.disabled = false;
        }
      });
    } catch (error) {
      console.error("Error cargando reseñas del cliente:", error);
    }
  }

  loadPublicReviews();
  loadReviewEligibility();
})();
