import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalPath = resolve(root, "docs/agenttrust-architecture.html");
const publishPath = resolve(root, "frontend/public/architecture/index.html");
const mode = process.argv[2];

if (mode !== "--check" && mode !== "--write") {
  console.error("Usage: node scripts/sync-architecture-page.mjs --check|--write");
  process.exitCode = 2;
} else {
  const canonical = await readFile(canonicalPath);

  if (mode === "--write") {
    await mkdir(dirname(publishPath), { recursive: true });
    await writeFile(publishPath, canonical);
    console.log("Synced docs/agenttrust-architecture.html to frontend/public/architecture/index.html");
  } else {
    let published;
    try {
      published = await readFile(publishPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        console.error("Architecture publish copy is missing. Run with --write.");
        process.exitCode = 1;
      } else {
        throw error;
      }
    }

    if (published && !canonical.equals(published)) {
      console.error("Architecture publish copy is out of sync. Run with --write.");
      process.exitCode = 1;
    } else if (published) {
      console.log("Architecture page copies are synchronized.");
    }
  }
}
