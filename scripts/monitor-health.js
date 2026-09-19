const https = require("https");
const http = require("http");
const url = process.argv[2] || process.env.HEALTH_URL || "http://127.0.0.1:3000/health";
const client = url.startsWith("https:") ? https : http;

const request = client.get(url, { timeout: 10000 }, res => {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", chunk => body += chunk);
  res.on("end", () => {
    if (res.statusCode !== 200) { console.error("❌ Health HTTP " + res.statusCode); process.exit(1); }
    try {
      const data = JSON.parse(body);
      if (!data.ok) throw new Error("ok=false");
    } catch (error) {
      console.error("❌ Health inválido:", error.message);
      process.exit(1);
    }
    console.log("✅ Health OK: " + url);
  });
});
request.on("timeout", () => request.destroy(new Error("timeout")));
request.on("error", error => { console.error("❌ Health no disponible:", error.message); process.exit(1); });
