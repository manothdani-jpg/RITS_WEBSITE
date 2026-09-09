const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const { encrypt } = require("../crypto");
const { sendEmail, getSettings } = require("../email");

const router = express.Router();

// Everything here is superadmin-only — SMTP credentials are account-level
// infrastructure, same sensitivity tier as admin login management.
router.use(requireRole(["superadmin"]));

function toPublicShape(row) {
  if (!row) return null;
  return {
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_secure: row.smtp_secure,
    smtp_user: row.smtp_user,
    from_address: row.from_address,
    has_password: !!row.smtp_pass_encrypted,
    updated_at: row.updated_at,
  };
}

// GET /api/mail-settings — current config. Password is never returned,
// only whether one is set.
router.get("/", async (req, res) => {
  const settings = await getSettings();
  res.json({ settings: toPublicShape(settings) });
});

// PUT /api/mail-settings — update config. `password` is optional: omit
// or send an empty string to leave the currently-stored password as is.
router.put("/", async (req, res) => {
  const { smtp_host, smtp_port, smtp_secure, smtp_user, from_address, password } = req.body || {};

  let port;
  if (smtp_port !== undefined) {
    port = Number(smtp_port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return res.status(400).json({ error: "smtp_port must be a valid port number" });
    }
  }

  let passEncrypted;
  if (password) {
    try {
      passEncrypted = encrypt(password);
    } catch (err) {
      console.error("Failed to encrypt SMTP password:", err);
      return res.status(500).json({ error: "Could not securely store the password. Check ENCRYPTION_KEY is set on the server." });
    }
  }

  await db.query(
    `UPDATE mail_settings SET
       smtp_host = COALESCE($1, smtp_host),
       smtp_port = COALESCE($2, smtp_port),
       smtp_secure = COALESCE($3, smtp_secure),
       smtp_user = COALESCE($4, smtp_user),
       from_address = COALESCE($5, from_address),
       smtp_pass_encrypted = COALESCE($6, smtp_pass_encrypted)
     WHERE id = 1`,
    [smtp_host, port, smtp_secure, smtp_user, from_address, passEncrypted]
  );

  const settings = await getSettings();
  res.json({ settings: toPublicShape(settings) });
});

const testLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many test emails sent. Please try again later." },
});

// POST /api/mail-settings/test — send a test email with the current
// (already-saved) settings, so a board member can confirm SMTP works
// without waiting for a real password-reset or communications send.
router.post("/test", testLimiter, async (req, res) => {
  const { to } = req.body || {};
  if (!to || typeof to !== "string") {
    return res.status(400).json({ error: "A recipient email address is required" });
  }

  try {
    const result = await sendEmail({
      to,
      subject: "RITS mail server test",
      text: "This is a test email from the RITS admin dashboard's Mail Server Settings. If you received this, SMTP is configured correctly.",
    });
    if (!result.delivered) {
      return res.status(400).json({ error: "SMTP isn't configured yet — nothing was sent (check the server console for what would have been sent)." });
    }
    res.json({ sent: true });
  } catch (err) {
    console.error("Test email failed:", err);
    res.status(502).json({ error: err.message || "Could not send test email — check your SMTP settings." });
  }
});

module.exports = router;
