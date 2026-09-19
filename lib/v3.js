const V3_VERSION = "3.0.0";
const V3_API_PREFIX = "/api/v3";

function v3Metadata() {
  return {
    version: V3_VERSION,
    api: V3_API_PREFIX,
    status: "development",
    architecture: "modular-monolith",
    database: "mysql",
    compatibility: { legacyApi: "/api", v3Api: V3_API_PREFIX }
  };
}

function v3SecurityHeaders(res) {
  res.setHeader("X-JR-API-Version", V3_VERSION);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function createV3Router(express, pool) {
  const router = express.Router();
  router.use((req, res, next) => {
    v3SecurityHeaders(res);
    req.apiVersion = V3_VERSION;
    next();
  });

  router.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, service: "jr-electricidad", api: V3_API_PREFIX, version: V3_VERSION });
    } catch {
      res.status(503).json({ ok: false, service: "jr-electricidad", api: V3_API_PREFIX, version: V3_VERSION });
    }
  });

  router.get("/meta", (req, res) => res.json(v3Metadata()));
  return router;
}

module.exports = { V3_VERSION, V3_API_PREFIX, v3Metadata, v3SecurityHeaders, createV3Router };
