// =========================================================
// FIRMA DIGITAL — BLOQUE K
// =========================================================

async function loadSignatures() {
  const body = $("signatureHistoryList");
  if (!body) return;
  const data = await api("/api/admin/signatures");
  body.innerHTML = (data.signatures || []).map(item => `
    <tr>
      <td>${h(item.signed_at)}</td>
      <td>${h(item.quote_number || ("#" + item.quote_id))}</td>
      <td>${h(item.signer_name)}</td>
      <td>${h(item.signer_email || "—")}</td>
      <td>${h(item.document_type)}</td>
      <td><code>${h(item.evidence_hash || "—")}</code></td>
    </tr>
  `).join("") || '<tr><td colspan="6">Sin firmas registradas.</td></tr>';
}

function setupSignaturePreview() {
  const canvas = $("signatureCanvas");
  const clear = $("clearSignature");
  const form = $("signatureTestForm");
  if (!canvas || !clear || !form) return;

  const ctx = canvas.getContext("2d");
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  let drawing = false;

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const source = event.touches ? event.touches[0] : event;
    return {
      x: (source.clientX - rect.left) * canvas.width / rect.width,
      y: (source.clientY - rect.top) * canvas.height / rect.height
    };
  }

  function start(event) {
    event.preventDefault();
    drawing = true;
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x,p.y);
  }
  function move(event) {
    if (!drawing) return;
    event.preventDefault();
    const p = point(event);
    ctx.lineTo(p.x,p.y);
    ctx.stroke();
  }
  function end() { drawing = false; }

  ["pointerdown"].forEach(e => canvas.addEventListener(e,start));
  ["pointermove"].forEach(e => canvas.addEventListener(e,move));
  ["pointerup","pointerleave"].forEach(e => canvas.addEventListener(e,end));

  clear.addEventListener("click", () => ctx.clearRect(0,0,canvas.width,canvas.height));

  form.addEventListener("submit", async event => {
    event.preventDefault();
    showMsg("La firma se captura desde el presupuesto público mediante su token. Esta vista es solo una prueba visual.", false);
  });
}

async function initSignaturesAdmin() {
  await loadSignatures().catch(error => showMsg(error.message, true));
  setupSignaturePreview();
  $("refreshSignatureHistory")?.addEventListener("click", () => loadSignatures().catch(error => showMsg(error.message,true)));
}
document.addEventListener("DOMContentLoaded", initSignaturesAdmin);
