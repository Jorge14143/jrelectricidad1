function string(value, options = {}) {
  const {
    min = 0,
    max = 10000,
    trim = true,
    required = false
  } = options;

  if (value === undefined || value === null) {
    if (required) throw new Error("Campo obligatorio.");
    return "";
  }

  let result = String(value);
  if (trim) result = result.trim();

  if (required && !result) throw new Error("Campo obligatorio.");
  if (result.length < min) throw new Error(`Debe tener al menos ${min} caracteres.`);
  if (result.length > max) throw new Error(`No puede superar ${max} caracteres.`);

  return result;
}

function email(value, options = {}) {
  const result = string(value, { ...options, max: options.max || 190 });
  if (!result) return result;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new Error("Correo electrónico inválido.");
  }
  return result.toLowerCase();
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("ID inválido.");
  return id;
}

module.exports = { string, email, positiveId };
