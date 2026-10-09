import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { createServer, request } from "node:http";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.APP_URL = "http://127.0.0.1:8121";
process.env.ALLOWED_ORIGINS = "http://localhost:8122";
process.env.UPLOAD_DIR = "artifacts/browser-uploads";
const { app } = await import("../server/index.js");
const { db, Setting } = await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(8121, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
// Reproduce the desktop preview: a separate browser origin and rewritten Host.
const proxy = createServer((req, res) => {
  const upstream = request(new URL(req.url, process.env.APP_URL), {
    method: req.method,
    headers: {...req.headers, host:"127.0.0.1:8121", "x-forwarded-host":req.headers.host},
  }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("Preview proxy failed");
  });
  req.pipe(upstream);
});
proxy.listen(8122);
await new Promise(r => proxy.once("listening", r));
await fs.mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.on("pageerror", (e) => errors.push(e.message));
const base = "http://localhost:8122";
try {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Lass uns loslegen." }),
  ).toBeVisible();
  await page.getByLabel("Dein Name").fill("Alex Beispiel");
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("alex@test.example");
  await page
    .getByLabel("Passwort", { exact: true })
    .fill("BrowserPassword123!");
  await page.getByRole("button", { name: "Arbeitsbereich erstellen" }).click();
  await expect(
    page.getByRole("heading", { name: "Unser erstes Projekt", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".task-card")).toHaveCount(6);
  await page.screenshot({
    path: "artifacts/board-desktop.png",
    fullPage: true,
  });
  console.log(
    "PASS: Registrierung über weitergeleitete Vorschauadresse und Beispielboard",
  );
  // Drag between columns with the desktop mouse.
  const firstCard = page.locator(".task-card").filter({
    has: page.getByRole("button", {
      name: "Projektziele festlegen",
      exact: true,
    }),
  });
  const drag = await firstCard.locator(".drag-handle").boundingBox();
  const target = await page.locator(".kanban-column").nth(3).boundingBox();
  await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2);
  await page.mouse.down();
  await page.mouse.move(drag.x + 30, drag.y + 20, { steps: 5 });
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height - 45,
    { steps: 25 },
  );
  await page.mouse.up();
  await expect(
    page
      .locator(".kanban-column")
      .nth(3)
      .getByRole("button", { name: "Projektziele festlegen", exact: true }),
  ).toBeVisible();
  console.log("PASS: Karte per Maus verschoben");
  await page
    .getByRole("button", { name: "Aufgabe erstellen", exact: true })
    .click();
  await page
    .getByLabel("Titel", { exact: true })
    .fill("UI-Test mit Checkliste");
  await page
    .getByLabel("Beschreibung", { exact: true })
    .fill("Eine gemeinsame Aufgabe mit Anhängen.");
  await page.getByLabel("Priorität", { exact: true }).selectOption("urgent");
  await page
    .getByRole("group", { name: "Fortschritt" })
    .getByRole("button", { name: "25 %", exact: true })
    .click();
  await page
    .getByLabel("Verantwortlich", { exact: true })
    .selectOption({ label: "Alex Beispiel" });
  await page.getByLabel("Fällig am").fill("2026-11-03");
  await page.getByLabel("Labels").fill("Test, Planung");
  await page.getByLabel("Neuer Checklistenpunkt").fill("Erster Schritt");
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await page.getByLabel("Neuer Checklistenpunkt").fill("Zweiter Schritt");
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await page.getByRole("checkbox", { name: "Erster Schritt" }).check();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Aufgabe erstellen", exact: true })
    .click();
  await expect(page.locator("dialog")).toHaveCount(0);
  const progressCard = page.locator(".task-card").filter({
    has: page.getByRole("button", {
      name: "UI-Test mit Checkliste",
      exact: true,
    }),
  });
  await expect(progressCard.getByRole("progressbar")).toHaveAttribute(
    "value",
    "25",
  );
  await page
    .getByRole("button", { name: "UI-Test mit Checkliste", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Erster Schritt" }),
  ).toBeChecked();
  await expect(page.getByLabel("Priorität", { exact: true })).toHaveValue(
    "urgent",
  );
  const progressButtons = page.getByRole("group", { name: "Fortschritt" });
  await expect(
    progressButtons.getByRole("button", { name: "25 %", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await progressButtons
    .getByRole("button", { name: "75 %", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Alle Änderungen gespeichert" }),
  ).toBeVisible();
  await expect(page.locator("dialog")).toHaveCount(1);
  await page
    .locator("dialog .modal-heading")
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.reload();
  await expect(progressCard.getByRole("progressbar")).toHaveAttribute(
    "value",
    "75",
  );
  await page
    .getByRole("button", { name: "UI-Test mit Checkliste", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Fortschritt" })
      .getByRole("button", { name: "75 %", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const updates = [];
  const trackUpdates = (request) => {
    if (request.method() === "PATCH" && request.url().includes("/api/cards/"))
      updates.push(request.postDataJSON());
  };
  page.on("request", trackUpdates);
  const description = page.getByLabel("Beschreibung", { exact: true });
  await description.fill("Zwischenstand");
  await page.waitForTimeout(300);
  assertNoEarlyTextSave: {
    if (updates.some((body) => "description" in body))
      throw new Error("Text was saved during typing");
  }
  await description.fill("Fertige Beschreibung");
  await expect(
    page.getByRole("status").filter({ hasText: "Alle Änderungen gespeichert" }),
  ).toBeVisible();
  if (updates.filter((body) => "description" in body).length !== 1)
    throw new Error("Text debounce did not coalesce changes");
  await description.fill("Beim Schließen speichern");
  await page
    .locator("dialog .modal-heading")
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
  await expect(page.locator("dialog")).toHaveCount(0);
  page.off("request", trackUpdates);
  await page
    .getByRole("button", { name: "UI-Test mit Checkliste", exact: true })
    .click();
  await expect(description).toHaveValue("Beim Schließen speichern");
  // A failed request keeps the draft in the dialog and offers an explicit retry.
  await page.route("**/api/cards/*", async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Test: Speichern fehlgeschlagen" }),
      });
    else await route.continue();
  });
  await page
    .getByRole("group", { name: "Fortschritt" })
    .getByRole("button", { name: "50 %", exact: true })
    .click();
  await expect(
    page.getByText("Test: Speichern fehlgeschlagen", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Fortschritt" })
    .getByRole("button", { name: "75 %", exact: true })
    .click();
  await page.unroute("**/api/cards/*");
  await page
    .getByRole("button", { name: "Erneut versuchen", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Alle Änderungen gespeichert" }),
  ).toBeVisible();
  console.log(
    "PASS: Automatisches Speichern, Textpause, Schließen und Wiederholung nach Fehler",
  );
  await page.getByRole("button", { name: /Anhänge/ }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "projektplan.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Gemeinsamer Plan"),
  });
  await expect(
    page.getByRole("link", { name: "projektplan.txt" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Kommentare/ }).click();
  await page
    .getByLabel("Kommentar", { exact: true })
    .fill("Status: bereit zur Prüfung.");
  await page.getByRole("button", { name: "Kommentar senden" }).click();
  await expect(
    page.getByText("Status: bereit zur Prüfung.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  console.log("PASS: Aufgabe, Priorität, Checkliste, Datei und Kommentar");
  const keyboardHandle = page.getByRole("button", {
    name: "Aufgabe Ideen & Anforderungen sammeln verschieben",
    exact: true,
  });
  await keyboardHandle.focus();
  await keyboardHandle.press("Space");
  await page.waitForTimeout(100);
  await keyboardHandle.press("ArrowDown");
  await page.waitForTimeout(100);
  await keyboardHandle.press("Space");
  await expect(
    page.locator(".kanban-column").first().locator(".card-title").first(),
  ).toHaveText("UI-Test mit Checkliste");
  console.log("PASS: Tastatur-Drag");
  await page.getByRole("button", { name: "Einladen", exact: true }).click();
  await page
    .locator("dialog")
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("team@test.example");
  await page.getByRole("button", { name: "Einladungslink erstellen" }).click();
  const inviteUrl = await page
    .getByLabel("Einladungslink", { exact: true })
    .inputValue();
  await page
    .getByRole("button", { name: "Schließen", exact: true })
    .first()
    .click();
  const other = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  other.on("pageerror", (e) => errors.push(e.message));
  await other.goto(inviteUrl);
  await other.getByLabel("Dein Name").fill("Kim Team");
  await other.getByLabel("Neues Passwort").fill("TeamPassword123!");
  await other
    .getByRole("button", { name: "Konto erstellen & beitreten" })
    .click();
  await expect(
    other.getByRole("heading", { name: "Unser erstes Projekt", exact: true }),
  ).toBeVisible();
  await expect(other.locator(".task-card")).toHaveCount(7);
  await other
    .getByRole("button", { name: "UI-Test mit Checkliste", exact: true })
    .click();
  await expect(
    other.getByRole("checkbox", { name: "Erster Schritt" }),
  ).toBeChecked();
  await expect(
    other
      .getByRole("group", { name: "Fortschritt" })
      .getByRole("button", { name: "75 %", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await other.getByRole("button", { name: /Kommentare/ }).click();
  await expect(
    other.getByText("Status: bereit zur Prüfung.", { exact: true }),
  ).toBeVisible();
  await other.close();
  console.log("PASS: Einladung und gemeinsame Daten für zweiten Benutzer");
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  await expect(page.locator(".task-table tbody tr")).toHaveCount(7);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "UI-Test mit Checkliste" })
      .getByRole("cell", { name: "75 %", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Aktivität", exact: true }).click();
  await expect(
    page.getByText("datei angehängt", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByLabel("Aufgaben suchen").fill("UI-Test");
  await expect(page.locator(".task-card")).toHaveCount(1);
  await page.getByLabel("Aufgaben suchen").fill("");
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page.getByText("OpenID Connect", { exact: true }).click();
  await expect(page.getByLabel("Issuer-URL")).toBeVisible();
  await page.getByText("Active Directory", { exact: true }).click();
  await expect(page.getByLabel("LDAP-Server")).toBeVisible();
  await page.getByRole("button", { name: /Benutzer/ }).click();
  await expect(page.locator(".users-table tbody tr")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Unser erstes Projekt", exact: true })
    .click();
  console.log("PASS: Listenansicht, Verlauf, Suche und Administration");
  // Device sizes; touch scrolling and touch drag on actual emulated touch hardware.
  const state = await page.context().storageState();
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    storageState: state,
  });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto(base);
  await expect(mobile.locator(".task-card")).toHaveCount(7);
  await expect(
    mobile.getByRole("button", { name: "Menü öffnen" }),
  ).toBeVisible();
  await mobile.getByRole("button", { name: "Menü öffnen" }).click();
  await expect(mobile.locator(".sidebar.open")).toBeVisible();
  await mobile
    .locator(".sidebar")
    .getByRole("button", { name: "Menü schließen", exact: true })
    .click();
  await expect
    .poll(() =>
      mobile
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  assertNoOverflow: {
    const width = await mobile.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      window: innerWidth,
    }));
    if (width.doc > width.window + 1)
      throw new Error(`Mobile overflow: ${JSON.stringify(width)}`);
  }
  await mobile.screenshot({
    path: "artifacts/board-mobile.png",
    fullPage: true,
  });
  const handle = mobile
    .locator(".kanban-column")
    .first()
    .locator(".drag-handle")
    .first();
  const from = await handle.boundingBox();
  const firstColumn = mobile.locator(".kanban-column").first(),
    secondColumn = mobile.locator(".kanban-column").nth(1);
  const cardTitle = await firstColumn
    .locator(".card-title")
    .first()
    .textContent();
  const to = await secondColumn.boundingBox();
  const cdp = await mobileContext.newCDPSession(mobile);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }],
  });
  await mobile.waitForTimeout(240);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: from.x + from.width / 2 + 20, y: from.y + from.height / 2 + 10 },
    ],
  });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x:
            from.x +
            from.width / 2 +
            ((Math.min(370, to.x + 35) - (from.x + from.width / 2)) * i) / 12,
          y: Math.min(to.y + to.height - 40, 750),
        },
      ],
    });
    await mobile.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    secondColumn.getByRole("button", { name: cardTitle, exact: true }),
  ).toBeVisible();
  console.log("PASS: Touch-Drag, mobile Navigation und kein Seitenüberlauf");
  await mobile
    .getByRole("button", { name: "Aufgabe erstellen", exact: true })
    .click();
  await expect(mobile.getByLabel("Titel", { exact: true })).toBeVisible();
  await mobile
    .locator("dialog .modal-heading")
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
  await mobile
    .locator(".kanban-column")
    .getByRole("button", { name: "UI-Test mit Checkliste", exact: true })
    .click();
  await expect(
    mobile
      .getByRole("group", { name: "Fortschritt" })
      .getByRole("button", { name: "75 %", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await mobile
    .getByRole("group", { name: "Fortschritt" })
    .getByRole("button", { name: "100 %", exact: true })
    .tap();
  await mobile.screenshot({
    path: "artifacts/card-progress-mobile.png",
    fullPage: true,
  });
  await expect(
    mobile
      .getByRole("status")
      .filter({ hasText: "Alle Änderungen gespeichert" }),
  ).toBeVisible();
  await mobile
    .locator("dialog .modal-heading")
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
  await expect(mobile.locator("dialog")).toHaveCount(0);
  await mobile
    .locator(".kanban-column")
    .getByRole("button", { name: "UI-Test mit Checkliste", exact: true })
    .click();
  await expect(
    mobile
      .getByRole("group", { name: "Fortschritt" })
      .getByRole("button", { name: "100 %", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await mobile
    .locator("dialog .modal-heading")
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
  console.log(
    "PASS: Prozentfortschritt gespeichert, geteilt und auf Desktop und Handy bearbeitet",
  );
  // Bucket editing must work with touch and keep completion independent of order.
  const doneSummary = await mobile
    .getByText(/von 7 Aufgaben erledigt/)
    .textContent();
  await mobile
    .getByRole("button", { name: "Buckets bearbeiten", exact: true })
    .tap();
  await expect(
    mobile.getByRole("heading", { name: "Board & Buckets", exact: true }),
  ).toBeVisible();
  await mobile
    .getByRole("button", { name: "Bucket hinzufügen", exact: true })
    .tap();
  await mobile.getByLabel("Bucket 5", { exact: true }).fill("Kundenfreigabe");
  await mobile
    .getByLabel("Farbe für Kundenfreigabe", { exact: true })
    .fill("#abcdef");
  await expect(
    mobile.getByLabel("Aufgaben in Kundenfreigabe gelten als erledigt"),
  ).not.toBeChecked();
  await expect(
    mobile.getByRole("button", { name: "In Arbeit entfernen", exact: true }),
  ).toBeDisabled();
  await mobile
    .getByRole("button", { name: "Erledigt nach oben", exact: true })
    .tap();
  await mobile
    .getByRole("button", { name: "Erledigt nach oben", exact: true })
    .tap();
  await mobile
    .getByRole("button", { name: "Erledigt nach oben", exact: true })
    .tap();
  await mobile
    .getByRole("button", { name: "Kundenfreigabe nach oben", exact: true })
    .tap();
  await mobile
    .getByRole("button", { name: "Kundenfreigabe nach unten", exact: true })
    .tap();
  await mobile.getByLabel("Bucket 2", { exact: true }).fill("Ideen & Planung");
  const modalOverflow = await mobile
    .locator("dialog")
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  if (modalOverflow) throw new Error("Bucket editor overflows on mobile");
  await mobile.screenshot({
    path: "artifacts/buckets-mobile.png",
    fullPage: true,
  });
  await mobile.getByRole("button", { name: "Speichern", exact: true }).tap();
  await expect(mobile.locator("dialog")).toHaveCount(0);
  await expect(mobile.locator(".kanban-column")).toHaveCount(5);
  await expect(
    mobile
      .locator(".kanban-column")
      .first()
      .getByRole("heading", { name: "Erledigt", exact: true }),
  ).toBeVisible();
  await expect(mobile.getByText(doneSummary, { exact: true })).toBeVisible();
  await expect(mobile.locator(".task-card")).toHaveCount(7);
  await mobile.reload();
  await expect(mobile.locator(".kanban-column")).toHaveCount(5);
  await mobile
    .getByRole("button", { name: "Buckets bearbeiten", exact: true })
    .tap();
  await expect(mobile.getByLabel("Bucket 2", { exact: true })).toHaveValue(
    "Ideen & Planung",
  );
  await expect(
    mobile.getByLabel("Farbe für Kundenfreigabe", { exact: true }),
  ).toHaveValue("#abcdef");
  await expect(
    mobile.getByLabel("Aufgaben in Erledigt gelten als erledigt"),
  ).toBeChecked();
  await mobile
    .getByRole("button", { name: "Kundenfreigabe entfernen", exact: true })
    .tap();
  await mobile.getByRole("button", { name: "Speichern", exact: true }).tap();
  await expect(mobile.locator("dialog")).toHaveCount(0);
  await expect(mobile.locator(".kanban-column")).toHaveCount(4);
  console.log(
    "PASS: Frei benannte Buckets, Farben, Reihenfolge, Erledigt-Zuordnung und Entfernen auf dem Handy",
  );
  await mobile.setViewportSize({ width: 768, height: 1024 });
  await mobile.screenshot({
    path: "artifacts/board-tablet.png",
    fullPage: true,
  });
  await mobileContext.close();
  await page.reload();
  await page.getByRole("button", { name: "Buckets bearbeiten", exact: true }).click();
  await page.getByLabel("Bucket 2", { exact: true }).fill("Lokaler Entwurf");
  const concurrentStatus = await page.evaluate(async () => {
    const projects = await fetch("/api/projects").then(r => r.json());
    const id = projects.find(p => p.name === "Unser erstes Projekt").Boards[0].id;
    const board = await fetch(`/api/boards/${id}`).then(r => r.json());
    const response = await fetch(`/api/boards/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: board.revision, name: "Teamboard" }),
    });
    return response.status;
  });
  if (concurrentStatus !== 200) throw new Error("Concurrent bucket edit failed");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByText(/Das Board wurde inzwischen geändert/)).toBeVisible();
  await expect(page.getByLabel("Bucket 2", { exact: true })).toHaveValue("Lokaler Entwurf");
  await expect(page.getByRole("button", { name: "Speichern", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Aktuellen Stand laden", exact: true }).click();
  await expect(page.getByLabel("Bucket 2", { exact: true })).toHaveValue("Ideen & Planung");
  await expect(page.getByLabel("Boardname", { exact: true })).toHaveValue("Teamboard");
  await page.getByLabel("Aufgaben in Erledigt gelten als erledigt").uncheck();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.getByText("0 von 7 Aufgaben erledigt", { exact: true })).toBeVisible();
  console.log("PASS: Bucket-Konflikte behalten den Entwurf und erlauben bewusstes Neuladen");
  if (errors.length)
    throw new Error(`Browser runtime errors: ${errors.join("; ")}`);
  console.log("PASS: Desktop, Handy und Tablet ohne Browser-Laufzeitfehler");
} catch (error) {
  console.log(
    "Browser failure state:",
    await page.evaluate(() => ({
      dialogs: document.querySelectorAll("dialog").length,
      labels: [...document.querySelectorAll("dialog label")].map(
        (l) => l.textContent,
      ),
      errors: [...document.querySelectorAll(".form-error")].map(
        (e) => e.textContent,
      ),
    })),
  );
  await page.screenshot({
    path: "artifacts/browser-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => server.close(r));
  await db.close();
  await fs.rm("artifacts/browser-uploads", { recursive: true, force: true });
}
