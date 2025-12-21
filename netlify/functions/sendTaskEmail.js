const tls = require("tls");

const GMAIL_HOST = "smtp.gmail.com";
const GMAIL_PORT = 465;

// Only allow emailing these addresses (prevents the endpoint being used to email random people)
const ALLOWED_RECIPIENTS = new Set([
  "youssifayman2004@gmail.com",
  "yousufdiaa2004@gmail.com",
  "saeedahmedsuper@gmail.com",
  "mohammadadham20@gmail.com",
  "Mohammad.bashar033@gmail.com",
].map(x => x.toLowerCase()));

function json(statusCode, bodyObj){
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
    },
    body: JSON.stringify(bodyObj),
  };
}

function clampStr(v, max){
  return String(v ?? "").replace(/\r/g, "").slice(0, max);
}

function dotStuff(text){
  // If a line starts with ".", escape it per SMTP rules
  return text.split("\n").map(line => line.startsWith(".") ? "." + line : line).join("\n");
}

function readReply(socket){
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      // We consider reply complete when last line ends with "\r\n" and starts with "XYZ " (not "XYZ-")
      const lines = buf.split("\r\n").filter(Boolean);
      if (!lines.length) return;
      const last = lines[lines.length - 1];
      const m = last.match(/^(\d{3})\s/);
      if (m){
        cleanup();
        resolve({ code: Number(m[1]), text: buf });
      }
    };
    const onErr = (err) => { cleanup(); reject(err); };
    const onEnd = () => { cleanup(); reject(new Error("SMTP socket ended unexpectedly")); };

    function cleanup(){
      socket.off("data", onData);
      socket.off("error", onErr);
      socket.off("end", onEnd);
    }

    socket.on("data", onData);
    socket.on("error", onErr);
    socket.on("end", onEnd);
  });
}

async function sendCmd(socket, cmd, okCodes){
  if (cmd) socket.write(cmd + "\r\n");
  const rep = await readReply(socket);
  if (!okCodes.includes(rep.code)){
    const err = new Error(`SMTP error on "${cmd}": ${rep.code}`);
    err.smtp = rep.text;
    throw err;
  }
  return rep;
}

async function sendEmail({ user, pass, to, subject, text }){
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: GMAIL_HOST,
      port: GMAIL_PORT,
      servername: GMAIL_HOST,
    }, async () => {
      try{
        await sendCmd(socket, null, [220]);
        await sendCmd(socket, "EHLO teamhub", [250]);
        await sendCmd(socket, "AUTH LOGIN", [334]);
        await sendCmd(socket, Buffer.from(user).toString("base64"), [334]);
        await sendCmd(socket, Buffer.from(pass).toString("base64"), [235]);

        await sendCmd(socket, `MAIL FROM:<${user}>`, [250]);
        for (const r of to){
          await sendCmd(socket, `RCPT TO:<${r}>`, [250, 251]);
        }
        await sendCmd(socket, "DATA", [354]);

        const safeSubject = clampStr(subject, 160);
        const safeText = dotStuff(clampStr(text, 20000));

        const msg =
          `From: Silicon Hall Management <${user}>\r\n` +
          `To: ${to.join(", ")}\r\n` +
          `Subject: ${safeSubject}\r\n` +
          `MIME-Version: 1.0\r\n` +
          `Content-Type: text/plain; charset="utf-8"\r\n` +
          `Content-Transfer-Encoding: 8bit\r\n` +
          `\r\n` +
          `${safeText}\r\n`;

        socket.write(msg.replace(/\n/g, "\r\n") + "\r\n.\r\n");
        await sendCmd(socket, null, [250]);
        await sendCmd(socket, "QUIT", [221]);

        socket.end();
        resolve();
      }catch(err){
        try{ socket.end(); }catch(_){}
        reject(err);
      }
    });

    socket.on("error", reject);
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok:true });

  if (event.httpMethod !== "POST"){
    return json(405, { ok:false, error:"Method not allowed" });
  }

  const user = process.env.GMAIL_USER || "siliconhall.management@gmail.com";
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!pass){
    return json(500, {
      ok:false,
      error:"Missing GMAIL_APP_PASSWORD env var. Set it in Netlify → Site settings → Environment variables."
    });
  }

  let payload;
  try{
    payload = JSON.parse(event.body || "{}");
  }catch{
    return json(400, { ok:false, error:"Invalid JSON body" });
  }

  const recipientsIn = Array.isArray(payload.recipients) ? payload.recipients : [];
  const recipients = recipientsIn
    .map(x => String(x||"").trim())
    .filter(Boolean)
    .filter(x => ALLOWED_RECIPIENTS.has(x.toLowerCase()));

  if (!recipients.length){
    return json(200, { ok:true, skipped:true, reason:"No allowed recipients" });
  }

  const t = payload.task || {};
  const description = clampStr(t.description, 500);
  const assignedTo = clampStr(t.assignedTo, 120);
  const priority = clampStr(t.priority, 20);
  const due = clampStr(t.due, 40);
  const notes = clampStr(t.notes, 2000);
  const createdBy = clampStr(t.createdBy, 120);

  const subject = `New task: ${description || "Task"}`;
  const text =
`A new task was created in Team Hub.

Description: ${description || "-"}
Assigned to: ${assignedTo || "-"}
Priority: ${priority || "-"}
Due: ${due || "-"}
Created by: ${createdBy || "-"}

Notes:
${notes || "-"}

Task ID: ${clampStr(payload.taskId, 120) || "-"}

— Silicon Hall Management
`;

  try{
    await sendEmail({ user, pass, to: recipients, subject, text });
    return json(200, { ok:true, sentTo: recipients.length });
  }catch(err){
    return json(500, { ok:false, error:"Email send failed", details: String(err?.smtp || err?.message || err) });
  }
};
