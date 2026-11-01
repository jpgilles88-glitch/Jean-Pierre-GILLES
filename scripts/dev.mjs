// Local HTTP adapter; production runs the same handler as a Netlify Function.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { localStoreFactory } from "./local-store.mjs";
import { createHandler } from "../netlify/functions/api.mjs";
const dir = resolve(process.env.HERBLAY_LOCAL_DATA || ".netlify/herblay");
await mkdir(dir, { recursive: true });
const blobs = new BlobsServer({ directory: dir });
const address = await blobs.start();
const storeFactory = localStoreFactory(address.port);
const handler = createHandler(storeFactory);
const port = Number(process.env.PORT || 8888),
  host = process.env.HOST || "127.0.0.1";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    const origin = `http://${req.headers.host}`,
      url = new URL(req.url, origin);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 2100000) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(c);
      }
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method)
          ? { body: Buffer.concat(chunks) }
          : {}),
      });
      const response = await handler(request, { ip: req.socket.remoteAddress });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } else {
      const relative =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname).slice(1);
      if (relative.split("/").includes("..")) {
        res.writeHead(403);
        res.end();
        return;
      }
      const file = resolve("dist", relative);
      if (!file.startsWith(resolve("dist") + "/")) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
      });
      res.end(await readFile(file));
    }
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end("Introuvable");
  }
});
server.listen(port, host, () =>
  console.log(
    `Serveur local actif sur le port ${port}. Stockage local : ${dir}`,
  ),
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    server.close();
    blobs.stop().finally(() => process.exit());
  });
