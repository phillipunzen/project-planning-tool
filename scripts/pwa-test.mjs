import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { chromium, expect } from "@playwright/test";
import { offlineAssets } from "../shared/pwa.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.APP_URL = "http://127.0.0.1:8125";
process.env.ALLOWED_ORIGINS = "";
process.env.UPLOAD_DIR = "artifacts/pwa-uploads";
const { app } = await import("../server/index.js");
const { db, Setting } = await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
let workerOverride;
const server = createServer((req, res) => {
  if (req.url === "/sw.js" && workerOverride) {
    res.writeHead(200, {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-cache",
    });
    res.end(workerOverride);
  } else app(req, res);
});
server.listen(8125, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  locale: "de-DE",
  viewport: { width: 1440, height: 1000 },
});
let page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.APP_URL;
try {
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  const manifest = await context.request.get(
    base + "/api/manifest.webmanifest",
  );
  assert.match(
    manifest.headers()["content-type"],
    /application\/manifest\+json/,
  );
  assert.equal(manifest.headers()["cache-control"], "no-store");
  const data = await manifest.json();
  assert.equal(data.name, "Projektwerk");
  assert.equal(data.start_url, "/");
  assert.equal(data.scope, "/");
  assert.equal(data.display, "standalone");
  assert.equal(data.id, "/");
  const swResponse = await context.request.get(base + "/sw.js");
  assert.match(swResponse.headers()["content-type"], /javascript/);
  assert.equal(swResponse.headers()["cache-control"], "no-cache");
  assert.equal(swResponse.headers()["service-worker-allowed"], "/");
  for (const icon of [
    ...data.icons,
    { src: "/icons/apple-touch-icon.png", sizes: "180x180" },
  ]) {
    const dimensions = await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, icon.src);
    assert.equal(dimensions, icon.sizes);
  }
  const cdp = await context.newCDPSession(page);
  assert.deepEqual((await cdp.send("Page.getAppManifest")).errors, []);
  assert.deepEqual(
    (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors,
    [],
  );
  console.log(
    "PASS: Chromium accepts the manifest, scope, installability and decoded desktop/mobile icons",
  );

  await page.getByLabel("Dein Name").fill("PWA Admin");
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("pwa@test.example");
  await page.getByLabel("Passwort", { exact: true }).fill("PwaPassword123!");
  await page
    .getByRole("button", { name: "Arbeitsbereich erstellen", exact: true })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(6);
  // Browser install dialogs cannot be operated in headless mode. Exercise the
  // same event contract, including unavailable, dismissed and installed states.
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt");
    event.prompt = async () => {
      throw new Error("No native install dialog");
    };
    window.dispatchEvent(event);
  });
  await page
    .getByRole("button", { name: "App installieren", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText(
      "In Safari das Teilen-Menü öffnen und „Zum Home-Bildschirm“ wählen.",
    ),
  ).toBeVisible();
  await page
    .locator("dialog .modal-actions")
    .getByRole("button", { name: "Schließen" })
    .click();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {
      window.testInstallCalls = (window.testInstallCalls || 0) + 1;
    };
    event.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(event);
    if (!event.defaultPrevented)
      throw new Error("Native install prompt was not deferred");
  });
  await page
    .getByRole("button", { name: "App installieren", exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.testInstallCalls), 1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(
    page.getByRole("button", { name: "App installieren", exact: true }),
  ).toHaveCount(0);
  console.log(
    "PASS: Install help, native prompt, cancellation and hiding the installed control",
  );

  await page.evaluate(async () => {
    const projects = await (await fetch("/api/projects")).json();
    await fetch(`/api/boards/${projects[0].Boards[0].id}`);
    await fetch("/api/me");
    await fetch("/api/branding/logo/not-a-logo");
  });
  const cachedUrls = await page.evaluate(async () => {
    const urls = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys())
        urls.push(new URL(request.url).pathname);
    }
    return urls.sort();
  });
  assert.deepEqual(cachedUrls, [...offlineAssets].sort());
  await context.setOffline(true);
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("/api/me");
        return "cached";
      } catch {
        return "offline";
      }
    }),
    "offline",
  );
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
        return "queued";
      } catch {
        return "offline";
      }
    }),
    "offline",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Du bist gerade offline." }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "artifacts/pwa-offline-de.png",
    fullPage: true,
  });
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Erneut versuchen", exact: true })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(6);
  console.log(
    "PASS: Only public offline resources are cached; API reads/writes stay online; mobile offline page recovers",
  );

  const headers = { Origin: base };
  assert.equal(
    (
      await context.request.put(base + "/api/admin/branding", {
        headers,
        data: { name: "Teamplanung" },
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await context.request.patch(base + "/api/me", {
        headers,
        data: { language: "en" },
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await (
        await context.request.get(base + "/api/manifest.webmanifest")
      ).json()
    ).name,
    "Teamplanung",
  );
  await page.evaluate(() => localStorage.setItem("projektwerk-theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await context.setOffline(true);
  await page.goto(base + "/?view=invitations");
  await expect(
    page.getByRole("heading", { name: "You're currently offline." }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#brand")).toHaveText("Teamplanung");
  await page.screenshot({
    path: "artifacts/pwa-offline-en-dark.png",
    fullPage: true,
  });
  await context.setOffline(false);
  await page.goto(base);
  await expect(page.locator(".task-card")).toHaveCount(6);
  console.log(
    "PASS: System name in manifest and offline page, profile language and dark mode, application URL preserved offline",
  );

  await page.evaluate(async () => {
    window.testNoReload = "keep-current-draft";
    await caches.open("projektwerk-pwa-obsolete");
    await caches.open("unrelated-cache");
  });
  workerOverride = (await fs.readFile("dist/sw.js", "utf8")).replace(
    /projektwerk-pwa-[a-f0-9]{16}/,
    "projektwerk-pwa-browser-update",
  );
  await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistration()).update(),
  );
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration()).waiting),
      ),
    )
    .toBe(true);
  assert.equal(
    await page.evaluate(() => window.testNoReload),
    "keep-current-draft",
  );
  await expect(page.locator(".task-card")).toHaveCount(6);
  await page.close();
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await expect(page.locator(".task-card")).toHaveCount(6);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).sort()))
    .toEqual(["projektwerk-pwa-browser-update", "unrelated-cache"]);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Updates wait for app windows to close, avoid forced reloads and clean only obsolete app caches",
  );
} catch (error) {
  await page
    .screenshot({ path: "artifacts/pwa-failure.png", fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  await fs.rm("artifacts/pwa-uploads", { recursive: true, force: true });
}
