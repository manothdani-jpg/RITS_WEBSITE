const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true", // true for port 465, false for 587/25
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

/**
 * Sends an email if SMTP_* env vars are configured; otherwise logs the
 * content to the console so the flow is still testable in local dev
 * without real email infrastructure.
 */
async function sendEmail({ to, subject, text, html }) {
  const t = getTransporter();

  if (!t) {
    console.log("\n[email] SMTP not configured — printing email instead of sending:");
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  ---\n${text}\n  ---\n`);
    return { delivered: false };
  }

  await t.sendMail({
    from: process.env.SMTP_FROM || "RITS <no-reply@ritamilsangam.org>",
    to,
    subject,
    text,
    html,
  });
  return { delivered: true };
}

module.exports = { sendEmail };
