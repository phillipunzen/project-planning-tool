import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.APP_URL = "http://127.0.0.1:8132";
process.env.ALLOWED_ORIGINS = "";
process.env.UPLOAD_DIR = "artifacts/design-browser-uploads";
const { app } = await import("../server/index.js");
const { db, Setting } = await import("../server/db.js");
assert.equal(db.getDatabaseName(), "projektwerk_test");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(8132, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const base = process.env.APP_URL, headers = { Origin: base }, password = "GlassBrowser123!";
const errors = [];
const watch = page => page.on("pageerror", error => errors.push(error.message));
const profile = async page => {
  if (await page.locator(".glass-mobile-nav").isVisible()) {
    await page.locator(".glass-mobile-nav").getByRole("button", { name: /^(Profil|Profile)$/ }).click();
  } else {
    if (await page.getByRole("button", { name: /^(Menü öffnen|Open menu)$/ }).isVisible())
      await page.getByRole("button", { name: /^(Menü öffnen|Open menu)$/ }).click();
    await page.getByRole("button", { name: /^(Profileinstellungen|Profile settings)$/ }).click();
  }
};
const save = page => page.locator("dialog").getByRole("button", { name: /^(Speichern|Save)$/ }).click();
const close = page => page.locator("dialog .modal-heading").getByRole("button", { name: /^(Schließen|Close)$/ }).click();
const noOverflow = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
const desktop = await browser.newContext({ locale: "de-DE", viewport: { width: 1512, height: 1080 } });
const page = await desktop.newPage(); watch(page);
try {
  await page.goto(base);
  await expect(page.locator("html")).toHaveAttribute("data-design", "glass");
  const setup = await desktop.request.post(base + "/api/setup", { headers, data: { name: "Phillip Unzen", email: "glass@tests.example", password, sample: true } });
  assert.equal(setup.status(), 201);
  await page.reload();
  await expect(page.locator(".task-card")).toHaveCount(6);
  assert.equal(await page.locator(".task-card").first().evaluate(node => getComputedStyle(node).borderRadius), "17px");
  const baseline = await (await desktop.request.get(base + "/api/projects")).json();
  const boardId = baseline[0].Boards[0].id;
  const beforeCards = (await (await desktop.request.get(base + `/api/boards/${boardId}`)).json()).cards;
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("Darstellung", { exact: true }).selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const buttonContrast = await page.locator(".toolbar-right .primary").evaluate(button => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--solid-accent").trim();
      const base = accent.slice(1).match(/../g).map(value => parseInt(value, 16));
      const ink = getComputedStyle(button).color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
      const contrast = rgb => (Math.max(luminance(rgb), luminance(ink)) + .05) / (Math.min(luminance(rgb), luminance(ink)) + .05);
      return Math.min(contrast(base), contrast(base.map(value => .92 * value + .08 * 255)));
    });
    assert(buttonContrast >= 4.5, `Primary button text contrast too low: ${buttonContrast}`);
    await page.screenshot({ path: `artifacts/glass-desktop-${theme}.png`, fullPage: true, animations: "disabled" });
    await noOverflow(page);
  }
  await profile(page);
  await expect(page.getByRole("radio", { name: "Designstandard", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Violett", exact: true }).click();
  await save(page);
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", "violet");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", "violet");
  await profile(page);
  await page.getByRole("radio", { name: "Designstandard", exact: true }).click();
  await save(page);
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", "indigo");
  await profile(page);
  await expect(page.getByRole("radio", { name: "Liquid Glass", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Klassisch", exact: true }).check();
  await page.getByRole("radio", { name: "Ozeanblau", exact: true }).click();
  await save(page);
  await expect(page.locator("html")).toHaveAttribute("data-design", "classic");
  assert.equal(await page.locator(".task-card").first().evaluate(node => getComputedStyle(node).borderRadius), "8px");
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", "ocean");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-design", "classic");
  await page.screenshot({ path: "artifacts/classic-desktop-dark.png", fullPage: true });
  await profile(page);
  await page.getByRole("radio", { name: "Liquid Glass", exact: true }).check();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-design", "classic");
  const other = await browser.newContext({ locale: "en-GB" });
  const outsider = await other.newPage(); watch(outsider);
  await outsider.goto(base);
  await expect(outsider.locator("html")).toHaveAttribute("data-design", "glass");
  const mobile = await browser.newContext({ locale: "en-GB", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await mobile.newPage(); watch(phone);
  await mobile.request.post(base + "/api/auth/login", { headers, data: { email: "glass@tests.example", password } });
  await phone.goto(base);
  await expect(phone.locator("html")).toHaveAttribute("data-design", "classic");
  await expect(phone.locator(".glass-mobile-nav")).toBeHidden();
  await profile(phone);
  await phone.getByRole("radio", { name: "Liquid Glass", exact: true }).check();
  await save(phone);
  await expect(phone.locator("html")).toHaveAttribute("data-design", "glass");
  await expect(phone.locator(".glass-mobile-nav")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await phone.getByLabel("Appearance", { exact: true }).selectOption(theme);
    await phone.screenshot({ path: `artifacts/glass-mobile-${theme}.png`, fullPage: true, animations: "disabled" });
    await noOverflow(phone);
  }
  await profile(phone);
  await phone.screenshot({ path: "artifacts/glass-mobile-profile.png", fullPage: true });
  await expect(phone.getByRole("radio", { name: "Liquid Glass", exact: true })).toBeChecked();
  await close(phone);
  assert((await phone.locator(".kanban-column").first().boundingBox()).width >= 360);
  await phone.locator(".glass-mobile-nav").getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(phone.locator(".glass-mobile-nav [aria-current=page]")).toHaveText("Tasks");
  await phone.locator(".glass-mobile-nav").getByRole("button", { name: "Board", exact: true }).click();
  await expect(phone.locator(".task-card")).toHaveCount(6);
  await phone.locator(".task-card").first().locator(".card-title").click();
  await expect(phone.locator("dialog.task-dialog")).toBeVisible();
  await phone.screenshot({ path: "artifacts/glass-mobile-task.png", fullPage: true });
  await noOverflow(phone);
  await close(phone);
  await phone.reload();
  await expect(phone.locator("html")).toHaveAttribute("data-design", "glass");
  const afterCards = (await (await desktop.request.get(base + `/api/boards/${boardId}`)).json()).cards;
  assert.deepEqual(afterCards, beforeCards);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-design", "glass");
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", "ocean");
  await page.setViewportSize({ width: 1024, height: 1366 });
  await noOverflow(page);
  await page.screenshot({ path: "artifacts/glass-tablet.png", fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await expect(page.locator(".task-card").first()).toBeVisible();
  await page.screenshot({ path: "artifacts/glass-forced-colors.png", fullPage: true });
  const devtools = await desktop.newCDPSession(page);
  await devtools.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  assert(await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches));
  assert.equal(await page.locator(".sidebar").evaluate(node => getComputedStyle(node).backdropFilter), "none");
  await devtools.detach();
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1512, height: 900 });
  const tallBoard = await (await desktop.request.get(base + `/api/boards/${boardId}`)).json();
  for (let index = 0; index < 8; index++) {
    const created = await desktop.request.post(base + `/api/boards/${boardId}/cards`, {
      headers,
      data: { title: `Langes Board ${index + 1}`, columnId: tallBoard.columns[0].id },
    });
    assert.equal(created.status(), 201);
  }
  await page.reload();
  await expect(page.locator(".task-card")).toHaveCount(14);
  const height = await page.evaluate(() => ({
    document: document.documentElement.scrollHeight,
    canvas: document.documentElement.getBoundingClientRect().height,
    viewport: innerHeight,
  }));
  assert(height.document > height.viewport * 2);
  assert(height.canvas >= height.document - 1);
  for (const mode of ["light", "dark"]) {
    await page.getByLabel("Darstellung", { exact: true }).selectOption(mode);
    await page.screenshot({ path: `artifacts/glass-long-board-${mode}.png`, fullPage: true, animations: "disabled" });
  }
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await other.close(); await mobile.close();
  console.log("PASS: Glass default, Classic option, save/cancel, cross-device profile, independent colour theme, EN/DE, light/dark, mobile navigation/task editor, tablet, forced colours, unchanged task data.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await db.close();
}
