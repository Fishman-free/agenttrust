import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AuthRepository, createPool } from "./db.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = await buildApp(config, new AuthRepository(pool));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
