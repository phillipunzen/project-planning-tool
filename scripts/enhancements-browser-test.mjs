import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.APP_URL = "http://127.0.0.1:8126";
process.env.ALLOWED_ORIGINS = "";
process.env.UPLOAD_DIR = "artifacts/enhancement-browser-uploads";
const { app } = await import("../server/index.js");
const { db, Setting } = await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(8126, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  locale: "de-DE",
  viewport: { width: 1440, height: 1050 },
});
const page = await context.newPage(),
  errors = [];
const watch = (target) =>
  target.on("pageerror", (error) => errors.push(error.message));
watch(page);
const base = process.env.APP_URL,
  headers = { Origin: base },
  password = "FeatureBrowser123!";
const close = async (target) =>
  target
    .locator("dialog .modal-heading")
    .getByRole("button", { name: /^(Schließen|Close)$/ })
    .click();
try {
  await page.goto(base);
  await page.getByLabel("Dein Name").fill("Alex Mobil");
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("mobile-admin@test.example");
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Arbeitsbereich erstellen", exact: true })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(6);
  const projects = await (
    await context.request.get(base + "/api/projects")
  ).json();
  const project = projects[0],
    boardId = project.Boards[0].id;
  const original = await (
    await context.request.get(base + `/api/boards/${boardId}`)
  ).json();
  const candidateResponse = await context.request.post(
    base + "/api/admin/users",
    {
      headers,
      data: {
        name: "Jamie Muster",
        email: "jamie-mobile@test.example",
        password,
        role: "user",
      },
    },
  );
  assert.equal(candidateResponse.status(), 201);
  const candidate = await candidateResponse.json();
  await page.getByRole("button", { name: "Einladen", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Name oder E-Mail suchen", exact: true })
    .fill("Muster");
  await expect(
    page.getByRole("option", { name: /Jamie Muster/ }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Name oder E-Mail suchen", exact: true })
    .press("Enter");
  await expect(
    page.locator("dialog").getByLabel("E-Mail-Adresse", { exact: true }),
  ).toHaveValue(candidate.email);
  await page
    .getByRole("button", { name: "Einladungslink erstellen", exact: true })
    .click();
  const invite = await page
    .getByLabel("Einladungslink", { exact: true })
    .inputValue();
  await close(page);
  const guestContext = await browser.newContext({
    locale: "en-GB",
    viewport: { width: 1280, height: 1000 },
  });
  const guest = await guestContext.newPage();
  watch(guest);
  await guest.goto(invite);
  await guest
    .getByRole("button", {
      name: "Already have an account or company login? Sign in",
      exact: true,
    })
    .click();
  await guest
    .getByLabel("Email address", { exact: true })
    .fill(candidate.email);
  await guest.getByLabel("Password", { exact: true }).fill(password);
  await guest.getByRole("button", { name: "Sign in", exact: true }).click();
  await guest
    .getByRole("button", { name: "Join project", exact: true })
    .click();
  await expect(guest.locator(".task-card")).toHaveCount(6);
  console.log(
    "PASS: Display-name search, keyboard choice, email selection and invitation of an existing user",
  );

  await page
    .getByRole("button", { name: "Aufgabenvorlagen", exact: true })
    .click();
  await expect(page.getByLabel("Vorlagenname", { exact: true })).toBeEnabled();
  await page.getByLabel("Vorlagenname", { exact: true }).fill("Serviceauftrag");
  await page
    .getByLabel("Aufgabentitel (optional)", { exact: true })
    .fill("Neue Anfrage");
  await page
    .getByLabel("Vorlagenbeschreibung", { exact: true })
    .fill("Anfrage prüfen");
  await page
    .getByLabel("Vorlagenpriorität", { exact: true })
    .selectOption("high");
  await page
    .getByLabel("Vorlagenlabels", { exact: true })
    .fill("Support, Test");
  await page
    .getByLabel("Vorlagencheckliste", { exact: true })
    .fill("Prüfen\nFreigeben");
  await page
    .getByLabel("Als Standard für dieses Board verwenden", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  await expect(
    page.getByText("Vorlage gespeichert", { exact: true }),
  ).toBeVisible();
  await close(page);
  await page
    .getByRole("button", { name: "Aufgabe erstellen", exact: true })
    .click();
  await expect(page.getByLabel("Titel", { exact: true })).toHaveValue(
    "Neue Anfrage",
  );
  await expect(page.getByLabel("Beschreibung", { exact: true })).toHaveValue(
    "Anfrage prüfen",
  );
  await expect(page.getByLabel("Priorität", { exact: true })).toHaveValue(
    "high",
  );
  await expect(
    page.getByRole("checkbox", { name: "Prüfen", exact: true }),
  ).not.toBeChecked();
  await page.getByLabel("Titel", { exact: true }).fill("Admin Servicefall");
  await page.getByRole("checkbox", { name: "Prüfen", exact: true }).check();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Aufgabe erstellen", exact: true })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(7);
  await guest.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(guest.getByLabel("Title", { exact: true })).toHaveValue(
    "Neue Anfrage",
  );
  await expect(
    guest.getByRole("checkbox", { name: "Prüfen", exact: true }),
  ).not.toBeChecked();
  await guest.getByLabel("Title", { exact: true }).fill("Guest Servicefall");
  await guest
    .locator("dialog")
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(guest.locator(".task-card")).toHaveCount(8);
  let current = await (
    await context.request.get(base + `/api/boards/${boardId}`)
  ).json();
  const first = current.cards.find(
      (entry) => entry.title === "Admin Servicefall",
    ),
    second = current.cards.find((entry) => entry.title === "Guest Servicefall");
  assert.notEqual(first.checklist[0].id, second.checklist[0].id);
  assert.equal(first.checklist[0].done, true);
  assert.equal(second.checklist[0].done, false);
  for (const before of original.cards)
    assert.deepEqual(
      current.cards.find((entry) => entry.id === before.id),
      before,
    );
  const other = await (
    await context.request.post(base + `/api/projects/${project.id}/boards`, {
      headers,
      data: { name: "Separate board" },
    })
  ).json();
  await page.reload();
  await page
    .getByLabel("Board auswählen", { exact: true })
    .selectOption(other.id);
  await expect(page.locator(".task-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Aufgabe erstellen", exact: true })
    .click();
  await expect(page.getByLabel("Titel", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Aufgabenvorlage", { exact: true })).toHaveCount(
    0,
  );
  await close(page);
  await page
    .getByLabel("Board auswählen", { exact: true })
    .selectOption(boardId);
  await expect(page.locator(".task-card")).toHaveCount(8);
  console.log(
    "PASS: Shared board defaults for two users, independent checklists, existing cards preserved and separate board unaffected",
  );

  await page
    .getByRole("button", { name: "Aufgabenvorlagen", exact: true })
    .click();
  await expect(page.getByLabel("Vorlagenname", { exact: true })).toBeEnabled();
  await page
    .locator(".template-list")
    .getByRole("button", { name: /Serviceauftrag/ })
    .click();
  await page
    .getByLabel("Vorlagenbeschreibung", { exact: true })
    .fill("Neue Vorlagenbeschreibung");
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  await expect(
    page.getByText("Vorlage gespeichert", { exact: true }),
  ).toBeVisible();
  const templates = await (
    await context.request.get(base + `/api/boards/${boardId}/templates`)
  ).json();
  await page
    .getByLabel("Aufgabentitel (optional)", { exact: true })
    .fill("Lokaler Entwurf");
  const { id, ...remote } = templates.templates[0];
  assert.equal(
    (
      await context.request.patch(
        base + `/api/boards/${boardId}/templates/${id}`,
        {
          headers,
          data: {
            ...remote,
            name: "Teamvorlage",
            revision: templates.revision,
            setAsDefault: true,
          },
        },
      )
    ).status(),
    200,
  );
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  await expect(
    page.getByText(/Die Vorlagen wurden inzwischen geändert/),
  ).toBeVisible();
  await expect(
    page.getByLabel("Aufgabentitel (optional)", { exact: true }),
  ).toHaveValue("Lokaler Entwurf");
  await page
    .getByRole("button", { name: "Aktuellen Stand laden", exact: true })
    .click();
  await expect(page.getByLabel("Vorlagenname", { exact: true })).toBeEnabled();
  await page
    .locator(".template-list")
    .getByRole("button", { name: /Teamvorlage/ })
    .click();
  await page
    .getByRole("button", { name: "Vorlage löschen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Endgültig löschen", exact: true })
    .click();
  await expect(page.getByLabel("Board-Standard", { exact: true })).toHaveValue(
    "",
  );
  await close(page);
  const afterDelete = await (
    await context.request.get(base + `/api/boards/${boardId}`)
  ).json();
  assert.deepEqual(
    afterDelete.cards,
    current.cards.map((entry) => ({
      ...entry,
      templateId: entry.templateId === id ? null : entry.templateId,
    })),
  );
  await page
    .getByRole("button", { name: "Admin Servicefall", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Als Vorlage speichern", exact: true })
    .click();
  await expect(page.getByLabel("Vorlagenname", { exact: true })).toHaveValue(
    "Admin Servicefall",
  );
  await page.getByLabel("Vorlagenname", { exact: true }).fill("Kopie");
  await page
    .getByLabel("Als Standard für dieses Board verwenden", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  await expect(
    page.getByText("Vorlage gespeichert", { exact: true }),
  ).toBeVisible();
  await close(page);
  await page
    .getByRole("button", { name: "Aufgabe erstellen", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Prüfen", exact: true }),
  ).not.toBeChecked();
  await page.getByLabel("Aufgabenvorlage", { exact: true }).selectOption("");
  await expect(page.getByLabel("Titel", { exact: true })).toHaveValue("");
  await close(page);
  console.log(
    "PASS: Template editing, protected conflict draft, deletion without changing cards, copying a card and blank override",
  );

  await page
    .getByRole("button", { name: "Profileinstellungen", exact: true })
    .click();
  await page.getByRole("radio", { name: "Ozeanblau", exact: true }).click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-color-theme",
    "ocean",
  );
  await page.getByLabel("Darstellung", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute(
    "data-color-theme",
    "ocean",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-color-theme",
    "ocean",
  );
  await expect(guest.locator("html")).toHaveAttribute(
    "data-color-theme",
    "indigo",
  );
  await guest
    .getByRole("button", { name: "Profile settings", exact: true })
    .click();
  await guest.getByRole("radio", { name: "Forest green", exact: true }).click();
  await guest.getByRole("button", { name: "Save", exact: true }).click();
  await expect(guest.locator("html")).toHaveAttribute(
    "data-color-theme",
    "forest",
  );
  await page.screenshot({
    path: "artifacts/theme-ocean-desktop.png",
    fullPage: true,
  });
  const mobileContext = await browser.newContext({
    locale: "en-GB",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  watch(mobile);
  await mobile.goto(base);
  await mobile
    .getByLabel("Email address", { exact: true })
    .fill(candidate.email);
  await mobile.getByLabel("Password", { exact: true }).fill(password);
  await mobile.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(mobile.locator("html")).toHaveAttribute(
    "data-color-theme",
    "forest",
  );
  await mobile
    .getByLabel("Select board", { exact: true })
    .selectOption(boardId);
  await expect(mobile.locator(".task-card")).toHaveCount(8);
  console.log(
    "PASS: Independent user themes, light/dark compatibility and profile preference on a fresh mobile device",
  );

  const lastColumn = original.columns.at(-1);
  await mobile
    .getByLabel("Choose bucket", { exact: true })
    .selectOption(lastColumn.id);
  await expect
    .poll(() =>
      mobile.evaluate((id) => {
        const column = document
          .querySelector(`[data-bucket-id="${id}"]`)
          .getBoundingClientRect();
        const board = document
          .querySelector(".kanban-board")
          .getBoundingClientRect();
        return column.left < board.right && column.right > board.left;
      }, lastColumn.id),
    )
    .toBe(true);
  await expect(mobile.getByLabel("Choose bucket", { exact: true })).toHaveValue(
    lastColumn.id,
  );
  await mobile.screenshot({
    path: "artifacts/mobile-bucket-navigation.png",
    fullPage: true,
  });
  await mobile
    .locator(`[data-bucket-id="${lastColumn.id}"] .card-edit`)
    .first()
    .tap();
  await expect(mobile.locator("dialog.task-dialog")).toBeVisible();
  const size = await mobile.locator("dialog").boundingBox();
  assert.equal(Math.round(size.width), 390);
  assert.equal(Math.round(size.height), 844);
  assert.equal(Math.round(size.x), 0);
  assert.equal(Math.round(size.y), 0);
  assert.equal(
    await mobile
      .getByLabel("Title", { exact: true })
      .evaluate((input) => getComputedStyle(input).fontSize),
    "16px",
  );
  const status = mobile.getByLabel("Status", { exact: true });
  await status.selectOption(original.columns[2].id);
  await expect(
    mobile.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await mobile.screenshot({
    path: "artifacts/mobile-fullscreen-task.png",
    fullPage: false,
  });
  await close(mobile);
  await mobile.getByRole("button", { name: "Open menu", exact: true }).tap();
  await mobile
    .getByRole("button", { name: "Profile settings", exact: true })
    .tap();
  await expect(
    mobile.getByRole("radio", { name: "Forest green", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await mobile.screenshot({
    path: "artifacts/mobile-theme-profile.png",
    fullPage: false,
  });
  await close(mobile);
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Touch bucket selection, full-screen task dialog, readable inputs, status changes and mobile theme profile without overflow",
  );
} catch (error) {
  await page
    .screenshot({ path: "artifacts/enhancements-failure.png", fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  await fs.rm("artifacts/enhancement-browser-uploads", {
    recursive: true,
    force: true,
  });
}
