import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { offlineAssets } from "./shared/pwa.js";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "projektwerk-pwa",
      apply: "build",
      generateBundle(_options, bundle) {
        const template = readFileSync(
          new URL("./src/service-worker.js", import.meta.url),
          "utf8",
        );
        const hash = createHash("sha256").update(template);
        for (const asset of offlineAssets) {
          hash.update(
            readFileSync(new URL(`./public${asset}`, import.meta.url)),
          );
        }
        for (const name of Object.keys(bundle).sort()) {
          const entry = bundle[name];
          hash.update(entry.type === "chunk" ? entry.code : entry.source);
        }
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: template
            .replace("__PWA_VERSION__", hash.digest("hex").slice(0, 16))
            .replace("__PWA_ASSETS__", JSON.stringify(offlineAssets)),
        });
      },
    },
  ],
  server: { proxy: { "/api": "http://127.0.0.1:8111" } },
});
