const jwt = require("jsonwebtoken");

function verifyBearer(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return undefined; // invalid/expired — distinct from "missing"
  }
}

/** Any logged-in admin (board or superadmin). */
function requireAdmin(req, res, next) {
  const payload = verifyBearer(req);
  if (payload === null) return res.status(401).json({ error: "Missing bearer token" });
  if (payload === undefined || payload.type !== "admin") {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  req.admin = payload;
  next();
}

/** Admin whose role is in `roles`, e.g. requireRole(["superadmin"]). */
function requireRole(roles) {
  return function (req, res, next) {
    requireAdmin(req, res, function () {
      if (!roles.includes(req.admin.role)) {
        return res.status(403).json({ error: "You don't have permission to do that" });
      }
      next();
    });
  };
}

/** A logged-in member (self-service portal). */
function requireMember(req, res, next) {
  const payload = verifyBearer(req);
  if (payload === null) return res.status(401).json({ error: "Missing bearer token" });
  if (payload === undefined || payload.type !== "member") {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  req.member = payload;
  next();
}

/** A logged-in front-desk staff account (event check-in desk). */
function requireDesk(req, res, next) {
  const payload = verifyBearer(req);
  if (payload === null) return res.status(401).json({ error: "Missing bearer token" });
  if (payload === undefined || payload.type !== "desk") {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  req.desk = payload;
  next();
}

module.exports = { requireAdmin, requireRole, requireMember, requireDesk };
