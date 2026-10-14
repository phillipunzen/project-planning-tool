import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.UPLOAD_DIR = "artifacts/enhancement-test-uploads";
const { app } = await import("../server/index.js");
const { db, User, Board, Card, Setting, initializeDatabase } =
  await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`,
  origin = new URL(process.env.APP_URL).origin;
function client() {
  let cookie = "";
  return {
    async call(url, method = "GET", body) {
      const response = await fetch(base + "/api" + url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      return { status: response.status, data: await response.json() };
    },
  };
}
const admin = client(),
  editor = client(),
  viewer = client(),
  outsider = client(),
  anonymous = client();
let project, board, editorUser, viewerUser, candidate, disabled, template;
const content = {
  name: "Release",
  title: "Neue Veröffentlichung",
  description: "Version prüfen\nFreigabe dokumentieren",
  priority: "high",
  labels: ["Release", "Qualität"],
  checklist: ["Tests prüfen", "Freigabe einholen"],
};
try {
  await test("mobile collaboration features with real MariaDB", async (t) => {
    await t.test("prepare roles and templates", async () => {
      assert.equal(
        (
          await admin.call("/setup", "POST", {
            name: "Admin",
            email: "admin@features.test",
            password: "FeaturePassword123!",
            sample: true,
          })
        ).status,
        201,
      );
      project = (await admin.call("/projects")).data[0];
      board = (await admin.call(`/boards/${project.Boards[0].id}`)).data;
      const create = async (name, email) =>
        (
          await admin.call("/admin/users", "POST", {
            name,
            email,
            password: "FeaturePassword123!",
            role: "user",
          })
        ).data;
      editorUser = await create("Editor", "editor@features.test");
      viewerUser = await create("Viewer", "viewer@features.test");
      candidate = await create("Jamie Beispiel", "jamie@features.test");
      disabled = await create("Jamie Disabled", "disabled@features.test");
      await admin.call(`/admin/users/${disabled.id}`, "PATCH", {
        disabled: true,
      });
      for (const [actor, user, role] of [
        [editor, editorUser, "editor"],
        [viewer, viewerUser, "viewer"],
      ]) {
        assert.equal(
          (
            await actor.call("/auth/login", "POST", {
              email: user.email,
              password: "FeaturePassword123!",
            })
          ).status,
          200,
        );
        const invitation = await admin.call(
          `/projects/${project.id}/invitations`,
          "POST",
          { userId: user.id, role },
        );
        assert.equal(
          (
            await actor.call(
              `/invitations/${invitation.data.id}/accept`,
              "POST",
              {},
            )
          ).status,
          200,
        );
      }
      assert.equal(
        (
          await outsider.call("/auth/login", "POST", {
            email: candidate.email,
            password: "FeaturePassword123!",
          })
        ).status,
        200,
      );
    });
    await t.test(
      "additive migration preserves users, cards and board settings",
      async () => {
        const cards = (await Card.findAll({ order: [["id", "ASC"]] })).map(
          (entry) => entry.toJSON(),
        );
        const oldBoard = await Board.findByPk(board.id);
        assert.equal(db.getDatabaseName(), "projektwerk_test");
        await db.query("ALTER TABLE `Users` DROP COLUMN `theme`");
        for (const column of [
          "templates",
          "defaultTemplateId",
          "templateRevision",
        ])
          await db.query(
            `ALTER TABLE ` + "`Boards`" + ` DROP COLUMN ` + "`" + column + "`",
          );
        await initializeDatabase();
        assert.deepEqual(
          (await Card.findAll({ order: [["id", "ASC"]] })).map((entry) =>
            entry.toJSON(),
          ),
          cards,
        );
        const current = await Board.findByPk(board.id);
        assert.deepEqual(current.columns, oldBoard.columns);
        assert.deepEqual(current.templates, []);
        assert.equal(current.defaultTemplateId, null);
        assert.equal(current.templateRevision, 0);
        assert.equal((await User.findByPk(candidate.id)).theme, "indigo");
        assert.equal((await admin.call("/me")).status, 200);
      },
    );
    await t.test(
      "colour preferences persist per user and reject unknown themes and privilege changes",
      async () => {
        for (const theme of ["indigo", "ocean", "forest", "sunset", "rose"]) {
          const saved = await editor.call("/me", "PATCH", { theme });
          assert.equal(saved.status, 200);
          assert.equal(saved.data.theme, theme);
        }
        assert.equal(
          (
            await editor.call("/me", "PATCH", {
              language: "en",
              theme: "ocean",
            })
          ).status,
          200,
        );
        const secondDevice = client();
        assert.equal(
          (
            await secondDevice.call("/auth/login", "POST", {
              email: editorUser.email,
              password: "FeaturePassword123!",
            })
          ).data.theme,
          "ocean",
        );
        assert.equal((await viewer.call("/me")).data.theme, "indigo");
        for (const input of [
          {},
          { theme: "missing" },
          { theme: null },
          { theme: "rose", role: "admin" },
        ])
          assert.equal((await editor.call("/me", "PATCH", input)).status, 400);
        assert.equal(
          (await anonymous.call("/me", "PATCH", { theme: "rose" })).status,
          401,
        );
        assert.equal((await editor.call("/me")).data.role, "user");
      },
    );
    await t.test(
      "owner searches names/emails while members, disabled users and secrets stay excluded",
      async () => {
        const search = `/projects/${project.id}/invite-candidates?q=`;
        const found = await admin.call(search + "jAmIe");
        assert.equal(found.status, 200);
        assert.deepEqual(
          found.data.map((entry) => entry.id),
          [candidate.id],
        );
        assert.deepEqual(Object.keys(found.data[0]).sort(), [
          "color",
          "email",
          "id",
          "name",
        ]);
        assert.equal(
          (await admin.call(search + encodeURIComponent(candidate.email)))
            .data[0].id,
          candidate.id,
        );
        assert.deepEqual((await admin.call(search + "Editor")).data, []);
        for (const actor of [editor, viewer, outsider])
          assert.equal((await actor.call(search + "Jamie")).status, 403);
        assert.equal((await anonymous.call(search + "Jamie")).status, 401);
        for (const query of ["x", "", "x".repeat(101)])
          assert.equal((await admin.call(search + query)).status, 400);
        const literal = await User.create({
          name: "A_% Literal",
          email: "literal@features.test",
        });
        assert.deepEqual(
          (await admin.call(search + encodeURIComponent("A_%"))).data.map(
            (entry) => entry.id,
          ),
          [literal.id],
        );
        assert.deepEqual(
          (await admin.call(search + encodeURIComponent("%%"))).data,
          [],
        );
        for (let index = 0; index < 22; index++)
          await User.create({
            name: `Limit Person ${index}`,
            email: `limit${index}@features.test`,
          });
        assert.equal((await admin.call(search + "Limit")).data.length, 20);
        const ownProject = (
          await editor.call("/projects", "POST", {
            name: "Non-admin ownership",
          })
        ).data;
        assert.equal(
          (
            await editor.call(
              `/projects/${ownProject.id}/invite-candidates?q=Jamie`,
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "shared templates enforce board access and write permissions",
      async () => {
        const url = `/boards/${board.id}/templates`;
        for (const actor of [viewer, outsider])
          assert.equal(
            (
              await actor.call(url, "POST", {
                ...content,
                revision: 0,
                setAsDefault: true,
              })
            ).status,
            403,
          );
        assert.equal((await viewer.call(url)).status, 200);
        assert.equal((await outsider.call(url)).status, 403);
        const created = await editor.call(url, "POST", {
          ...content,
          revision: 0,
          setAsDefault: true,
        });
        assert.equal(created.status, 201);
        assert.equal(created.data.revision, 1);
        template = created.data.templates[0];
        assert.equal(created.data.defaultTemplateId, template.id);
        assert.equal(
          (await viewer.call(`/boards/${board.id}`)).data.defaultTemplateId,
          template.id,
        );
        assert.deepEqual(
          (await viewer.call(url)).data.templates[0].checklist,
          content.checklist,
        );
      },
    );
    await t.test(
      "default and explicit templates create independent tasks; blank choice and explicit fields override defaults",
      async () => {
        const url = `/boards/${board.id}/cards`,
          columnId = board.columns[1].id;
        const first = await editor.call(url, "POST", { columnId });
        const second = await editor.call(url, "POST", {
          columnId,
          title: "Eigener Titel",
          description: "",
          priority: "low",
        });
        assert.equal(first.status, 201);
        assert.equal(second.status, 201);
        assert.equal(first.data.title, content.title);
        assert.equal(first.data.description, content.description);
        assert.equal(first.data.priority, "high");
        assert.equal(first.data.progress, 0);
        assert.equal(first.data.assigneeId, null);
        assert.equal(first.data.dueDate, null);
        assert.equal(second.data.title, "Eigener Titel");
        assert.equal(second.data.description, "");
        assert.equal(second.data.priority, "low");
        assert.deepEqual(first.data.labels, content.labels);
        assert.equal(first.data.columnId, columnId);
        assert.ok(first.data.checklist.every((entry) => !entry.done));
        assert.ok(
          first.data.checklist.every(
            (entry) =>
              !second.data.checklist.some((other) => other.id === entry.id),
          ),
        );
        assert.deepEqual(
          (await Board.findByPk(board.id)).templates[0].checklist,
          content.checklist,
        );
        const blank = await editor.call(url, "POST", {
          title: "Blank",
          columnId,
          templateId: null,
        });
        assert.equal(blank.status, 201);
        assert.equal(blank.data.description, "");
        assert.deepEqual(blank.data.checklist, []);
        assert.equal(
          (
            await editor.call(url, "POST", {
              title: "Bad",
              columnId,
              templateId: randomUUID(),
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await viewer.call(url, "POST", {
              columnId,
              templateId: template.id,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await editor.call(url, "POST", {
              columnId,
              templateId: template.id,
            })
          ).status,
          201,
        );
      },
    );
    await t.test(
      "template revision ignores card updates but rejects simultaneous template overwrites",
      async () => {
        const url = `/boards/${board.id}/templates/${template.id}`;
        const saved = await admin.call(url, "PATCH", {
          ...content,
          title: "Aktualisierte Vorlage",
          revision: 1,
          setAsDefault: true,
        });
        assert.equal(saved.status, 200);
        assert.equal(saved.data.revision, 2);
        assert.equal(
          (
            await editor.call(url, "PATCH", {
              ...content,
              title: "Staler Entwurf",
              revision: 1,
              setAsDefault: true,
            })
          ).status,
          409,
        );
        assert.equal(
          (await Board.findByPk(board.id)).templates[0].title,
          "Aktualisierte Vorlage",
        );
        const current = (await admin.call(`/boards/${board.id}`)).data;
        assert.equal(
          (
            await admin.call(`/boards/${board.id}`, "PATCH", {
              name: "Renamed",
              revision: current.revision,
            })
          ).status,
          200,
        );
        const unchangedDefault = await admin.call(url, "PATCH", {
          ...content,
          revision: 2,
        });
        assert.equal(unchangedDefault.status, 200);
        assert.equal(unchangedDefault.data.defaultTemplateId, template.id);
        const otherBoard = (
          await admin.call(`/projects/${project.id}/boards`, "POST", {
            name: "Other",
          })
        ).data;
        assert.equal(
          (
            await admin.call(
              `/boards/${otherBoard.id}/default-template`,
              "PUT",
              { templateId: template.id, revision: 0 },
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      "invalid, oversized and unexpected template content causes no mutation",
      async () => {
        const url = `/boards/${board.id}/templates`,
          before = (await admin.call(url)).data;
        for (const fields of [
          { name: " " },
          { title: "x".repeat(201) },
          { description: "x".repeat(20001) },
          { checklist: [""] },
          { checklist: Array(51).fill("Too many") },
          { labels: Array(9).fill("Too many") },
          { id: randomUUID() },
          { priority: "bad" },
        ]) {
          assert.equal(
            (
              await admin.call(url, "POST", {
                ...content,
                ...fields,
                revision: before.revision,
              })
            ).status,
            400,
          );
        }
        assert.deepEqual((await admin.call(url)).data, before);
        for (let index = 1; index < 20; index++) {
          const current = (await admin.call(url)).data;
          assert.equal(
            (
              await admin.call(url, "POST", {
                name: `Template ${index}`,
                revision: current.revision,
              })
            ).status,
            201,
          );
        }
        const full = (await admin.call(url)).data;
        assert.equal(
          (
            await admin.call(url, "POST", {
              name: "Overflow",
              revision: full.revision,
            })
          ).status,
          400,
        );
        assert.equal(full.templates.length, 20);
      },
    );
    await t.test(
      "deleting defaults clears selection and preserves existing task copies",
      async () => {
        const before = (
          await Card.findAll({
            where: { BoardId: board.id },
            order: [["id", "ASC"]],
          })
        ).map((entry) => entry.toJSON());
        const current = (await admin.call(`/boards/${board.id}/templates`))
          .data;
        assert.equal(current.defaultTemplateId, template.id);
        const deleted = await admin.call(
          `/boards/${board.id}/templates/${template.id}`,
          "DELETE",
          { revision: current.revision },
        );
        assert.equal(deleted.status, 200);
        assert.equal(deleted.data.defaultTemplateId, null);
        assert.equal(deleted.data.templates.length, 19);
        assert.deepEqual(
          (
            await Card.findAll({
              where: { BoardId: board.id },
              order: [["id", "ASC"]],
            })
          ).map((entry) => entry.toJSON()),
          before.map((entry) => ({
            ...entry,
            templateId:
              entry.templateId === template.id ? null : entry.templateId,
          })),
        );
        const cleared = await admin.call(
          `/boards/${board.id}/default-template`,
          "PUT",
          { templateId: null, revision: deleted.data.revision },
        );
        assert.equal(cleared.status, 200);
        assert.equal(
          (await admin.call(`/projects/${project.id}`, "DELETE")).status,
          200,
        );
        assert.equal(await Board.findByPk(board.id), null);
      },
    );
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  await fs.rm("artifacts/enhancement-test-uploads", {
    recursive: true,
    force: true,
  });
}
