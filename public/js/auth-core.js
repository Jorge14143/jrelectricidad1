const msg = document.getElementById("msg");

async function api(url, data) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(data)
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error("El servidor devolvió una respuesta inválida.");
  }

  if (!response.ok) {
    throw new Error(result.error || "Error en la solicitud.");
  }

  return result;
}
