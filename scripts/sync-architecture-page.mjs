import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const pages = [
  ["docs/agenttrust-architecture.html", "frontend/public/architecture/index.html"],
  ["docs/agenttrust-architecture-legacy.html", "frontend/public/architecture-legacy/index.html"],
];

if (mode !== "--check" && mode !== "--write") {
  console.error("Usage: node scripts/sync-architecture-page.mjs --check|--write");
  process.exitCode = 2;
} else {
  for (const [source, target] of pages) {
    const canonicalPath = resolve(root, source);
    const publishPath = resolve(root, target);
    const canonical = await readFile(canonicalPath);

    if (mode === "--write") {
      await mkdir(dirname(publishPath), { recursive: true });
      await writeFile(publishPath, canonical);
      console.log(`Synced ${source} to ${target}`);
      continue;
    }

    let published;
    try {
      published = await readFile(publishPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        console.error(`${target} is missing. Run with --write.`);
        process.exitCode = 1;
        continue;
      }
      throw error;
    }

    if (!canonical.equals(published)) {
      console.error(`${target} is out of sync. Run with --write.`);
      process.exitCode = 1;
    } else {
      console.log(`${target} is synchronized.`);
    }
  }
}
