// netlify/functions/sendTaskEmail.js
// Sends task emails to the hardcoded team emails.
//
// IMPORTANT:
// - Set env vars on Netlify:
//   GMAIL_USER=siliconhall.management@gmail.com
//   GMAIL_APP_PASSWORD=your-app-password
//
// We do NOT hardcode credentials in code.

const nodemailer = require("nodemailer");

const ALLOWED = new Set([
  "youssifayman2004@gmail.com",
  "yousufdiaa2004@gmail.com",
  "saeedahmedsuper@gmail.com",
  "mohammadadham20@gmail.com",
  "Mohammad.bashar033@gmail.com".toLowerCase(), // normalize
  "Mohammad.bashar033@gmail.com" // in case
]);

function normalize(email){
  return String(email || "").trim();
}
function normalizeLower(email){
  return String(email || "").trim().toLowerCase();
}

exports.handler = async (event) => {
  try{
    if (event.httpMethod !== "POST"){
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;

    if (!user || !pass){
      return { statusCode: 500, body: "Missing email env vars (GMAIL_USER / GMAIL_APP_PASSWORD)." };
    }

    const payload = JSON.parse(event.body || "{}");
    const task = payload.task || {};
    const recipientsIn = Array.isArray(payload.recipients) ? payload.recipients : [];

    // allow only known team emails
    const recipients = recipientsIn
      .map(normalize)
      .filter(Boolean)
      .filter(e => ALLOWED.has(e) || ALLOWED.has(normalizeLower(e)));

    if (recipients.length === 0){
      return { statusCode: 200, body: "No recipients." };
    }

    const subject = `New Task: ${String(task.desc || "Task")}`.slice(0, 160);

    const lines = [
      `Description: ${task.desc || ""}`,
      `Due: ${task.due || ""}`,
      `Priority: ${task.priority || ""}`,
      `Assigned to: ${(task.assignTargets || []).join(", ")}`,
      "",
      `Notes:`,
      `${task.notes || ""}`,
      "",
      `Task ID: ${task.id || ""}`,
    ];

    const text = lines.join("\n");

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass }
    });

    const from = `"Silicon Hall Management" <${user}>`;

    await transporter.sendMail({
      from,
      to: user,           // keep sender as To
      bcc: recipients,    // recipients hidden from each other
      subject,
      text
    });

    return { statusCode: 200, body: "sent" };
  }catch(e){
    console.error(e);
    return { statusCode: 500, body: "email failed" };
  }
};
