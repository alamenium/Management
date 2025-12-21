// Netlify Function (Functions API v2) + Netlify Blobs
// Routes:
//   GET  /.netlify/functions/api/pinhash   -> { pinhash }
//   POST /.netlify/functions/api/login     -> { token }   (body: { pin })
//   GET  /.netlify/functions/api/state     -> state json  (auth)
//   POST /.netlify/functions/api/state     -> { ok:true } (auth) (body: { state })

import crypto from "node:crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s ?? "")).digest("hex");
}

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(str) {
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

  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(p));
    if (payload?.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function bearer(req) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

async function getStore() {
  // dynamic import keeps compatibility if bundler resolves CJS/ESM differences
  const mod = await import("@netlify/blobs");
  return mod.getStore("teamhub");
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

async function writeState(store, state) {
  const safe = {
    version: 1,
    workspaceName: String(state?.workspaceName || "Team Hub").slice(0, 60),
    notes: String(state?.notes || "").slice(0, 20000),
    links: Array.isArray(state?.links) ? state.links.slice(0, 500) : [],
    tasks: Array.isArray(state?.tasks) ? state.tasks.slice(0, 2000) : [],
    updatedAt: new Date().toISOString(),
  };

  await store.set("state.json", safe, { contentType: "application/json" });
  return safe;
}

export default async function handler(req) {
  const url = new URL(req.url);

  const base = "/.netlify/functions/api";
  let path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
  if (!path) path = "/";
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") return json(200, { ok: true });

  const ADMIN_PIN = process.env.ADMIN_PIN || "";
  const AUTH_SECRET = process.env.AUTH_SECRET || "";

  // Public route: pinhash (used to invalidate cached PIN when it changes)
  if (path === "/pinhash" && method === "GET") {
    if (!ADMIN_PIN) return json(500, { error: "Missing ADMIN_PIN env var." });
    return json(200, { pinhash: sha256Hex(ADMIN_PIN) });
  }

  // Public route: login
  if (path === "/login" && method === "POST") {
    if (!ADMIN_PIN) return json(500, { error: "Missing ADMIN_PIN env var." });
    if (!AUTH_SECRET) return json(500, { error: "Missing AUTH_SECRET env var." });

    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const pin = String(body?.pin || "");
    if (pin !== ADMIN_PIN) return json(401, { error: "Invalid PIN" });

    const payload = {
      sub: "teamhub",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14, // 14 days
    };
    const token = signToken(payload, AUTH_SECRET);
    return json(200, { token });
  }

  // Protected routes below
  if (!AUTH_SECRET) return json(500, { error: "Missing AUTH_SECRET env var." });

  const token = bearer(req);
  const payload = verifyToken(token, AUTH_SECRET);
  if (!payload) return json(401, { error: "Unauthorized" });

  // State
  if (path === "/state" && method === "GET") {
    try {
      const store = await getStore();
      const state = await readState(store);
      return json(200, state);
    } catch (e) {
      return json(500, {
        error: "Storage not available (Netlify Blobs).",
        details: String(e?.message || e),
      });
    }
  }

  if (path === "/state" && method === "POST") {
    let store;
    try {
      store = await getStore();
    } catch (e) {
      return json(500, {
        error: "Storage not available (Netlify Blobs).",
        details: String(e?.message || e),
      });
    }

    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const incoming = body?.state ?? body;
    const saved = await writeState(store, incoming);
    return json(200, { ok: true, savedAt: saved.updatedAt });
  }

  return json(404, { error: "Not found" });
}
