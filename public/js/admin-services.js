// =========================================================
// SERVICIOS
// =========================================================

function editService(x) {
  $("serviceId").value = x.id;

  $("serviceTitle").value =
    x.title || "";

  $("serviceDescription").value =
    x.description || "";

  $("serviceCategory").value =
    x.category || "";

  $("serviceOrder").value =
    x.sort_order ?? "";

  $("servicePrice").value =
    x.price ?? "";

  $("serviceFormTitle").textContent =
    "Editar servicio";

  $("serviceSubmit").textContent =
    "Guardar cambios";

  $("cancelEdit").hidden =
    false;

  window.scrollTo({
    top: 120,
    behavior: "smooth"
  });
}


function resetServiceForm() {
  const form = $("serviceForm");

  if (form) {
    form.reset();
  }

  $("serviceId").value = "";

  if ($("serviceCategory")) $("serviceCategory").value = "";
  if ($("serviceOrder")) $("serviceOrder").value = "";

  $("serviceFormTitle").textContent =
    "Agregar servicio";

  $("serviceSubmit").textContent =
    "Agregar servicio";

  $("cancelEdit").hidden =
    true;
}


const serviceForm = $("serviceForm");

if (serviceForm) {
  serviceForm.onsubmit = async e => {
    e.preventDefault();

    const id =
      $("serviceId").value;

    const payload = {
      title:
        $("serviceTitle").value.trim(),

      description:
        $("serviceDescription").value.trim(),

      category:
        $("serviceCategory").value.trim(),

      sort_order:
        $("serviceOrder").value,

      price:
        $("servicePrice").value
    };

    try {
      if (id) {
        const current =
          await api("/api/admin/services");

        const item =
          current.find(
            x => Number(x.id) === Number(id)
          );

        payload.active =
          item ? !!item.active : true;

        await api(
          `/api/admin/services/${id}`,
          {
            method: "PUT",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(payload)
          }
        );

        showMsg(
          "Servicio actualizado correctamente."
        );

      } else {
        await api(
          "/api/admin/services",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(payload)
          }
        );

        showMsg(
          "Servicio agregado correctamente."
        );
      }

      resetServiceForm();

      await load();

    } catch (e) {
      showMsg(
        e.message,
        true
      );
    }
  };
}


const cancelEdit =
  $("cancelEdit");

if (cancelEdit) {
  cancelEdit.onclick =
    resetServiceForm;
}


async function toggleService(id, active) {
  try {
    const services =
      await api("/api/admin/services");

    const x =
      services.find(
        s => Number(s.id) === Number(id)
      );

    if (!x) return;

    await api(
      `/api/admin/services/${id}`,
      {
        method: "PUT",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          title:
            x.title,

          description:
            x.description,

          price:
            x.price,

          active:
            !active
        })
      }
    );

    showMsg(
      active
        ? "Servicio ocultado."
        : "Servicio publicado."
    );

    await load();

  } catch (e) {
    showMsg(
      e.message,
      true
    );
  }
}


async function del(id) {
  if (
    !confirm(
      "¿Eliminar este servicio definitivamente?"
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/admin/services/${id}`,
      {
        method: "DELETE"
      }
    );

    showMsg(
      "Servicio eliminado."
    );

    await load();

  } catch (e) {
    showMsg(
      e.message,
      true
    );
  }
}



async function moveService(id, direction) {
  try {
    const result = await api(
      `/api/admin/services/${id}/order`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction })
      }
    );
    showMsg(result.message || "Orden actualizado.");
    await load();
  } catch (e) {
    showMsg(e.message, true);
  }
}
