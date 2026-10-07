const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { makeUploader, UPLOADS_ROOT, DOCUMENT_MIME_TYPES } = require("../upload");

const router = express.Router();
const upload = makeUploader("bylaws", {
  mimeTypes: DOCUMENT_MIME_TYPES,
  maxBytes: 15 * 1024 * 1024, // 15MB — scanned bylaws can be large
  errorMessage: "Only PDF or Word (.doc, .docx) documents are allowed.",
});

// GET /api/bylaws — public: documents for the homepage Bylaws section
router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM bylaw_documents ORDER BY created_at");
  res.json({ documents: rows });
});

// POST /api/bylaws — admin/board, multipart/form-data: document (file), title (text)
router.post("/", requireAdmin, (req, res) => {
  upload.single("document")(req, res, async (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "That file is too large (15MB maximum)." : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: "No document uploaded" });

    const title = ((req.body && req.body.title) || "").trim();
    if (!title) {
      fs.unlink(path.join(UPLOADS_ROOT, "bylaws", req.file.filename), () => {});
      return res.status(400).json({ error: "A document title is required" });
    }

    try {
      const { rows } = await db.query(
        "INSERT INTO bylaw_documents (title, filename, original_name) VALUES ($1, $2, $3) RETURNING *",
        [title, req.file.filename, req.file.originalname]
      );
      res.status(201).json({ document: rows[0] });
    } catch (dbErr) {
      fs.unlink(path.join(UPLOADS_ROOT, "bylaws", req.file.filename), () => {});
      console.error(dbErr);
      res.status(500).json({ error: "Could not save document" });
    }
  });
});

// DELETE /api/bylaws/:id — admin/board
router.delete("/:id", requireAdmin, async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(404).json({ error: "Document not found" });
  }
  const { rows } = await db.query("DELETE FROM bylaw_documents WHERE id = $1 RETURNING filename", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Document not found" });
  fs.unlink(path.join(UPLOADS_ROOT, "bylaws", rows[0].filename), () => {});
  res.status(204).send();
});

module.exports = router;
