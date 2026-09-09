const nodemailer = require("nodemailer");
const db = require("./db");
const { decrypt } = require("./crypto");

async function getSettings() {
  const { rows } = await db.query("SELECT * FROM mail_settings WHERE id = 1");
  return rows[0] || null;
}

async function getTransporter(settings) {
  if (!settings || !settings.smtp_host) return null;

  let pass;
  if (settings.smtp_pass_encrypted) {
    try {
      pass = decrypt(settings.smtp_pass_encrypted);
    } catch (err) {
      console.error("[email] Could not decrypt stored SMTP password:", err.message);
      return null;
    }
  }

  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port || 587,
    secure: !!settings.smtp_secure,
    auth: settings.smtp_user ? { user: settings.smtp_user, pass } : undefined,
  });
}

/**
 * Sends an email if SMTP is configured (Admin Logins → Mail Server
 * Settings); otherwise logs the content to the console so the flow is
 * still testable in local dev without real email infrastructure.
 */
async function sendEmail({ to, subject, text, html }) {
  const settings = await getSettings();
  const t = await getTransporter(settings);

  if (!t) {
    console.log("\n[email] SMTP not configured — printing email instead of sending:");
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  ---\n${text}\n  ---\n`);
    return { delivered: false };
  }

  await t.sendMail({
    from: (settings && settings.from_address) || "RITS <no-reply@ritamilsangam.org>",
    to,
    subject,
    text,
    html,
  });
  return { delivered: true };
}

function formatMoney(cents) {
  return "$" + ((cents || 0) / 100).toFixed(2);
}

module.exports = { sendEmail, getSettings, getTransporter, formatMoney };
