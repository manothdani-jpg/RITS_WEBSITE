const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");

const ALLOWED_MIME_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function makeUploader(subfolder) {
  const storage = multer.diskStorage({
    destination: path.join(UPLOADS_ROOT, subfolder),
    filename: (req, file, cb) => {
      const ext = ALLOWED_MIME_TYPES[file.mimetype] || path.extname(file.originalname) || "";
      cb(null, crypto.randomUUID() + ext);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME_TYPES[file.mimetype]) {
        return cb(new Error("Only JPG, PNG, WEBP, or GIF images are allowed."));
      }
      cb(null, true);
    },
  });
}

module.exports = { makeUploader, UPLOADS_ROOT };
