const fs = require("fs");

const input = "C:\\jr-electricidad\\public\\css\\style.css";
const output = "C:\\jr-electricidad\\public\\css\\style.css";

if (!fs.existsSync(input)) {
  console.error("❌ No se encontró:");
  console.error(input);
  process.exit(1);
}

const original = fs.readFileSync(input, "utf8");

console.log("📂 CSS original:", original.length, "caracteres");

// =========================================================
// PARSER SIMPLE DE BLOQUES CSS
// =========================================================

function parseBlocks(css) {
  const blocks = [];

  let start = 0;
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < css.length; i++) {
    const char = css[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth++;
    }

    if (char === "}") {
      depth--;

      if (depth === 0) {
        blocks.push(
          css.slice(start, i + 1).trim()
        );

        start = i + 1;
      }
    }
  }

  const remaining = css.slice(start).trim();

  if (remaining) {
    blocks.push(remaining);
  }

  return blocks;
}

// =========================================================
// SEPARAR BLOQUES
// =========================================================

let blocks = parseBlocks(original);

console.log("📦 Bloques encontrados:", blocks.length);

// =========================================================
// ELIMINAR FRAGMENTOS INVÁLIDOS
// =========================================================

blocks = blocks.filter(block => {
  return !block.includes("```css") &&
         !block.includes("```");
});

// =========================================================
// ELIMINAR BLOQUES EXACTAMENTE DUPLICADOS
// =========================================================

const seen = new Set();

blocks = blocks.filter(block => {

  const normalized =
    block
      .replace(/\s+/g, " ")
      .trim();

  if (seen.has(normalized)) {
    return false;
  }

  seen.add(normalized);

  return true;
});

// =========================================================
// ELIMINAR TODAS LAS VERSIONES ANTIGUAS
// DE LA GALERÍA ADMIN
// =========================================================

blocks = blocks.filter(block => {

  const selector =
    block
      .slice(0, block.indexOf("{"))
      .trim();

  if (
    selector.includes("#adminGallery") ||
    selector.includes(".gallery-admin-")
  ) {
    return false;
  }

  return true;
});

// =========================================================
// GALERÍA ADMIN — ÚNICA VERSIÓN
// =========================================================

const gallery = `

/* =========================================================
   GALERÍA ADMIN — DISEÑO FINAL
   JR ELECTRICIDAD
   ========================================================= */

#adminGallery {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  width: 100%;
  margin-top: 20px;
  align-items: stretch;
}

#adminGallery .gallery-admin-item {
  position: relative;

  display: flex;
  flex-direction: column;

  width: 100%;
  min-width: 0;
  height: 100%;

  overflow: hidden;
  box-sizing: border-box;

  background: #10141c;

  border: 1px solid #202733;
  border-radius: 16px;

  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.25);

  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

#adminGallery .gallery-admin-item:hover {
  transform: translateY(-3px);

  border-color:
    rgba(255, 196, 0, 0.45);

  box-shadow:
    0 16px 35px rgba(0, 0, 0, 0.35);
}

#adminGallery .gallery-admin-item.inactive {
  opacity: 0.58;
}

#adminGallery .gallery-admin-item.inactive:hover {
  opacity: 0.72;
}

#adminGallery .gallery-admin-image {
  position: relative;

  width: 100%;
  height: 155px;

  flex-shrink: 0;

  overflow: hidden;

  background: #080a0f;
}

#adminGallery .gallery-admin-image img {
  display: block;

  width: 100%;
  height: 100%;

  object-fit: cover;

  transition:
    transform 0.3s ease;
}

#adminGallery .gallery-admin-item:hover
.gallery-admin-image img {
  transform: scale(1.04);
}

#adminGallery .gallery-admin-info {
  display: flex;
  flex-direction: column;

  flex: 1;

  min-width: 0;

  padding: 14px;

  box-sizing: border-box;
}

#adminGallery .gallery-admin-title {
  display: flex;

  align-items: flex-start;
  justify-content: space-between;

  gap: 8px;

  margin-bottom: 7px;
}

#adminGallery .gallery-admin-title h3 {
  margin: 0;

  min-width: 0;

  color: #f5f7fb;

  font-size: 16px;
  font-weight: 850;

  line-height: 1.25;

  word-break: break-word;
}

#adminGallery .gallery-admin-info p {
  margin: 0;

  color: #9ca6b5;

  font-size: 12px;

  line-height: 1.45;

  display: -webkit-box;

  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;

  overflow: hidden;
}

#adminGallery .status {
  flex-shrink: 0;

  white-space: nowrap;
}

#adminGallery .gallery-admin-actions {
  display: grid;

  grid-template-columns:
    repeat(3, minmax(0, 1fr));

  gap: 7px;

  margin-top: auto;

  padding-top: 12px;
}

#adminGallery .gallery-admin-actions .btn {
  width: 100%;
  min-width: 0;

  padding: 8px 6px;

  font-size: 11px;

  white-space: nowrap;
}

.gallery-preview-card {
  margin-top: 14px;

  overflow: hidden;

  border: 1px solid #202733;

  border-radius: 14px;

  background: #080a0f;
}

.gallery-preview-card img {
  display: block;

  width: 100%;
  max-height: 320px;

  object-fit: cover;
}

.gallery-preview-card small {
  display: block;

  padding: 10px 14px;

  color: var(--muted);

  font-size: 9px;
}

#adminGallery .gallery-empty {
  grid-column: 1 / -1;

  width: 100%;

  padding: 45px 20px;

  box-sizing: border-box;

  text-align: center;

  background: #10141c;

  border: 1px dashed #202733;

  border-radius: 18px;
}

@media (max-width: 1200px) {

  #adminGallery {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

}

@media (max-width: 700px) {

  #adminGallery {
    grid-template-columns: 1fr;

    gap: 16px;
  }

  #adminGallery .gallery-admin-image {
    height: 190px;
  }

  #adminGallery .gallery-admin-actions {
    grid-template-columns: 1fr;
  }

  #adminGallery .gallery-admin-actions .btn {
    padding: 10px;

    font-size: 13px;
  }

}

@media (max-width: 430px) {

  #adminGallery .gallery-admin-image {
    height: 175px;
  }

  #adminGallery .gallery-admin-info {
    padding: 13px;
  }

  #adminGallery .gallery-admin-title h3 {
    font-size: 15px;
  }

  #adminGallery .gallery-admin-info p {
    font-size: 11px;
  }

}
`;

// =========================================================
// GENERAR CSS LIMPIO
// =========================================================

const cleaned =
  blocks.join("\n\n") +
  "\n" +
  gallery.trim() +
  "\n";

// =========================================================
// GUARDAR
// =========================================================

fs.writeFileSync(
  output,
  cleaned,
  "utf8"
);

console.log("");
console.log("========================================");
console.log("✅ CSS LIMPIADO CORRECTAMENTE");
console.log("========================================");
console.log("");
console.log("Original :", original.length, "caracteres");
console.log("Limpio   :", cleaned.length, "caracteres");
console.log(
  "Reducido :",
  original.length - cleaned.length,
  "caracteres"
);
console.log("");
console.log("📁 Archivo:");
console.log(output);
console.log("");
console.log("💾 Backup:");
console.log(input + ".backup");
console.log("");