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

const DOCUMENT_MIME_TYPES = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

// Defaults to image uploads (5MB). Pass { mimeTypes, maxBytes, errorMessage }
// to accept something else, e.g. the bylaw documents.
function makeUploader(subfolder, options = {}) {
  const mimeTypes = options.mimeTypes || ALLOWED_MIME_TYPES;
  const maxBytes = options.maxBytes || 5 * 1024 * 1024;
  const errorMessage = options.errorMessage || "Only JPG, PNG, WEBP, or GIF images are allowed.";

  const storage = multer.diskStorage({
    destination: path.join(UPLOADS_ROOT, subfolder),
    filename: (req, file, cb) => {
      const ext = mimeTypes[file.mimetype] || path.extname(file.originalname) || "";
      cb(null, crypto.randomUUID() + ext);
    },
  });

  return multer({
    storage,
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => {
      if (!mimeTypes[file.mimetype]) {
        return cb(new Error(errorMessage));
      }
      cb(null, true);
    },
  });
}

module.exports = { makeUploader, UPLOADS_ROOT, DOCUMENT_MIME_TYPES };
