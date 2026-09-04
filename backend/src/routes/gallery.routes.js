const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { makeUploader, UPLOADS_ROOT } = require("../upload");

const router = express.Router();
const upload = makeUploader("gallery");

// GET /api/gallery — public
router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM gallery_photos ORDER BY created_at DESC");
  res.json({ photos: rows });
});

// POST /api/gallery — admin/board, multipart/form-data: photo (file), caption (text, optional)
router.post("/", requireAdmin, (req, res) => {
  upload.single("photo")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No photo uploaded" });

    try {
      const { rows } = await db.query(
        "INSERT INTO gallery_photos (filename, caption) VALUES ($1, $2) RETURNING *",
        [req.file.filename, (req.body && req.body.caption) || null]
      );
      res.status(201).json({ photo: rows[0] });
    } catch (dbErr) {
      fs.unlink(path.join(UPLOADS_ROOT, "gallery", req.file.filename), () => {});
      console.error(dbErr);
      res.status(500).json({ error: "Could not save photo" });
    }
  });
});

// DELETE /api/gallery/:id — admin/board
router.delete("/:id", requireAdmin, async (req, res) => {
  const { rows } = await db.query("DELETE FROM gallery_photos WHERE id = $1 RETURNING filename", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Photo not found" });
  fs.unlink(path.join(UPLOADS_ROOT, "gallery", rows[0].filename), () => {});
  res.status(204).send();
});

module.exports = router;
