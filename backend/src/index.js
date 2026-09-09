require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const adminsRoutes = require("./routes/admins.routes");
const membersRoutes = require("./routes/members.routes");
const eventsRoutes = require("./routes/events.routes");
const rsvpsRoutes = require("./routes/rsvps.routes");
const paymentSettingsRoutes = require("./routes/payment-settings.routes");
const communicationsRoutes = require("./routes/communications.routes");
const reportsRoutes = require("./routes/reports.routes");
const paymentsRoutes = require("./routes/payments.routes");
const siteContentRoutes = require("./routes/site-content.routes");
const galleryRoutes = require("./routes/gallery.routes");
const sponsorsRoutes = require("./routes/sponsors.routes");
const volunteersRoutes = require("./routes/volunteers.routes");
const membershipCategoriesRoutes = require("./routes/membership-categories.routes");
const mailSettingsRoutes = require("./routes/mail-settings.routes");
const deskStaffRoutes = require("./routes/desk-staff.routes");
const deskRoutes = require("./routes/desk.routes");
const culturalGroupsRoutes = require("./routes/cultural-groups.routes");
const boardProfilesRoutes = require("./routes/board-profiles.routes");

const app = express();
// Capture the raw request body alongside the parsed one — Square's webhook
// signature is computed over the exact raw bytes, which express.json()
// otherwise discards after parsing.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
  })
);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Serve uploaded gallery photos / sponsor logos as static files.
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/admins", adminsRoutes);
app.use("/api/members", membersRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/rsvps", rsvpsRoutes);
app.use("/api/payment-settings", paymentSettingsRoutes);
app.use("/api/communications", communicationsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/site-content", siteContentRoutes);
app.use("/api/gallery", galleryRoutes);
app.use("/api/sponsors", sponsorsRoutes);
app.use("/api/volunteers", volunteersRoutes);
app.use("/api/membership-categories", membershipCategoriesRoutes);
app.use("/api/mail-settings", mailSettingsRoutes);
app.use("/api/desk-staff", deskStaffRoutes);
app.use("/api/desk", deskRoutes);
app.use("/api/cultural-groups", culturalGroupsRoutes);
app.use("/api/board-profiles", boardProfilesRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RITS backend listening on http://localhost:${PORT}`);
});
