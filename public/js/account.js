async function loadAccount() {

  const message =
    document.getElementById("account-message");

  const dataBox =
    document.getElementById("account-data");


  try {

    const response =
      await fetch("/api/me");


    if (!response.ok) {

      window.location.href =
        "/login.html";

      return;

    }


    const data =
      await response.json();


    if (!data.user) {

      window.location.href =
        "/login.html";

      return;

    }


    const user =
      data.user;


    document.getElementById("account-name")
      .textContent =
        user.name || "-";


    document.getElementById("account-email")
      .textContent =
        user.email || "-";


    document.getElementById("account-role")
      .textContent =
        user.role === "admin"
          ? "Administrador"
          : "Usuario";


    if (user.role === "admin") {

      document.getElementById("admin-link")
        .style.display =
          "inline-block";

    }


    message.style.display =
      "none";

    dataBox.style.display =
      "grid";


  } catch (error) {

    console.error(error);

    message.textContent =
      "No se pudo cargar la información.";

  }

}



// =========================
// CAMBIAR CORREO
// =========================

document
  .getElementById("email-form")
  .addEventListener("submit", async function(event) {

    event.preventDefault();


    const newEmail =
      document
        .getElementById("new-email")
        .value
        .trim();


    const currentPassword =
      document
        .getElementById("email-current-password")
        .value;


    const message =
      document.getElementById("email-message");


    message.textContent =
      "Actualizando...";


    try {

      const response =
        await fetch("/api/account/email", {

          method: "PUT",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            newEmail,
            currentPassword
          })

        });


      const data =
        await response.json();


      if (!response.ok) {

        message.textContent =
          data.error ||
          "No se pudo cambiar el correo.";

        return;

      }


      document.getElementById("account-email")
        .textContent =
          data.user.email;


      document.getElementById(
        "email-current-password"
      ).value = "";


      document.getElementById(
        "new-email"
      ).value = "";


      message.textContent =
        "✅ Correo actualizado correctamente.";

    } catch (error) {

      console.error(error);

      message.textContent =
        "No se pudo conectar con el servidor.";

    }

  });



// =========================
// CAMBIAR CONTRASEÑA
// =========================

document
  .getElementById("password-form")
  .addEventListener("submit", async function(event) {

    event.preventDefault();


    const currentPassword =
      document
        .getElementById("current-password")
        .value;


    const newPassword =
      document
        .getElementById("new-password")
        .value;


    const confirmPassword =
      document
        .getElementById("confirm-password")
        .value;


    const message =
      document.getElementById(
        "password-message"
      );


    if (newPassword !== confirmPassword) {

      message.textContent =
        "❌ Las nuevas contraseñas no coinciden.";

      return;

    }


    message.textContent =
      "Actualizando...";


    try {

      const response =
        await fetch(
          "/api/account/password",
          {

            method: "PUT",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              currentPassword,
              newPassword
            })

          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        message.textContent =
          data.error ||
          "No se pudo cambiar la contraseña.";

        return;

      }


      document.getElementById(
        "current-password"
      ).value = "";


      document.getElementById(
        "new-password"
      ).value = "";


      document.getElementById(
        "confirm-password"
      ).value = "";


      message.textContent =
        "✅ Contraseña actualizada correctamente.";

    } catch (error) {

      console.error(error);

      message.textContent =
        "No se pudo conectar con el servidor.";

    }

  });


loadAccount();
