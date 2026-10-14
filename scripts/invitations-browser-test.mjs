import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.APP_URL = "http://127.0.0.1:8128";
process.env.ALLOWED_ORIGINS = "";
process.env.UPLOAD_DIR = "artifacts/invitations-browser-uploads";
const { app } = await import("../server/index.js");
const { db, Setting } = await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(8128, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const adminContext = await browser.newContext({
  locale: "de-DE",
  viewport: { width: 1440, height: 1000 },
});
const page = await adminContext.newPage(),
  errors = [];
const mobileContext = await browser.newContext({
  locale: "en-GB",
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const mobile = await mobileContext.newPage();
for (const target of [page, mobile])
  target.on("pageerror", (error) => errors.push(error.message));
const base = process.env.APP_URL,
  headers = { Origin: base },
  password = "InboxBrowser123!";
const close = () =>
  page
    .locator("dialog .modal-heading")
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
try {
  await page.goto(base);
  await page.getByLabel("Dein Name").fill("Alex Admin");
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("admin@inbox-browser.test");
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Arbeitsbereich erstellen", exact: true })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(6);
  const user = await (
    await adminContext.request.post(base + "/api/admin/users", {
      headers,
      data: {
        name: "Kim Mobile",
        email: "mobile@inbox-browser.test",
        password,
      },
    })
  ).json();
  const projects = await (
      await adminContext.request.get(base + "/api/projects")
    ).json(),
    project = projects[0];
  await mobile.goto(base);
  await mobile.getByLabel("Email address", { exact: true }).fill(user.email);
  await mobile.getByLabel("Password", { exact: true }).fill(password);
  await mobile.getByRole("button", { name: "Sign in", exact: true }).tap();
  await mobile.getByRole("button", { name: "Invitations", exact: true }).tap();
  await expect(
    mobile.getByText("No pending invitations", { exact: true }),
  ).toBeVisible();
  async function invite(role = "viewer") {
    await page.getByRole("button", { name: "Einladen", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Benutzer einladen", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("dialog input[type=email]")).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Name oder E-Mail suchen", exact: true })
      .fill("Kim Mobile");
    await page.getByRole("option", { name: /Kim Mobile/ }).click();
    await page.getByLabel("Berechtigung", { exact: true }).selectOption(role);
    await page
      .getByRole("button", { name: "Benutzer einladen", exact: true })
      .click();
    await expect(
      page.getByText("Einladung im Tool erstellt", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Einladungslink", { exact: true }),
    ).toHaveCount(0);
    await close();
    await expect(mobile.locator(".inbox-invitation")).toHaveCount(1, {
      timeout: 12000,
    });
    await expect(mobile.locator(".invitation-count")).toHaveText("1");
  }
  await invite();
  await expect(
    mobile.getByText("Invited by Alex Admin", { exact: true }),
  ).toBeVisible();
  await expect(mobile.getByText("Can view", { exact: true })).toBeVisible();
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await mobile.screenshot({
    path: "artifacts/mobile-invitations.png",
    fullPage: false,
  });
  await mobile.getByRole("button", { name: "Decline", exact: true }).tap();
  await expect(
    mobile.getByText("No pending invitations", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(
    await (await mobileContext.request.get(base + "/api/projects")).json(),
    [],
  );
  console.log(
    "PASS: In-app invitation without email or link, live mobile inbox/badge, English UI and decline",
  );
  await invite();
  await page.getByRole("button", { name: "Einladen", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Einladung an Kim Mobile zurückziehen",
      exact: true,
    })
    .click();
  await close();
  await expect(mobile.locator(".inbox-invitation")).toHaveCount(0, {
    timeout: 12000,
  });
  console.log("PASS: Revoked invitations disappear from an already open inbox");
  await invite();
  await mobile.route("**/api/invitations/*/accept", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Try again" }),
    }),
  );
  await mobile.getByRole("button", { name: "Accept", exact: true }).tap();
  await expect(mobile.getByRole("alert")).toHaveText("Try again");
  await expect(
    mobile.getByRole("button", { name: "Accept", exact: true }),
  ).toBeEnabled();
  await mobile.unroute("**/api/invitations/*/accept");
  await mobile.getByRole("button", { name: "Accept", exact: true }).tap();
  await expect(mobile.locator(".task-card")).toHaveCount(6);
  await expect(
    mobile.getByRole("button", { name: "Create task", exact: true }),
  ).toHaveCount(0);
  assert.equal(
    (await (await mobileContext.request.get(base + "/api/projects")).json())[0]
      .myRole,
    "viewer",
  );
  await mobile.reload();
  await expect(mobile.locator(".task-card")).toHaveCount(6);
  await mobile.getByRole("button", { name: "Invitations", exact: true }).tap();
  await expect(
    mobile.getByText("No pending invitations", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Einladungen", exact: true }).click();
  await expect(
    page.getByText("Keine offenen Einladungen", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Retry after network failure, explicit acceptance, persisted viewer role and German inbox",
  );
} catch (error) {
  console.error("Browser errors:", JSON.stringify(errors));
  await page
    .screenshot({
      path: "artifacts/invitations-failure-desktop.png",
      fullPage: true,
    })
    .catch(() => {});
  await mobile
    .screenshot({
      path: "artifacts/invitations-failure-mobile.png",
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
