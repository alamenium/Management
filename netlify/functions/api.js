// netlify/functions/api.js (CommonJS)
// Routes:
//   GET  /.netlify/functions/api/pinhash   -> { pinhash }
//   POST /.netlify/functions/api/login     -> { token }   (body: { pin })
//   GET  /.netlify/functions/api/state     -> { state }   (auth)
//   POST /.netlify/functions/api/state     -> { state }   (auth) (body: { state })

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s ?? "")).digest("hex");
}

function b64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecodeToUtf8(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

function signToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64urlEncode(JSON.stringify(header));
  const p = b64urlEncode(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${data}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const data = `${h}.${p}`;

  const expected = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(b64urlDecodeToUtf8(p));
    if (payload?.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function bearerToken(headers = {}) {
  const h =
      headers.authorization ||
      headers.Authorization ||
      headers.AUTHORIZATION ||
      "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

function stripBasePath(eventPath) {
  // event.path looks like: "/.netlify/functions/api/state"
  const base = "/.netlify/functions/api";
  if (eventPath && eventPath.startsWith(base)) return eventPath.slice(base.length) || "/";
  return eventPath || "/";
}

async function getStoreSafe() {
  // store name must match what you see in Blobs UI (your screenshot: "teamhub")
  return getStore("teamhub");
}

async function readState(store) {
  const got = await store.get("state.json", { type: "json" });
  if (got && typeof got === "object") return got;

  const initial = {
    version: 1,
    workspaceName: "Team Hub",
    notes: "",
    links: [],
    tasks: [],
    updatedAt: new Date().toISOString(),
  };

  await store.set("state.json", initial, { contentType: "application/json" });
  return initial;
}

async function writeState(store, incoming) {
  const safe = {
    version: 1,
    workspaceName: String(incoming?.workspaceName || "Team Hub").slice(0, 60),
    notes: String(incoming?.notes || "").slice(0, 20000),
    links: Array.isArray(incoming?.links) ? incoming.links.slice(0, 500) : [],
    tasks: Array.isArray(incoming?.tasks) ? incoming.tasks.slice(0, 2000) : [],
    updatedAt: new Date().toISOString(),
  };

  await store.set("state.json", safe, { contentType: "application/json" });
  return safe;
}

exports.handler = async (event) => {
  try {
    const method = String(event.httpMethod || "GET").toUpperCase();
    const path = stripBasePath(event.path);

    if (method === "OPTIONS") return json(200, { ok: true });

    const ADMIN_PIN = process.env.ADMIN_PIN || "";
    const AUTH_SECRET = process.env.AUTH_SECRET || "";

    // Public: pinhash
    if (path === "/pinhash" && method === "GET") {
      if (!ADMIN_PIN) return json(500, { error: "Missing ADMIN_PIN env var." });
      return json(200, { pinhash: sha256Hex(ADMIN_PIN) });
    }

    // Public: login
    if (path === "/login" && method === "POST") {
      if (!ADMIN_PIN) return json(500, { error: "Missing ADMIN_PIN env var." });
      if (!AUTH_SECRET) return json(500, { error: "Missing AUTH_SECRET env var." });

      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        body = {};
      }

      const pin = String(body?.pin || "");
      if (pin !== ADMIN_PIN) return json(401, { error: "Invalid PIN" });

      const now = Math.floor(Date.now() / 1000);
      const payload = { sub: "teamhub", iat: now, exp: now + 60 * 60 * 24 * 14 };
      const token = signToken(payload, AUTH_SECRET);
      return json(200, { token });
    }

    // Protected routes
    if (!AUTH_SECRET) return json(500, { error: "Missing AUTH_SECRET env var." });

    const token = bearerToken(event.headers || {});
    const payload = verifyToken(token, AUTH_SECRET);
    if (!payload) return json(401, { error: "Unauthorized" });

    // GET state
    if (path === "/state" && method === "GET") {
      try {
        const store = await getStoreSafe();
        const state = await readState(store);
        return json(200, { state });
      } catch (e) {
        return json(500, { error: "Storage not available (Netlify Blobs).", details: String(e?.message || e) });
      }
    }

    // POST state
    if (path === "/state" && method === "POST") {
      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        body = {};
      }

      const incoming = body?.state ?? body;

      try {
        const store = await getStoreSafe();
        const saved = await writeState(store, incoming);
        return json(200, { state: saved, ok: true });
      } catch (e) {
        return json(500, { error: "Storage not available (Netlify Blobs).", details: String(e?.message || e) });
      }
    }

    return json(404, { error: "Not found" });
  } catch (e) {
    return json(500, { error: "Server error", details: String(e?.message || e) });
  }
};
