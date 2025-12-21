// netlify/functions/api.js
// Team Hub API
// - Auth via PIN -> signed token (HMAC)
// - Storage via Netlify Blobs (@netlify/blobs)
//
// ENV required:
//   ADMIN_PIN   (e.g., 1234).
//   AUTH_SECRET (long random string)
// Optional:
//   STORE_NAME  (defaults to "teamhub")

const crypto = require("crypto");

const json = (status, body, headers={}) => ({
  statusCode: status,
  headers: { "Content-Type":"application/json", ...headers },
  body: JSON.stringify(body),
});

function b64url(input){
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf.toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}

function signToken(payload, secret){
  const header = { alg:"HS256", typ:"JWT" };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const msg = `${h}.${p}`;
  const sig = crypto.createHmac("sha256", secret).update(msg).digest();
  return `${msg}.${b64url(sig)}`;
}

function verifyToken(token, secret){
  if(!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if(parts.length !== 3) return null;
  const [h,p,s] = parts;
  const msg = `${h}.${p}`;
  const expected = b64url(crypto.createHmac("sha256", secret).update(msg).digest());
  if(expected.length !== s.length) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s));
  if(!ok) return null;

  const payload = JSON.parse(Buffer.from(p.replace(/-/g,"+").replace(/_/g,"/"), "base64").toString("utf8"));
  if(payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

function getBearer(event){
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

async function getStore(){
  const mod = await import("@netlify/blobs");
  const { getStore } = mod;
  const name = process.env.STORE_NAME || "teamhub";
  return getStore(name);
}

async function readState(store){
  const s = await store.get("state.json", { type:"json" });
  if(s && typeof s === "object") return s;
  return { version:1, workspaceName:"Team Hub", notes:"Lorem ipsum...", links:[], tasks:[] };
}

async function writeState(store, state){
  const safe = {
    version: 1,
    workspaceName: String(state.workspaceName || "Team Hub").slice(0, 60),
    notes: String(state.notes || "Lorem ipsum...").slice(0, 20000),
    links: Array.isArray(state.links) ? state.links.slice(0, 500) : [],
    tasks: Array.isArray(state.tasks) ? state.tasks.slice(0, 2000) : [],
    updatedAt: new Date().toISOString(),
  };
  await store.set("state.json", safe, { contentType:"application/json" });
  return safe;
}

exports.handler = async (event) => {
  try{
    const path = (event.path || "").replace(/^.*\/api/, "") || "/";
    const method = (event.httpMethod || "GET").toUpperCase();

    if(method === "OPTIONS"){
      return json(200, { ok:true }, {
        "Access-Control-Allow-Origin":"*",
        "Access-Control-Allow-Headers":"Content-Type, Authorization",
        "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
      });
    }

    const ADMIN_PIN = String(process.env.ADMIN_PIN || "");
    const AUTH_SECRET = String(process.env.AUTH_SECRET || "");
    if(!AUTH_SECRET) return json(500, { error:"Missing AUTH_SECRET env var." });

    if(path === "/login" && method === "POST"){
      const body = event.body ? JSON.parse(event.body) : {};
      const pin = String(body.pin || "");
      if(!ADMIN_PIN) return json(500, { error:"Missing ADMIN_PIN env var." });
      if(pin !== ADMIN_PIN){
        await new Promise(r=>setTimeout(r, 250));
        return json(401, { error:"Invalid PIN" });
      }
      const payload = { sub:"teamhub", iat:Date.now(), exp:Date.now() + 1000*60*60*24*30 };
      const token = signToken(payload, AUTH_SECRET);
      return json(200, { token });
    }

    const token = getBearer(event);
    const payload = verifyToken(token, AUTH_SECRET);
    if(!payload) return json(401, { error:"Unauthorized" });

    const store = await getStore();

    if(path === "/state" && method === "GET"){
      const state = await readState(store);
      return json(200, { state });
    }

    if(path === "/state" && method === "POST"){
      const body = event.body ? JSON.parse(event.body) : {};
      const next = body.state || {};
      const saved = await writeState(store, next);
      return json(200, { ok:true, state: saved });
    }

    if(path === "/clear" && method === "POST"){
      const empty = { version:1, workspaceName:"Team Hub", notes:"Lorem ipsum...", links:[], tasks:[] };
      const saved = await writeState(store, empty);
      return json(200, { ok:true, state: saved });
    }

    return json(404, { error:"Not found" });
  }catch(err){
    return json(500, { error: err.message || "Server error" });
  }
};
