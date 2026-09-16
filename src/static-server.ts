import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, relative, resolve } from "node:path";

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const root = resolve(process.cwd());
const allowedTopLevelPaths = new Set(["dist", "patterns", "public"]);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = url.pathname === "/" ? "/public/index.html" : url.pathname;
  const requestedPath = resolve(root, normalize(pathname.slice(1)));
  const relativePath = relative(root, requestedPath);
  const topLevelPath = relativePath.split(/[\\/]/)[0];

  if (relativePath.startsWith("..") || relativePath === ".." || !allowedTopLevelPaths.has(topLevelPath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(requestedPath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(requestedPath)] ?? "application/octet-stream"
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Safe Log Explainer UI: http://${host}:${port}`);
});
