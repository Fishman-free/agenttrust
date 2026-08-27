import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool } from "./db.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool(databaseUrl);
const migrationsDir = resolve(process.cwd(), "migrations");

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS auth_bff_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const applied = await pool.query("SELECT 1 FROM auth_bff_migrations WHERE name = $1", [name]);
    if (applied.rowCount) continue;
    const sql = await readFile(resolve(migrationsDir, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO auth_bff_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      process.stdout.write(`applied ${name}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
