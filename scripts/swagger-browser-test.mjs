import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.APP_URL = "http://127.0.0.1:8130";
process.env.ALLOWED_ORIGINS = "";
process.env.UPLOAD_DIR = "artifacts/swagger-test-uploads";
const { app } = await import("../server/index.js");
const { db, Setting } = await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
  );
  app(req, res);
});
server.listen(8130, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
    locale: "de-DE",
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage(),
  errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (
    /^https?:/.test(r.url()) &&
    !r.url().startsWith(process.env.APP_URL + "/")
  )
    external.push(r.url());
});
await context.addInitScript(() => {
  window.cspViolations = [];
  document.addEventListener("securitypolicyviolation", (event) =>
    window.cspViolations.push(event.violatedDirective),
  );
});
const base = process.env.APP_URL,
  headers = { Origin: base };
const authorize = async (token) => {
  await page.getByRole("button", { name: "Authorize", exact: true }).click();
  const dialog = page.locator(".dialog-ux");
  const logout = dialog.getByRole("button", {
    name: "Remove authorization",
    exact: true,
  });
  if (await logout.isVisible()) await logout.click();
  await dialog.locator("input[type=text]").fill(token);
  await dialog
    .getByRole("button", { name: "Apply credentials", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Remove authorization", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
};
try {
  const anonymous = await browser.newContext();
  for (const path of [
    "/api/docs",
    "/api/docs/assets/swagger-ui-bundle.js",
    "/api/docs/assets/init.js",
  ]) {
    const result = await anonymous.request.get(base + path);
    assert.equal(result.status(), 401);
  }
  await anonymous.close();
  assert.equal(
    (
      await context.request.post(base + "/api/setup", {
        headers,
        data: {
          name: "Swagger Admin",
          email: "swagger@tests.example",
          password: "SwaggerPassword123!",
          sample: true,
        },
      })
    ).status(),
    201,
  );
  const project = (
      await (await context.request.get(base + "/api/projects")).json()
    )[0],
    board = await (
      await context.request.get(base + `/api/boards/${project.Boards[0].id}`)
    ).json(),
    card = board.cards[0];
  const create = async (mode) =>
    (
      await (
        await context.request.post(base + "/api/me/api-tokens", {
          headers,
          data: { name: mode, mode, boardIds: [board.id] },
        })
      ).json()
    ).token;
  const read = await create("read"),
    write = await create("write");
  await page.goto(
    base + "/api/docs?url=https%3A%2F%2Funtrusted.example%2Fspec.json",
  );
  await expect(
    page.getByRole("heading", {
      name: "Swagger API-Dokumentation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".opblock")).toHaveCount(12);
  assert.equal(
    (
      await context.request.get(base + "/api/docs/assets/package.json")
    ).status(),
    404,
  );
  await authorize(read);
  const list = page.locator("#operations-default-listBoards");
  await list.locator(".opblock-summary").click();
  await list.getByRole("button", { name: "Try it out", exact: true }).click();
  const readResponse = page.waitForResponse(
    (r) =>
      r.url() === base + "/api/v1/boards" && r.request().method() === "GET",
  );
  await list.getByRole("button", { name: "Execute", exact: true }).click();
  const result = await readResponse;
  assert.equal(result.status(), 200);
  assert.equal((await result.json())[0].id, board.id);
  const update = page.locator("#operations-default-updateCard");
  await update.locator(".opblock-summary").click();
  await update.getByRole("button", { name: "Try it out", exact: true }).click();
  await update.locator('input[placeholder="cardId"]').fill(card.id);
  await update
    .locator("textarea")
    .fill(JSON.stringify({ version: card.version, progress: 25 }));
  let response = page.waitForResponse(
    (r) =>
      r.url() === base + `/api/v1/cards/${card.id}` &&
      r.request().method() === "PATCH",
  );
  await update.getByRole("button", { name: "Execute", exact: true }).click();
  assert.equal((await response).status(), 403);
  await authorize(write);
  response = page.waitForResponse(
    (r) =>
      r.url() === base + `/api/v1/cards/${card.id}` &&
      r.request().method() === "PATCH",
  );
  await update.getByRole("button", { name: "Execute", exact: true }).click();
  assert.equal((await response).status(), 200);
  response = page.waitForResponse(
    (r) =>
      r.url() === base + `/api/v1/cards/${card.id}` &&
      r.request().method() === "PATCH",
  );
  await update.getByRole("button", { name: "Execute", exact: true }).click();
  assert.equal((await response).status(), 409);
  assert.equal(
    (await (await context.request.get(base + `/api/cards/${card.id}`)).json())
      .progress,
    25,
  );
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  assert(!stored.includes(read) && !stored.includes(write));
  assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
  assert.deepEqual(external, []);
  console.log(
    "PASS: Authenticated Swagger UI with local assets and production CSP; bearer reads, write protection, editing and version conflicts",
  );
  await page.reload();
  await page.getByRole("button", { name: "Authorize", exact: true }).click();
  await expect(page.locator(".dialog-ux input[type=text]")).toHaveValue("");
  await page
    .locator(".dialog-ux")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.goto(base);
  await expect(page.locator(".task-card")).toHaveCount(6);
  await page
    .getByRole("button", { name: "Profileinstellungen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "API-Zugriff verwalten", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Swagger API-Dokumentation öffnen",
      exact: true,
    }),
  ).toHaveAttribute("href", "/api/docs");
  const mobileContext = await browser.newContext({
      locale: "en-GB",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      storageState: await context.storageState(),
    }),
    mobile = await mobileContext.newPage();
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto(base + "/api/docs");
  await expect(
    mobile.getByRole("heading", {
      name: "Swagger API documentation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(mobile.locator(".opblock")).toHaveCount(12);
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await mobile.screenshot({
    path: "artifacts/mobile-swagger-docs.png",
    fullPage: false,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Authorization cleared on refresh, profile link, English mobile docs and no page overflow",
  );
} catch (error) {
  console.error("Browser errors:", JSON.stringify(errors));
  await page
    .screenshot({ path: "artifacts/swagger-failure.png", fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
