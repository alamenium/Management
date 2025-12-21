// netlify/functions/sendTaskEmail.js
// Sends task assignment emails via Gmail SMTP.
//
// IMPORTANT:
// - Do NOT hardcode passwords in code.
// - Set env vars in Netlify:
//     GMAIL_USER         (siliconhall.management@gmail.com)
//     GMAIL_APP_PASSWORD (Gmail App Password)
// - This function only emails the hardcoded allowlist below.

const nodemailer = require("nodemailer");

const MEMBERS = {
  youssef_elkhayat: { name: "Youssef Elkhayat", email: "youssifayman2004@gmail.com" },
  youssef_roshdy: { name: "Youssef Roshdy", email: "yousufdiaa2004@gmail.com" },
  mohamed_alainiah: { name: "Mohamed AlAiniah", email: "Mohammad.bashar033@gmail.com" },
  ahmed_saeed: { name: "Ahmed Saeed", email: "saeedahmedsuper@gmail.com" },
  mohamed_elmansy: { name: "Mohamed ElMansy", email: "mohammadadham20@gmail.com" },
};

// The frontend uses these IDs:
const FRONT_ID_TO_ALLOW = {
  youssef_elkhayat: MEMBERS.youssef_elkhayat,
  youssef_roshdy: MEMBERS.youssef_roshdy,
  mohamed_alainiah: MEMBERS.mohamed_alainiah,
  ahmed_saeed: MEMBERS.ahmed_saeed,
  mohamed_elmansy: MEMBERS.mohamed_elmansy,
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    return json(500, { ok: false, error: "Missing GMAIL_USER or GMAIL_APP_PASSWORD env vars" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }

  const taskId = String(payload.taskId || "");
  const desc = String(payload.desc || "");
  const notes = String(payload.notes || "");
  const due = String(payload.due || "");
  const priority = String(payload.priority || "");
  const involved = Array.isArray(payload.involved) ? payload.involved.map(String) : [];

  // Map involved IDs to allowlisted emails
  const recipients = [];
  for (const id of involved) {
    const m = FRONT_ID_TO_ALLOW[id];
    if (m?.email) recipients.push(m.email);
  }
  const unique = [...new Set(recipients)];

  if (!unique.length) return json(200, { ok: true, skipped: true, reason: "No allowlisted recipients" });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  const prettyDue = due ? due : "—";
  const prettyNotes = notes ? notes : "—";
  const prettyPriority = priority ? priority.toUpperCase() : "—";

  const subject = `New Task Assigned: ${desc || "Task"}`;
  const text = [
    "A new task was created in Team Hub.",
    "",
    `Task: ${desc || "—"}`,
    `Due: ${prettyDue}`,
    `Priority: ${prettyPriority}`,
    `Notes: ${prettyNotes}`,
    taskId ? `Task ID: ${taskId}` : "",
    "",
    "—",
    "Silicon Hall Management",
  ].filter(Boolean).join("\n");

  try {
    await transporter.sendMail({
      from: `Silicon Hall Management <${user}>`,
      to: unique.join(", "),
      subject,
      text,
    });
    return json(200, { ok: true, sentTo: unique });
  } catch (e) {
    return json(500, { ok: false, error: "Email send failed", details: String(e?.message || e) });
  }
};
