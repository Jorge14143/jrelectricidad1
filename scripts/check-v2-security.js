const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const required = [
  "lib/security.js",
  "migrations/002_security_advanced.sql"
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error("❌ Falta:", file);
    process.exit(1);
  }
}

const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const security = fs.readFileSync(path.join(root, "lib/security.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "migrations/002_security_advanced.sql"), "utf8");

const checks = [
  ["CSRF", server.includes("requireCsrfOrigin")],
  ["cookie __Host", server.includes("__Host-jr_session")],
  ["active sessions", server.includes("/api/account/sessions")],
  ["session revocation", server.includes("revoke-others")],
  ["temporary lockout", server.includes("isLoginLocked")],
  ["password policy", server.includes("validatePassword")],
  ["TOTP", server.includes("/api/account/2fa") && security.includes("verifyTotp")],
  ["backup codes", server.includes("mfa_backup_codes") && security.includes("generateBackupCodes")],
  ["MFA migration", migration.includes("CREATE TABLE IF NOT EXISTS mfa_backup_codes")],
  ["active session migration", migration.includes("CREATE TABLE IF NOT EXISTS active_sessions")]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("❌ Fallaron controles:", failed.map(([name]) => name));
  process.exit(1);
}

try {
  new Function(server);
  new Function(security);
} catch (error) {
  console.error("❌ Error de sintaxis:", error.message);
  process.exit(1);
}

console.log("✅ Fase 2: seguridad avanzada validada.");
