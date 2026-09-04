const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { makeUploader, UPLOADS_ROOT } = require("../upload");

const router = express.Router();
const upload = makeUploader("board");

function parseYear(value, fieldName, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${fieldName} is required`);
    return null;
  }
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new Error(`${fieldName} must be a valid year`);
  }
  return year;
}

// GET /api/board-profiles — public: current board first (by display_order),
// then past board members (most recently departed first).
router.get("/", async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM board_profiles
     ORDER BY (term_end_year IS NULL) DESC, display_order ASC, term_end_year DESC NULLS FIRST, name ASC`
  );
  res.json({ profiles: rows });
});

/* ---------------- Admin-only below ---------------- */
router.use(requireAdmin);

// POST /api/board-profiles — add a profile (no photo yet; upload separately)
router.post("/", async (req, res) => {
  const { name, title, term_start_year, term_end_year, display_order } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "title is required" });
  }

  let startYear, endYear;
  try {
    startYear = parseYear(term_start_year, "term_start_year", { required: true });
    endYear = parseYear(term_end_year, "term_end_year");
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { rows } = await db.query(
    `INSERT INTO board_profiles (name, title, term_start_year, term_end_year, display_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name.trim(), title.trim(), startYear, endYear, display_order || 0]
  );
  res.status(201).json({ profile: rows[0] });
});

// PUT /api/board-profiles/:id — edit any field except photo
router.put("/:id", async (req, res) => {
  const { name, title, term_start_year, term_end_year, display_order } = req.body || {};

  let startYear, endYear;
  try {
    if (term_start_year !== undefined) startYear = parseYear(term_start_year, "term_start_year", { required: true });
    if (term_end_year !== undefined) endYear = parseYear(term_end_year, "term_end_year");
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // COALESCE can't distinguish "clear this field" from "leave it alone" for
  // term_end_year (both look like NULL), so handle it as an explicit SET
  // only when the field was actually sent.
  const sets = ["name = COALESCE($1, name)", "title = COALESCE($2, title)", "term_start_year = COALESCE($3, term_start_year)", "display_order = COALESCE($4, display_order)"];
  const params = [name, title, startYear, display_order];
  if (term_end_year !== undefined) {
    sets.push(`term_end_year = $${params.length + 1}`);
    params.push(endYear);
  }
  params.push(req.params.id);

  const { rows } = await db.query(
    `UPDATE board_profiles SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: "Board profile not found" });
  res.json({ profile: rows[0] });
});

// POST /api/board-profiles/:id/photo — multipart/form-data: photo (file)
router.post("/:id/photo", (req, res) => {
  upload.single("photo")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No photo uploaded" });

    try {
      const existing = await db.query("SELECT photo_filename FROM board_profiles WHERE id = $1", [req.params.id]);
      if (!existing.rows[0]) {
        fs.unlink(path.join(UPLOADS_ROOT, "board", req.file.filename), () => {});
        return res.status(404).json({ error: "Board profile not found" });
      }
      const oldFilename = existing.rows[0].photo_filename;

      const { rows } = await db.query(
        "UPDATE board_profiles SET photo_filename = $1 WHERE id = $2 RETURNING *",
        [req.file.filename, req.params.id]
      );
      if (oldFilename) fs.unlink(path.join(UPLOADS_ROOT, "board", oldFilename), () => {});
      res.json({ profile: rows[0] });
    } catch (dbErr) {
      fs.unlink(path.join(UPLOADS_ROOT, "board", req.file.filename), () => {});
      console.error(dbErr);
      res.status(500).json({ error: "Could not save photo" });
    }
  });
});

// DELETE /api/board-profiles/:id
router.delete("/:id", async (req, res) => {
  const { rows } = await db.query("DELETE FROM board_profiles WHERE id = $1 RETURNING photo_filename", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Board profile not found" });
  if (rows[0].photo_filename) fs.unlink(path.join(UPLOADS_ROOT, "board", rows[0].photo_filename), () => {});
  res.status(204).send();
});

module.exports = router;
