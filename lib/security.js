const crypto = require("crypto");

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

function validatePassword(password) {
  const value = String(password ?? "");
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    return `La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`;
  }
  return null;
}

function base32Encode(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(input || "").replace(/=+$/,"").replace(/\s+/g,"").toUpperCase();
  let bits = 0, value = 0, bytes = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx < 0) throw new Error("Secreto TOTP inválido.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / 30);
  const data = Buffer.alloc(8);
  data.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(data).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, "0");
}

function verifyTotp(secret, code, window = 1) {
  const supplied = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(supplied)) return false;
  const now = Date.now();
  for (let offset = -window; offset <= window; offset++) {
    if (crypto.timingSafeEqual(Buffer.from(totp(secret, now + offset * 30000)), Buffer.from(supplied))) return true;
  }
  return false;
}

function encryptSecret(secret, keyMaterial) {
  const key = crypto.createHash("sha256").update(String(keyMaterial)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64url")).join(".");
}

function decryptSecret(payload, keyMaterial) {
  const [iv, tag, data] = String(payload || "").split(".");
  if (!iv || !tag || !data) throw new Error("Secreto TOTP inválido.");
  const key = crypto.createHash("sha256").update(String(keyMaterial)).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

function hashBackupCode(code) {
  return crypto.createHash("sha256").update(String(code).trim().toUpperCase()).digest("hex");
}

function generateBackupCodes(count = 8) {
  return Array.from({length: count}, () =>
    crypto.randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g).join("-")
  );
}

module.exports = {
  PASSWORD_MIN,
  PASSWORD_MAX,
  validatePassword,
  generateTotpSecret,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  hashBackupCode,
  generateBackupCodes
};
