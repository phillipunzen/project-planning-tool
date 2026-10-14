import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.APP_URL = "http://127.0.0.1:8127";
process.env.ALLOWED_ORIGINS = "";
process.env.UPLOAD_DIR = "artifacts/custom-fields-browser-uploads";
const { app } = await import("../server/index.js");
const { db, Setting } = await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(8127, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  locale: "de-DE",
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.APP_URL,
  headers = { Origin: base };
const close = () =>
  page
    .locator("dialog .modal-heading")
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
const getBoard = async (id) =>
  (await context.request.get(base + `/api/boards/${id}`)).json();
try {
  await page.goto(base);
  await page.getByLabel("Dein Name").fill("Feld Admin");
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("fields-browser@test.example");
  await page.getByLabel("Passwort", { exact: true }).fill("BrowserFields123!");
  await page
    .getByRole("button", { name: "Arbeitsbereich erstellen", exact: true })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(6);
  const project = (
      await (await context.request.get(base + "/api/projects")).json()
    )[0],
    boardId = project.Boards[0].id;
  await page
    .getByRole("button", { name: "Aufgabenvorlagen", exact: true })
    .click();
  await expect(page.getByLabel("Vorlagenname", { exact: true })).toBeEnabled();
  await page.getByLabel("Vorlagenname", { exact: true }).fill("Service Ticket");
  await page
    .getByRole("button", { name: "Feld hinzufügen", exact: true })
    .click();
  await page.getByLabel("Feldname 1", { exact: true }).fill("Umgebung");
  await page.getByLabel("Feldtyp 1", { exact: true }).selectOption("dropdown");
  await page
    .getByRole("button", { name: "Option hinzufügen", exact: true })
    .click();
  await page.getByLabel("Option 1 für Feld 1", { exact: true }).fill("Test");
  await page
    .getByRole("button", { name: "Feld hinzufügen", exact: true })
    .click();
  await page.getByLabel("Feldname 2", { exact: true }).fill("Referenz");
  await page
    .getByLabel("Als Standard für dieses Board verwenden", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  await expect(
    page.getByText("Vorlage gespeichert", { exact: true }),
  ).toBeVisible();
  let board = await getBoard(boardId),
    template = board.templates[0];
  const dropdownId = template.fields[0].id,
    textId = template.fields[1].id;
  await close();
  await page
    .getByRole("button", { name: "Aufgabe erstellen", exact: true })
    .click();
  await page.getByLabel("Titel", { exact: true }).fill("Ticket mit Feldern");
  await page
    .getByLabel("Umgebung", { exact: true })
    .selectOption(template.fields[0].options[0].id);
  await page.getByLabel("Referenz", { exact: true }).fill("ABC-123");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Aufgabe erstellen", exact: true })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(7);
  board = await getBoard(boardId);
  const cardId = board.cards.find(
    (card) => card.title === "Ticket mit Feldern",
  ).id;
  await page
    .getByRole("button", { name: "Ticket mit Feldern", exact: true })
    .click();
  await expect(page.getByLabel("Referenz", { exact: true })).toHaveValue(
    "ABC-123",
  );
  const option = { id: randomUUID(), label: "Produktion" };
  template.fields[0].options.push(option);
  template.fields[1].name = "Ticketnummer";
  const numberField = {
    id: randomUUID(),
    name: "Aufwand",
    type: "number",
    options: [],
  };
  template.fields.push(numberField);
  const { id, ...content } = template;
  const changed = await context.request.patch(
    base + `/api/boards/${boardId}/templates/${id}`,
    { headers, data: { ...content, revision: board.templateRevision } },
  );
  assert.equal(changed.status(), 200);
  await expect(
    page
      .getByLabel("Umgebung", { exact: true })
      .getByRole("option", { name: "Produktion", exact: true }),
  ).toHaveCount(1, { timeout: 12000 });
  await expect(page.getByLabel("Ticketnummer", { exact: true })).toHaveValue(
    "ABC-123",
  );
  await expect(page.getByLabel("Aufwand", { exact: true })).toBeVisible();
  await page.getByLabel("Umgebung", { exact: true }).selectOption(option.id);
  await expect
    .poll(
      async () =>
        (await getBoard(boardId)).cards.find((card) => card.id === cardId)
          .customValues[dropdownId],
    )
    .toBe(option.id);
  await page.getByLabel("Ticketnummer", { exact: true }).focus();
  await page
    .getByLabel("Ticketnummer", { exact: true })
    .pressSequentially(" extra", { delay: 80 });
  assert.equal(
    (await getBoard(boardId)).cards.find((card) => card.id === cardId)
      .customValues[textId],
    "ABC-123",
  );
  await page.getByLabel("Aufwand", { exact: true }).focus();
  await expect
    .poll(
      async () =>
        (await getBoard(boardId)).cards.find((card) => card.id === cardId)
          .customValues[textId],
    )
    .toBe("ABC-123 extra");
  await page.getByLabel("Aufwand", { exact: true }).fill("2.5");
  await page.getByLabel("Titel", { exact: true }).focus();
  await expect
    .poll(
      async () =>
        (await getBoard(boardId)).cards.find((card) => card.id === cardId)
          .customValues[numberField.id],
    )
    .toBe(2.5);
  await close();
  console.log(
    "PASS: Template field editor, linked task creation, live schema updates and immediate/deferred autosave",
  );

  await page
    .getByRole("button", { name: "Aufgabenvorlagen", exact: true })
    .click();
  await expect(page.getByLabel("Vorlagenname", { exact: true })).toBeEnabled();
  await page
    .locator(".template-list")
    .getByRole("button", { name: /Service Ticket/ })
    .click();
  await expect(page.getByLabel("Feldtyp 1", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Option hinzufügen", exact: true })
    .click();
  await page.getByLabel("Option 3 für Feld 1", { exact: true }).fill("Staging");
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  await expect(
    page.getByText("Vorlage gespeichert", { exact: true }),
  ).toBeVisible();
  await close();
  board = await getBoard(boardId);
  template = board.templates[0];
  assert.equal(template.fields[0].options[1].id, option.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Ticket mit Feldern", exact: true })
    .click();
  const select = page.getByLabel("Umgebung", { exact: true });
  await expect(select).toHaveValue(option.id);
  await expect(
    select.getByRole("option", { name: "Staging", exact: true }),
  ).toHaveCount(1);
  assert.equal(
    await select.evaluate((element) => getComputedStyle(element).fontSize),
    "16px",
  );
  await select.selectOption(template.fields[0].options[2].id);
  await expect
    .poll(
      async () =>
        (await getBoard(boardId)).cards.find((card) => card.id === cardId)
          .customValues[dropdownId],
    )
    .toBe(template.fields[0].options[2].id);
  await page.screenshot({
    path: "artifacts/mobile-custom-task-fields.png",
    fullPage: false,
  });
  await close();
  console.log("PASS: Stable option IDs and mobile custom fields");

  const { id: templateId, ...last } = template;
  last.fields = [
    { ...last.fields[0], options: [last.fields[0].options[0]] },
    numberField,
  ];
  const removed = await context.request.patch(
    base + `/api/boards/${boardId}/templates/${templateId}`,
    { headers, data: { ...last, revision: board.templateRevision } },
  );
  assert.equal(removed.status(), 200);
  await page
    .getByRole("button", { name: "Ticket mit Feldern", exact: true })
    .click();
  await expect(page.getByLabel("Ticketnummer", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Ticketnummer", { exact: true })).toHaveValue(
    "ABC-123 extra",
  );
  await expect(
    page
      .getByLabel("Umgebung", { exact: true })
      .getByRole("option", { name: "Staging · Entfernt", exact: true }),
  ).toHaveCount(1);
  await page
    .getByLabel("Titel", { exact: true })
    .fill("Ticket bleibt erhalten");
  await close();
  board = await getBoard(boardId);
  assert.equal(
    board.cards.find((card) => card.id === cardId).customValues[textId],
    "ABC-123 extra",
  );
  assert.equal(
    (
      await context.request.delete(
        base + `/api/boards/${boardId}/templates/${templateId}`,
        { headers, data: { revision: board.templateRevision } },
      )
    ).status(),
    200,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Ticket bleibt erhalten", exact: true })
    .click();
  await expect(page.getByLabel("Umgebung", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Ticketnummer", { exact: true })).toHaveValue(
    "ABC-123 extra",
  );
  await close();
  console.log(
    "PASS: Removed definitions/options and deleted templates preserve task values",
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
