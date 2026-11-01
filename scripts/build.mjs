import { rm, mkdir, cp } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
await cp("public", "dist", { recursive: true });
await cp("lib/domain.js", "dist/domain.js");
console.log("Site généré dans dist");
