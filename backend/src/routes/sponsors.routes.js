const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { makeUploader, UPLOADS_ROOT } = require("../upload");

const router = express.Router();
const upload = makeUploader("sponsors");

// GET /api/sponsors — public
router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM sponsors ORDER BY created_at DESC");
  res.json({ sponsors: rows });
});

// POST /api/sponsors — admin/board, multipart/form-data: logo (file), name (text), website_url (text, optional)
router.post("/", requireAdmin, (req, res) => {
  upload.single("logo")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No logo uploaded" });
    const name = req.body && req.body.name;
    if (!name) {
      fs.unlink(path.join(UPLOADS_ROOT, "sponsors", req.file.filename), () => {});
      return res.status(400).json({ error: "Sponsor name is required" });
    }

    try {
      const { rows } = await db.query(
        "INSERT INTO sponsors (name, filename, website_url) VALUES ($1, $2, $3) RETURNING *",
        [name, req.file.filename, (req.body && req.body.website_url) || null]
      );
      res.status(201).json({ sponsor: rows[0] });
    } catch (dbErr) {
      fs.unlink(path.join(UPLOADS_ROOT, "sponsors", req.file.filename), () => {});
      console.error(dbErr);
      res.status(500).json({ error: "Could not save sponsor" });
    }
  });
});

// DELETE /api/sponsors/:id — admin/board
router.delete("/:id", requireAdmin, async (req, res) => {
  const { rows } = await db.query("DELETE FROM sponsors WHERE id = $1 RETURNING filename", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Sponsor not found" });
  fs.unlink(path.join(UPLOADS_ROOT, "sponsors", rows[0].filename), () => {});
  res.status(204).send();
});

module.exports = router;
