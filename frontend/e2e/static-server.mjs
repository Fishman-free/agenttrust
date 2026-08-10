import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd(), "out");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  let candidate = join(root, relative);
  if (!candidate.startsWith(root)) candidate = join(root, "404.html");
  if (existsSync(candidate) && statSync(candidate).isDirectory()) candidate = join(candidate, "index.html");
  if (!existsSync(candidate) && !extname(candidate)) candidate = join(candidate, "index.html");
  let status = 200;
  if (!existsSync(candidate) || !candidate.startsWith(root)) {
    candidate = join(root, "404.html");
    status = 404;
  }
  response.writeHead(status, { "content-type": mime[extname(candidate)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(candidate).pipe(response);
}).listen(3000, "127.0.0.1", () => console.log("E2E static export listening on http://127.0.0.1:3000"));
