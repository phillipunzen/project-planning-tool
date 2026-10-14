import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.UPLOAD_DIR = "artifacts/custom-field-test-uploads";
const { app } = await import("../server/index.js");
const { db, Board, Card, Membership, User, Setting, initializeDatabase } =
  await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const origin = new URL(process.env.APP_URL).origin;
function client() {
  let cookie = "";
  return async (path, method = "GET", body) => {
    const result = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (result.headers.get("set-cookie"))
      cookie = result.headers.get("set-cookie").split(";")[0];
    return { status: result.status, data: await result.json() };
  };
}
const call = client();
const dropdown = {
  id: randomUUID(),
  name: "Umgebung",
  type: "dropdown",
  options: [{ id: randomUUID(), label: "Test" }],
};
const textField = {
  id: randomUUID(),
  name: "Referenz",
  type: "text",
  options: [],
};
const numberField = {
  id: randomUUID(),
  name: "Aufwand",
  type: "number",
  options: [],
};
const dateField = {
  id: randomUUID(),
  name: "Abnahme",
  type: "date",
  options: [],
};
let board, template, settings, card;
try {
  await test("custom template fields with real MariaDB", async (t) => {
    await t.test("additive migration preserves existing tasks", async () => {
      assert.equal(
        (
          await call("/setup", "POST", {
            name: "Admin",
            email: "admin@fields.test",
            password: "FieldPassword123!",
            sample: true,
          })
        ).status,
        201,
      );
      const project = (await call("/projects")).data[0];
      board = (await call(`/boards/${project.Boards[0].id}`)).data;
      const before = await db.query(
        "SELECT id,title,description,version,updatedAt FROM Cards ORDER BY id",
        { type: "SELECT" },
      );
      assert.equal(db.config.database, "projektwerk_test");
      for (const field of [
        "templateId",
        "customValues",
        "customFieldDefinitions",
      ])
        await db.query(`ALTER TABLE Cards DROP COLUMN \`${field}\``);
      await initializeDatabase();
      const after = await db.query(
        "SELECT id,title,description,version,updatedAt FROM Cards ORDER BY id",
        { type: "SELECT" },
      );
      assert.deepEqual(after, before);
      for (const row of await Card.findAll()) {
        assert.equal(row.templateId, null);
        assert.deepEqual(row.customValues, {});
        assert.deepEqual(row.customFieldDefinitions, []);
      }
      await initializeDatabase();
    });
    await t.test(
      "shared default creates linked tasks with independently stored values",
      async () => {
        const result = await call(`/boards/${board.id}/templates`, "POST", {
          name: "Ticket",
          fields: [dropdown, textField, numberField, dateField],
          setAsDefault: true,
          revision: 0,
        });
        assert.equal(result.status, 201);
        settings = result.data;
        template = settings.templates[0];
        const created = await call(`/boards/${board.id}/cards`, "POST", {
          title: "Fehler prüfen",
          columnId: board.columns[0].id,
          customValues: {
            [dropdown.id]: dropdown.options[0].id,
            [textField.id]: "ABC-123",
            [numberField.id]: 2.5,
            [dateField.id]: "2026-10-18",
          },
        });
        assert.equal(created.status, 201);
        card = created.data;
        assert.equal(card.templateId, template.id);
        assert.equal(card.customFieldDefinitions.length, 4);
        const another = (
          await call(`/boards/${board.id}/cards`, "POST", {
            title: "Anderes Ticket",
            columnId: board.columns[0].id,
          })
        ).data;
        assert.deepEqual(another.customValues, {});
      },
    );
    await t.test(
      "new options and labels are live without changing task values or version",
      async () => {
        const before = (await Card.findByPk(card.id)).toJSON();
        dropdown.options[0].label = "Testsystem";
        dropdown.options.push({ id: randomUUID(), label: "Produktion" });
        textField.name = "Ticketnummer";
        const result = await call(
          `/boards/${board.id}/templates/${template.id}`,
          "PATCH",
          {
            name: "Ticket",
            fields: [dropdown, textField, numberField, dateField],
            revision: settings.revision,
          },
        );
        assert.equal(result.status, 200);
        settings = result.data;
        assert.deepEqual((await Card.findByPk(card.id)).toJSON(), before);
        assert.equal(
          (await call(`/boards/${board.id}/templates`)).data.templates[0]
            .fields[0].options[1].label,
          "Produktion",
        );
        const saved = await call(`/cards/${card.id}`, "PATCH", {
          customValues: {
            ...card.customValues,
            [dropdown.id]: dropdown.options[1].id,
          },
          version: card.version,
        });
        assert.equal(saved.status, 200);
        card = (await Card.findByPk(card.id)).toJSON();
        assert.equal(card.customValues[dropdown.id], dropdown.options[1].id);
      },
    );
    await t.test(
      "schema and value validation reject invalid or cross-board values",
      async () => {
        for (const fields of [
          [dropdown, dropdown],
          [{ ...dropdown, options: [] }],
          [
            {
              ...dropdown,
              options: [dropdown.options[0], dropdown.options[0]],
            },
          ],
          [{ ...textField, options: dropdown.options }],
          [{ ...textField, type: "number" }],
        ]) {
          assert.equal(
            (
              await call(
                `/boards/${board.id}/templates/${template.id}`,
                "PATCH",
                { name: "Invalid", fields, revision: settings.revision },
              )
            ).status,
            400,
          );
        }
        for (const values of [
          { [dropdown.id]: "not-an-option" },
          { [randomUUID()]: "unknown" },
          { [numberField.id]: "two" },
          { [dateField.id]: "2026-02-30" },
          { [textField.id]: 3 },
        ]) {
          assert.equal(
            (
              await call(`/cards/${card.id}`, "PATCH", {
                customValues: values,
                version: card.version,
              })
            ).status,
            400,
          );
        }
        assert.equal(
          (
            await call(`/boards/${board.id}/cards`, "POST", {
              title: "Forged",
              columnId: board.columns[0].id,
              templateId: randomUUID(),
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call(`/cards/${card.id}`, "PATCH", {
              templateId: null,
              version: card.version,
            })
          ).status,
          400,
        );
        assert.deepEqual(
          (await Card.findByPk(card.id)).customValues,
          card.customValues,
        );
        const viewer = await User.create({
          name: "Viewer",
          email: "viewer@fields.test",
          password: (await User.findOne()).password,
        });
        await Membership.create({
          UserId: viewer.id,
          ProjectId: board.ProjectId,
          role: "viewer",
        });
        const read = client();
        await read("/auth/login", "POST", {
          email: viewer.email,
          password: "FieldPassword123!",
        });
        assert.equal((await read(`/boards/${board.id}/templates`)).status, 200);
        assert.equal(
          (
            await read(`/cards/${card.id}`, "PATCH", {
              customValues: {},
              version: card.version,
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "removed fields and selected options preserve historical values and allow unrelated edits",
      async () => {
        const changed = await call(
          `/boards/${board.id}/templates/${template.id}`,
          "PATCH",
          {
            name: "Ticket",
            fields: [
              { ...dropdown, options: [dropdown.options[0]] },
              numberField,
              dateField,
            ],
            revision: settings.revision,
          },
        );
        assert.equal(changed.status, 200);
        settings = changed.data;
        assert.equal(
          (
            await call(
              `/boards/${board.id}/templates/${template.id}`,
              "PATCH",
              {
                name: "Invalid reused field",
                fields: [{ ...textField, type: "number" }],
                revision: settings.revision,
              },
            )
          ).status,
          400,
        );
        const saved = await call(`/cards/${card.id}`, "PATCH", {
          title: "Geänderter Titel",
          version: card.version,
        });
        assert.equal(saved.status, 200);
        card = (await Card.findByPk(card.id)).toJSON();
        assert.equal(card.customValues[textField.id], "ABC-123");
        assert.equal(card.customValues[dropdown.id], dropdown.options[1].id);
        assert(
          card.customFieldDefinitions.find((field) => field.id === textField.id)
            .archived,
        );
        assert.equal(
          (
            await call(`/cards/${card.id}`, "PATCH", {
              customValues: { ...card.customValues, [textField.id]: "changed" },
              version: card.version,
            })
          ).status,
          400,
        );
        const retired = await call(`/boards/${board.id}/cards`, "POST", {
          title: "Retired",
          columnId: board.columns[0].id,
          customValues: { [dropdown.id]: dropdown.options[1].id },
        });
        assert.equal(retired.status, 400);
      },
    );
    await t.test(
      "existing blank tasks can attach a template while preserving their content",
      async () => {
        const blank = (
          await call(`/boards/${board.id}/cards`, "POST", {
            templateId: null,
            title: "Original",
            description: "Keep",
            columnId: board.columns[0].id,
          })
        ).data;
        const result = await call(`/cards/${blank.id}`, "PATCH", {
          templateId: template.id,
          version: blank.version,
        });
        assert.equal(result.status, 200);
        const linked = await Card.findByPk(blank.id);
        assert.equal(linked.title, "Original");
        assert.equal(linked.description, "Keep");
        assert.equal(result.data.customFieldDefinitions[0].id, dropdown.id);
      },
    );
    await t.test(
      "deleting a template preserves definitions and values on linked tasks",
      async () => {
        const before = (await Card.findByPk(card.id)).toJSON();
        const deleted = await call(
          `/boards/${board.id}/templates/${template.id}`,
          "DELETE",
          { revision: settings.revision },
        );
        assert.equal(deleted.status, 200);
        const after = (await Card.findByPk(card.id)).toJSON();
        assert.equal(after.templateId, null);
        assert.deepEqual(after.customValues, before.customValues);
        assert.equal(after.version, before.version);
        assert.deepEqual(after.updatedAt, before.updatedAt);
        const edited = await call(`/cards/${card.id}`, "PATCH", {
          progress: 25,
          version: card.version,
        });
        assert.equal(edited.status, 200);
        assert.deepEqual(
          (await Card.findByPk(card.id)).customValues,
          before.customValues,
        );
      },
    );
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
