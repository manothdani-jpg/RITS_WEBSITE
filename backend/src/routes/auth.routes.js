const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireAdmin, requireMember, requireDesk } = require("../middleware/auth");
const { sendEmail } = require("../email");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password reset requests. Please try again later." },
});

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/* ============================================================
   Admin / Board login — shared by 'board' and 'superadmin' roles.
   ============================================================ */

// POST /api/auth/login
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const { rows } = await db.query("SELECT * FROM admins WHERE email = $1", [email]);
  const admin = rows[0];
  if (!admin) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = jwt.sign(
    { type: "admin", sub: admin.id, email: admin.email, name: admin.name, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );

  res.json({
    token,
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  });
});

// GET /api/auth/me — verify a token / fetch current admin
router.get("/me", requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

/* ============================================================
   Member login — self-service portal.
   ============================================================ */

router.post("/member/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const { rows } = await db.query("SELECT * FROM members WHERE email = $1", [email]);
  const member = rows[0];
  if (!member || !member.password_hash) {
    return res.status(401).json({
      error: member
        ? "This membership record doesn't have a password set yet. Please sign up or contact the board to activate your login."
        : "Invalid email or password",
    });
  }

  const ok = await bcrypt.compare(password, member.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = jwt.sign(
    { type: "member", sub: member.id, email: member.email, name: member.first_name + " " + member.last_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );

  res.json({
    token,
    member: {
      id: member.id,
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      membership_tier: member.membership_tier,
      payment_status: member.payment_status,
    },
  });
});

router.get("/member/me", requireMember, (req, res) => {
  res.json({ member: req.member });
});

/* ============================================================
   Front-desk staff login — event check-in desk only.
   ============================================================ */

router.post("/desk/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const { rows } = await db.query("SELECT * FROM desk_staff WHERE username = $1", [username]);
  const staff = rows[0];
  if (!staff || !staff.is_active) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const ok = await bcrypt.compare(password, staff.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = jwt.sign(
    { type: "desk", sub: staff.id, username: staff.username, name: staff.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );

  res.json({ token, staff: { id: staff.id, name: staff.name, username: staff.username } });
});

router.get("/desk/me", requireDesk, (req, res) => {
  res.json({ staff: req.desk });
});

/* ============================================================
   Member "forgot password" — email a time-limited reset link.
   Always returns a generic success message so this can't be used
   to check whether an email is a registered member (no enumeration).
   ============================================================ */

router.post("/member/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  const generic = { message: "If that email is registered with RITS, we've sent a password reset link." };

  if (!email) return res.status(400).json({ error: "email is required" });

  const { rows } = await db.query("SELECT id, first_name, email FROM members WHERE email = $1", [email]);
  const member = rows[0];

  if (member) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await db.query(
      "UPDATE members SET reset_token_hash = $1, reset_token_expires_at = $2 WHERE id = $3",
      [tokenHash, expiresAt, member.id]
    );

    const portalUrl = process.env.PORTAL_URL || "http://localhost:8420/portal";
    const resetLink = `${portalUrl}/reset-password.html?token=${rawToken}&email=${encodeURIComponent(member.email)}`;

    try {
      await sendEmail({
        to: member.email,
        subject: "Reset your RITS member portal password",
        text:
          `Hi ${member.first_name},\n\n` +
          `Someone requested a password reset for your RITS member portal account. ` +
          `If this was you, click the link below within the next hour to set a new password:\n\n` +
          `${resetLink}\n\n` +
          `If you didn't request this, you can safely ignore this email.\n\nRITS`,
        html:
          `<p>Hi ${member.first_name},</p>` +
          `<p>Someone requested a password reset for your RITS member portal account. ` +
          `If this was you, click the link below within the next hour to set a new password:</p>` +
          `<p><a href="${resetLink}">${resetLink}</a></p>` +
          `<p>If you didn't request this, you can safely ignore this email.</p><p>RITS</p>`,
      });
    } catch (err) {
      console.error("Failed to send password reset email:", err);
      // Still return the generic success message — don't leak delivery failures to the caller.
    }
  }

  res.json(generic);
});

router.post("/member/reset-password", forgotPasswordLimiter, async (req, res) => {
  const { email, token, password } = req.body || {};
  if (!email || !token || !password) {
    return res.status(400).json({ error: "email, token, and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  const { rows } = await db.query(
    "SELECT id, reset_token_hash, reset_token_expires_at FROM members WHERE email = $1",
    [email]
  );
  const member = rows[0];

  const invalid = () => res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });

  if (!member || !member.reset_token_hash || !member.reset_token_expires_at) return invalid();
  if (new Date(member.reset_token_expires_at) < new Date()) return invalid();

  const providedHash = hashToken(token);
  const storedHash = member.reset_token_hash;
  const same =
    providedHash.length === storedHash.length &&
    crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(storedHash));
  if (!same) return invalid();

  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    "UPDATE members SET password_hash = $1, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = $2",
    [passwordHash, member.id]
  );

  res.json({ message: "Password updated. You can now log in with your new password." });
});

module.exports = router;
