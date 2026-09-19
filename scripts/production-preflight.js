require("dotenv").config();

const checks = [
  ["NODE_ENV", process.env.NODE_ENV === "production"],
  ["APP_URL", /^https:\/\/jrelectricidad\.dpdns\.org\/?$/i.test(String(process.env.APP_URL || ""))],
  ["DB_HOST", Boolean(String(process.env.DB_HOST || "").trim())],
  ["DB_USER", Boolean(String(process.env.DB_USER || "").trim())],
  ["DB_NAME", Boolean(String(process.env.DB_NAME || "").trim())],
  ["SESSION_SECRET", String(process.env.SESSION_SECRET || "").length >= 32]
];

let failed = 0;
for (const [name, valid] of checks) {
  if (valid) console.log("✅ " + name);
  else { console.error("❌ " + name); failed++; }
}
console.log("\nProducción preflight: " + (failed ? "NO APTO" : "APTO"));
process.exit(failed ? 1 : 0);
