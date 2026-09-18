// =========================================================
// USUARIOS
// =========================================================

async function toggleRole(id, role) {
  const next =
    role === "admin"
      ? "user"
      : "admin";

  if (
    !confirm(
      `¿Cambiar este usuario a ${next}?`
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/admin/users/${id}/role`,
      {
        method: "PUT",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            role: next
          })
      }
    );

    showMsg(
      "Rol actualizado."
    );

    await load();

  } catch (e) {
    showMsg(
      e.message,
      true
    );
  }
}


async function deleteUser(id, name) {
  if (
    !confirm(
      `¿Eliminar al usuario "${name}"? Esta acción no se puede deshacer.`
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/admin/users/${id}`,
      {
        method: "DELETE"
      }
    );

    showMsg(
      "Usuario eliminado."
    );

    await load();

  } catch (e) {
    showMsg(
      e.message,
      true
    );
  }
}
