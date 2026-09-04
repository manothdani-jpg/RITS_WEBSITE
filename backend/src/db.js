const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
  process.exit(1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
