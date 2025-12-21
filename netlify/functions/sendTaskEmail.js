// netlify/functions/sendTaskEmail.js
// Sends email notifications on new task creation.
// Auth: requires the same Bearer token issued by api.js (HMAC signed).
//
// ENV required:
//   AUTH_SECRET
//   GMAIL_USER
//   GMAIL_APP_PASSWORD
//
// NOTE: Do NOT hardcode credentials in this file.

const crypto = require("crypto");
const nodemailer = require("nodemailer");

/**
 * Allowed recipients (hardcoded to your team)
 */
const MEMBERS = [
  { id: "Youssef Elkhayat", team: "CAD Team", email: "youssifayman2004@gmail.com" },
  { id: "Youssef Roshdy", team: "Prototype Team", email: "yousufdiaa2004@gmail.com" },
  { id: "Mohamed AlAiniah", team: "CAD Team", email: "Mohammad.bashar033@gmail.com" },
  { id: "Ahmed Saeed", team: "Prototype Team", email: "saeedahmedsuper@gmail.com" },
  { id: "Mohamed ElMansy", team: "CAD Team", email: "mohammadadham20@gmail.com" },
];

const TEAM_MEMBERS = {
  "CAD Team": MEMBERS.filter(m => m.team === "CAD Team").map(m => m.id),
  "Prototype Team": MEMBERS.filter(m => m.team === "Prototype Team").map(m => m.id),
};

const MEMBER_BY_ID = Object.fromEntries(MEMBERS.map(m => [m.id, m]));
const ALL_IDS = MEMBERS.map(m => m.id);

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function b64url(buf){
  return Buffer.from(buf).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
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

  let payload;
  try{
    payload = JSON.parse(Buffer.from(p.replace(/-/g,"+").replace(/_/g,"/"), "base64").toString("utf8"));
  }catch{ return null; }

  if(payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

function getBearer(event){
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

function normalizeTargets(arr){
  const raw = Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
  const set = new Set();
  for (const t of raw) set.add(t);
  if (set.has("All")) return ["All"];
  return [...set];
}

function expandTargets(targets){
  const t = normalizeTargets(targets);
  const out = new Set();
  for (const x of t){
    if (x === "All"){
      ALL_IDS.forEach(id => out.add(id));
    } else if (TEAM_MEMBERS[x]){
      TEAM_MEMBERS[x].forEach(id => out.add(id));
    } else if (MEMBER_BY_ID[x]){
      out.add(x);
    }
  }
  return [...out];
}

exports.handler = async (event) => {
  try{
    const AUTH_SECRET = process.env.AUTH_SECRET || "";
    const GMAIL_USER = process.env.GMAIL_USER || "";
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";

    if(!AUTH_SECRET) return json(500, { error: "Missing AUTH_SECRET" });
    if(!GMAIL_USER || !GMAIL_APP_PASSWORD) return json(500, { error: "Missing Gmail env vars" });

    const token = getBearer(event);
    const payload = verifyToken(token, AUTH_SECRET);
    if(!payload) return json(401, { error: "Unauthorized" });

    const body = event.body ? JSON.parse(event.body) : {};
    const task = body.task || {};

    const desc = String(task.desc || "Task");
    const targets = normalizeTargets(task.targets || []);
    const due = String(task.due || "—");
    const priority = String(task.priority || "med");
    const notes = String(task.notes || "—");
    const createdBy = String(task.createdBy || "Unknown");

    const involvedIds = expandTargets(targets);
    const recipients = involvedIds
      .map(id => MEMBER_BY_ID[id]?.email)
      .filter(Boolean);

    if(!recipients.length) return json(200, { ok:true, skipped:true });

    const subject = `[Team Hub] New task: ${desc.slice(0, 80)}`;
    const text =
`New Task Created

Description: ${desc}
Assigned To: ${targets.join(", ")}  (expanded: ${involvedIds.join(", ")})
Priority: ${priority}
Due: ${due}
Notes: ${notes}

Created by: ${createdBy}
`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: `"${GMAIL_USER}" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      bcc: recipients,
      subject,
      text,
    });

    return json(200, { ok:true, sent: recipients.length });
  }catch(err){
    return json(500, { error: err.message || "Server error" });
  }
};
