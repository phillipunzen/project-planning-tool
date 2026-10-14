import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { requestLanguage } from "./language.js";
const require = createRequire(import.meta.url);
const distribution = path.dirname(
  require.resolve("swagger-ui-dist/package.json"),
);
const local = fileURLToPath(new URL("./swagger/", import.meta.url));
const assets = new Map([
  ["swagger-ui-bundle.js", path.join(distribution, "swagger-ui-bundle.js")],
  ["swagger-ui.css", path.join(distribution, "swagger-ui.css")],
  ["init.js", path.join(local, "init.js")],
  ["site.css", path.join(local, "site.css")],
]);
export function installSwaggerDocs(app, api) {
  app.get(
    "/api/docs",
    api(async (req, res) => {
      const english = requestLanguage(req) === "en";
      const title = english
        ? "Swagger API documentation"
        : "Swagger API-Dokumentation";
      const hint = english
        ? "Create a token in Profile settings → API access. Enter the token under “Authorize”, then use “Try it out” to send a request. Changes affect the selected board and use your token permissions. Authorization is cleared when this page is reloaded."
        : "Erstelle einen Token unter Profileinstellungen → API-Zugriff. Trage ihn unter „Authorize“ ein und sende Anfragen über „Try it out“. Änderungen wirken auf das ausgewählte Board und nutzen die Berechtigungen deines Tokens. Beim Neuladen wird die Autorisierung entfernt.";
      res
        .type("html")
        .send(
          `<!doctype html><html lang="${english ? "en" : "de"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/api/docs/assets/swagger-ui.css"><link rel="stylesheet" href="/api/docs/assets/site.css"></head><body><header class="docs-header"><h1>${title}</h1><p>${hint}</p><nav class="docs-links"><a href="/">${english ? "Back to the app" : "Zurück zum Tool"}</a><a href="/api/integration/openapi.json">${english ? "OpenAPI JSON specification" : "OpenAPI-JSON-Spezifikation"}</a></nav></header><div id="swagger-ui"></div><script src="/api/docs/assets/swagger-ui-bundle.js"></script><script src="/api/docs/assets/init.js"></script></body></html>`,
        );
    }),
  );
  app.get(
    "/api/docs/assets/:file",
    api(async (req, res, next) => {
      const asset = assets.get(req.params.file);
      if (!asset) return res.status(404).json({ error: "Not found" });
      res.sendFile(
        asset,
        { cacheControl: false, headers: { "Cache-Control": "no-store" } },
        (error) => {
          if (error) next(error);
        },
      );
    }),
  );
}
