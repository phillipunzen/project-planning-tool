import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.APP_URL = "http://127.0.0.1:8129";
process.env.ALLOWED_ORIGINS = "";
process.env.UPLOAD_DIR = "artifacts/integration-browser-uploads";
const { app } = await import("../server/index.js");
const { db, Setting } = await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(8129, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
    locale: "de-DE",
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.APP_URL,
  headers = { Origin: base },
  password = "IntegrationBrowser123!";
const close = () =>
  page
    .locator("dialog .modal-heading")
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
const open = async () => {
  await page
    .getByRole("button", { name: "Profileinstellungen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "API-Zugriff verwalten", exact: true })
    .click();
  await expect(page.getByLabel("Tokenname", { exact: true })).toBeEnabled();
};
try {
  await page.goto(base);
  await page.getByLabel("Dein Name").fill("API Admin");
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("admin@integration-browser.test");
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Arbeitsbereich erstellen", exact: true })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(6);
  const project = (
      await (await context.request.get(base + "/api/projects")).json()
    )[0],
    boardId = project.Boards[0].id;
  await open();
  await expect(page.getByLabel("API-Adresse", { exact: true })).toHaveValue(
    base + "/api/v1",
  );
  await page.getByLabel("Tokenname", { exact: true }).fill("KI Assistent");
  await page
    .getByLabel("Token-Gültigkeit", { exact: true })
    .selectOption("unlimited");
  await page
    .getByLabel("API-Berechtigung", { exact: true })
    .selectOption("write");
  await page.locator(".api-board-list input").first().check();
  await page
    .getByRole("button", { name: "API-Token erstellen", exact: true })
    .click();
  await expect(
    page.getByLabel("Neuer API-Token", { exact: true }),
  ).toBeVisible();
  const token = await page
    .getByLabel("Neuer API-Token", { exact: true })
    .inputValue();
  assert.match(token, /^pw_[\w-]{43}$/);
  const request = async (path, method = "GET", body) => {
    const result = await fetch(base + "/api/v1" + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: result.status, data: await result.json() };
  };
  const created = await request(`/boards/${boardId}/cards`, "POST", {
    title: "Externe KI Aufgabe",
    columnId: (await request(`/boards/${boardId}`)).data.columns[0].id,
  });
  assert.equal(created.status, 201);
  await close();
  await expect(
    page.getByRole("button", { name: "Externe KI Aufgabe", exact: true }),
  ).toBeVisible({ timeout: 12000 });
  await open();
  await expect(page.getByLabel("Neuer API-Token", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.locator(".api-token-row").getByText("KI Assistent", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".api-token-row").getByText("Unbegrenzt", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Widerrufen", exact: true }).click();
  await expect(
    page.getByText("Token ist widerrufen", { exact: true }),
  ).toBeVisible();
  assert.equal((await request("/boards")).status, 401);
  await close();
  console.log(
    "PASS: Profile token creation, external task creation, one-time secret display and revocation",
  );
  const mobileContext = await browser.newContext({
      locale: "en-GB",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    mobile = await mobileContext.newPage();
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto(base);
  await mobile
    .getByLabel("Email address", { exact: true })
    .fill("admin@integration-browser.test");
  await mobile.getByLabel("Password", { exact: true }).fill(password);
  await mobile.getByRole("button", { name: "Sign in", exact: true }).tap();
  await expect(mobile.locator(".task-card")).toHaveCount(7);
  await mobile.getByRole("button", { name: "Open menu", exact: true }).tap();
  await mobile
    .getByRole("button", { name: "Profile settings", exact: true })
    .tap();
  await mobile
    .getByRole("button", { name: "Manage API access", exact: true })
    .tap();
  await mobile.getByLabel("Token name", { exact: true }).fill("Mobile reader");
  await mobile
    .getByLabel("Token validity", { exact: true })
    .selectOption("unlimited");
  await mobile.locator(".api-board-list input").first().check();
  await mobile
    .getByRole("button", { name: "Create API token", exact: true })
    .tap();
  await expect(
    mobile.getByLabel("New API token", { exact: true }),
  ).toBeVisible();
  await expect(
    mobile
      .locator(".api-token-row")
      .getByText("No expiration", { exact: true }),
  ).toBeVisible();
  const readToken = await mobile
    .getByLabel("New API token", { exact: true })
    .inputValue();
  assert.equal(
    (
      await fetch(base + "/api/v1/boards", {
        headers: { Authorization: `Bearer ${readToken}` },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(base + `/api/v1/cards/${created.data.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${readToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: 0, title: "Not allowed" }),
      })
    ).status,
    403,
  );
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await mobile.screenshot({
    path: "artifacts/mobile-api-access.png",
    fullPage: false,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: English mobile API token management, readable scope selection and read-only protection",
  );
} catch (error) {
  console.error("Browser errors:", JSON.stringify(errors));
  await page
    .screenshot({
      path: "artifacts/integration-browser-failure.png",
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
