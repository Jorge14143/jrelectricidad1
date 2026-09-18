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

    const imageFile = formData.get("image");
    if (imageFile && imageFile.size > 0) {
      data.image = imageFile;
    }

    quoteMessage.textContent = "";
    quoteMessage.className = "quote-message";

    submitButton.disabled = true;
    submitButton.textContent = "Enviando...";

    try {

      const requestData = new FormData();

      Object.entries(data).forEach(([key, value]) => {
        requestData.append(key, value);
      });

      const response = await fetch("/api/quote-requests", {
        method: "POST",
        body: requestData
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
