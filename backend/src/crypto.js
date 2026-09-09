const crypto = require("crypto");

// Derive a fixed 32-byte AES key from whatever string ENCRYPTION_KEY holds,
// so the operator doesn't need to generate a precisely-formatted key.
function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY is not set in .env — required to store SMTP credentials securely.");
  }
  return crypto.createHash("sha256").update(key).digest();
}

/** Encrypts a string for storage. Returns "iv:authTag:ciphertext", all base64. */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

/** Reverses encrypt(). Throws if the payload is malformed or the key is wrong. */
function decrypt(payload) {
  const [ivB64, authTagB64, dataB64] = String(payload).split(":");
  if (!ivB64 || !authTagB64 || !dataB64) throw new Error("Malformed encrypted payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
