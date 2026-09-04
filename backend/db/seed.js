/**
 * Creates (or updates the password of) the first admin account.
 *
 * Usage:
 *   ADMIN_EMAIL=you@example.org ADMIN_PASSWORD=changeme ADMIN_NAME="Your Name" npm run db:seed
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Admin";

  if (!email || !password) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables before running this script.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `INSERT INTO admins (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'superadmin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`,
    [name, email, passwordHash]
  );

  console.log(`Admin account ready: ${email}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
