import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
process.env.NODE_ENV = "test";
process.env.ALLOWED_ORIGINS = "http://localhost:54734";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.UPLOAD_DIR = "artifacts/test-uploads";
const { app } = await import("../server/index.js");
const { db, Setting, Invitation, Card, Board, User, initializeDatabase } =
  await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const origin = new URL(process.env.APP_URL).origin;
function client() {
  let cookie = "";
  return {
    async call(url, method = "GET", body, extra = {}) {
      const r = await fetch(`${base}/api${url}`, {
        method,
        signal: AbortSignal.timeout(15000),
        headers: {
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...extra,
        },
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
        redirect: "manual",
      });
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      const text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: r.status, data, headers: r.headers };
    },
  };
}
const admin = client(),
  viewer = client(),
  editor = client(),
  outsider = client(),
  anonymous = client();
let project, board, card, editorUser, viewerUser;
await test("Projektwerk integration with real MariaDB", async (t) => {
  await t.test(
    "bootstrap is transactional and only one administrator can be created",
    async () => {
      const publicInfo = await anonymous.call("/public");
      assert.equal(publicInfo.data.setupRequired, true);
      assert.equal((await anonymous.call("/setup", "POST", {
        name: "Too Short", email: "short@test.example", password: "123456789", sample: false,
      })).status, 400);
      const results = await Promise.all([
        admin.call("/setup", "POST", {
          name: "Test Admin",
          email: "admin@test.example",
          password: "TestPw123!",
          sample: false,
        }),
        anonymous.call("/setup", "POST", {
          name: "Other Admin",
          email: "other@test.example",
          password: "TestPw123!",
          sample: false,
        }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      if (results[0].status !== 201) {
        await admin.call("/auth/login", "POST", {
          email: "other@test.example",
          password: "TestPw123!",
        });
      }
      assert.equal((await anonymous.call("/public")).data.setupRequired, false);
    },
  );
  await t.test("authentication and origin checks protect writes", async () => {
    assert.equal((await outsider.call("/projects")).status, 401);
    // The explicit preview origin reaches validation; untrusted origins do not.
    assert.equal((await anonymous.call("/setup", "POST", {}, {Origin:"http://localhost:54734"})).status, 400);
    for (const untrusted of ["null", "http://localhost:54735", "http://localhost.evil.example:54734"]) {
      assert.equal((await anonymous.call("/setup", "POST", {}, {Origin:untrusted, "X-Forwarded-Host":"localhost:54734"})).status, 403);
    }
    assert.equal(
      (
        await outsider.call("/auth/login", "POST", {
          email: "unknown@test.example",
          password: "bad",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await admin.call(
          "/projects",
          "POST",
          { name: "Forbidden" },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
  });
  await t.test("profile language migrates additively, persists and cannot alter permissions", async () => {
    const before = (await admin.call("/me")).data;
    await db.query("ALTER TABLE `Users` DROP COLUMN `language`");
    await initializeDatabase();
    const migrated = (await admin.call("/me")).data;
    assert.equal(migrated.id, before.id);
    assert.equal(migrated.name, before.name);
    assert.equal(migrated.language, "system");
    assert.equal((await anonymous.call("/me", "PATCH", { language: "en" })).status, 401);
    for (const invalid of [{ language: "fr" }, {}, { language: "en", role: "admin" }, { language: "en", id: crypto.randomUUID() }]) {
      assert.equal((await admin.call("/me", "PATCH", invalid)).status, 400);
    }
    const saved = await admin.call("/me", "PATCH", { language: "en" });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.language, "en");
    assert.equal(saved.data.password, undefined);
    assert.equal((await User.findByPk(before.id)).language, "en");
    const device = client();
    const identity = await User.findByPk(before.id);
    assert.equal((await device.call("/auth/login", "POST", { email: identity.email, password: "TestPw123!" })).data.language, "en");
    const denied = await device.call(`/boards/${crypto.randomUUID()}`);
    assert.equal(denied.status, 404);
    assert.equal(denied.data.error, "Board not found.");
    assert.equal((await admin.call("/me", "PATCH", { language: "system" })).status, 200);
  });
  await t.test("create project and multiple boards", async () => {
    const created = await admin.call("/projects", "POST", {
      name: "Website Relaunch",
      description: "Gemeinsames Projekt",
      color: "#6366f1",
      icon: "code",
    });
    assert.equal(created.status, 201);
    project = created.data;
    const list = await admin.call("/projects");
    assert.equal(list.data[0].myRole, "owner");
    board = (await admin.call(`/boards/${list.data[0].Boards[0].id}`)).data;
    assert.equal(board.columns.length, 4);
    assert.equal(
      (
        await admin.call(`/projects/${project.id}/boards`, "POST", {
          name: "Release",
        })
      ).status,
      201,
    );
  });
  await t.test("English requests create translated defaults while retaining custom project names", async () => {
    const custom = "Offen – Teamprojekt";
    const result = await admin.call("/projects", "POST", { name: custom }, { "Accept-Language": "en-GB,en;q=0.9" });
    assert.equal(result.status, 201);
    assert.equal(result.data.name, custom);
    const created = (await admin.call("/projects")).data.find(p => p.id === result.data.id);
    const englishBoard = (await admin.call(`/boards/${created.Boards[0].id}`)).data;
    assert.equal(englishBoard.name, "Project board");
    assert.deepEqual(englishBoard.columns.map(c => c.name), ["To do", "In progress", "Review", "Done"]);
    assert.equal((await admin.call(`/projects/${created.id}`, "DELETE")).status, 200);
  });
  await t.test("administrator can provision local accounts", async () => {
    assert.equal((await admin.call("/admin/users", "POST", {
      name: "Too Short", email: "short@test.example", password: "123456789",
    })).status, 400);
    editorUser = (
      await admin.call("/admin/users", "POST", {
        name: "Editor",
        email: "editor@test.example",
        password: "EditorPw1!",
      })
    ).data;
    assert.ok(editorUser.id);
    assert.equal(editorUser.password, undefined);
    assert.equal((await admin.call(`/admin/users/${editorUser.id}`, "PATCH", {password:"123456789"})).status, 400);
    assert.equal((await admin.call(`/admin/users/${editorUser.id}`, "PATCH", {password:"EditorPw1!"})).status, 200);
    await editor.call("/auth/login", "POST", {
      email: "editor@test.example",
      password: "EditorPw1!",
    });
  });
  await t.test(
    "invitations bind membership to the invited email and expire after acceptance",
    async () => {
      const invitation = await admin.call(
        `/projects/${project.id}/invitations`,
        "POST",
        { email: editorUser.email, role: "editor" },
      );
      assert.equal(invitation.status, 201);
      const token = new URL(invitation.data.url).searchParams.get("invite");
      assert.equal(
        (await outsider.call(`/invitations/${token}`)).data.email,
        editorUser.email,
      );
      assert.equal(
        (await admin.call(`/invitations/${token}/accept`, "POST", {})).status,
        403,
      );
      assert.equal(
        (await editor.call(`/invitations/${token}/accept`, "POST", {})).status,
        200,
      );
      assert.equal(
        (await editor.call(`/invitations/${token}/accept`, "POST", {})).status,
        404,
      );
      const r = await admin.call(
        `/projects/${project.id}/invitations`,
        "POST",
        { email: "viewer@test.example", role: "viewer" },
      );
      const viewerToken = new URL(r.data.url).searchParams.get("invite");
      assert.equal((await viewer.call(`/invitations/${viewerToken}/accept`, "POST", {
        name: "Viewer", password: "123456789",
      })).status, 400);
      const accepted = await viewer.call(
        `/invitations/${viewerToken}/accept`,
        "POST",
        { name: "Viewer", password: "ViewerPw1!" },
      );
      assert.equal(accepted.status, 200);
      viewerUser = accepted.data;
      const expired = await admin.call(
        `/projects/${project.id}/invitations`,
        "POST",
        { email: "expired@test.example", role: "editor" },
      );
      const expiredToken = new URL(expired.data.url).searchParams.get("invite");
      await Invitation.update(
        { expiresAt: new Date(Date.now() - 1000) },
        { where: { id: expired.data.id } },
      );
      assert.equal(
        (await outsider.call(`/invitations/${expiredToken}`)).status,
        404,
      );
    },
  );
  await t.test(
    "existing cards receive zero progress without losing data during migration",
    async () => {
      const legacy = await Card.create({
        title: "Bestehende Aufgabe",
        description: "Details bleiben erhalten",
        BoardId: board.id,
        columnId: board.columns[0].id,
        checklist: [
          { id: crypto.randomUUID(), text: "Bestehender Punkt", done: true },
        ],
      });
      // The fixture deliberately recreates the pre-upgrade schema, only in projektwerk_test.
      await db.query("ALTER TABLE `Cards` DROP COLUMN `progress`");
      await initializeDatabase();
      await initializeDatabase();
      const migrated = await Card.findByPk(legacy.id);
      assert.equal(migrated.progress, 0);
      assert.equal(migrated.description, legacy.description);
      assert.deepEqual(migrated.checklist, legacy.checklist);
      await migrated.destroy();
    },
  );
  await t.test(
    "cards persist priority, labels, due dates, checklist and progress",
    async () => {
      const r = await editor.call(`/boards/${board.id}/cards`, "POST", {
        title: "Implementierung",
        description: "Details",
        columnId: board.columns[0].id,
        priority: "high",
        progress: 25,
        dueDate: "2026-11-01",
        assigneeId: editorUser.id,
        labels: ["Entwicklung"],
        checklist: [
          { id: crypto.randomUUID(), text: "API bereitstellen", done: true },
          { id: crypto.randomUUID(), text: "UI prüfen", done: false },
        ],
      });
      assert.equal(r.status, 201);
      card = r.data;
      const loaded = (await viewer.call(`/boards/${board.id}`)).data;
      assert.equal(loaded.cards[0].priority, "high");
      assert.equal(loaded.cards[0].progress, 25);
      assert.equal(loaded.cards[0].checklist.length, 2);
      assert.equal(loaded.cards[0].assignee.name, "Editor");
      board = loaded;
    },
  );
  await t.test(
    "progress validates boundaries, permissions and preserves omitted updates",
    async () => {
      for (const progress of [-1, 101, 12.5, 35, "50", null]) {
        assert.equal(
          (
            await editor.call(`/boards/${board.id}/cards`, "POST", {
              title: "Ungültig",
              columnId: board.columns[0].id,
              progress,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await editor.call(`/cards/${card.id}`, "PATCH", {
              ...card,
              progress,
            })
          ).status,
          400,
        );
      }
      assert.equal(
        (
          await viewer.call(`/cards/${card.id}`, "PATCH", {
            ...card,
            progress: 100,
          })
        ).status,
        403,
      );
      for (const progress of [0, 25, 50, 75, 100, 75]) {
        assert.equal(
          (
            await editor.call(`/cards/${card.id}`, "PATCH", {
              ...card,
              progress,
            })
          ).status,
          200,
        );
        board = (await viewer.call(`/boards/${board.id}`)).data;
        card = board.cards.find((c) => c.id === card.id);
        assert.equal(card.progress, progress);
        assert.equal(card.checklist.filter((i) => i.done).length, 1);
        assert.equal(card.columnId, board.columns[0].id);
      }
      const { progress, ...legacyUpdate } = card;
      assert.equal(
        (await editor.call(`/cards/${card.id}`, "PATCH", legacyUpdate)).status,
        200,
      );
      board = (await viewer.call(`/boards/${board.id}`)).data;
      card = board.cards.find((c) => c.id === card.id);
      assert.equal(card.progress, 75);
      const created = await editor.call(`/boards/${board.id}/cards`, "POST", {
        title: "Standardfortschritt",
        columnId: board.columns[0].id,
      });
      assert.equal(created.status, 201);
      assert.equal(created.data.progress, 0);
      await editor.call(`/cards/${created.data.id}`, "DELETE", {
        version: created.data.version,
      });
      board = (await editor.call(`/boards/${board.id}`)).data;
      const activity = (await editor.call(`/boards/${board.id}/activity`)).data;
      assert.ok(
        activity.some((a) => a.action === "Fortschritt geändert: 100 % → 75 %"),
      );
    },
  );
  await t.test(
    "partial task saves retain other fields and return the new version",
    async () => {
      const before = card;
      const saved = await editor.call(`/cards/${card.id}`, "PATCH", {
        progress: 25,
        version: before.version,
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.version, before.version + 1);
      board = (await editor.call(`/boards/${board.id}`)).data;
      card = board.cards.find((c) => c.id === before.id);
      assert.equal(card.progress, 25);
      for (const key of [
        "title",
        "description",
        "columnId",
        "priority",
        "labels",
        "checklist",
        "dueDate",
        "assigneeId",
      ])
        assert.deepEqual(card[key], before[key]);
      assert.equal(
        (
          await editor.call(`/cards/${card.id}`, "PATCH", {
            progress: 50,
            version: before.version,
          })
        ).status,
        409,
      );
      assert.equal(
        (await editor.call(`/cards/${card.id}`, "PATCH", { progress: 50 }))
          .status,
        400,
      );
      assert.equal(
        (
          await viewer.call(`/cards/${card.id}`, "PATCH", {
            progress: 50,
            version: card.version,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await editor.call(`/cards/${card.id}`, "PATCH", {
            title: "",
            version: card.version,
          })
        ).status,
        400,
      );
      const duplicate = { id: crypto.randomUUID(), text: "Punkt", done: false };
      assert.equal(
        (
          await editor.call(`/cards/${card.id}`, "PATCH", {
            checklist: [duplicate, duplicate],
            version: card.version,
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "project permissions protect board reads, writes and admin settings",
    async () => {
      assert.equal((await outsider.call(`/boards/${board.id}`)).status, 401);
      await outsider.call("/invitations/not-a-token");
      const registered = await admin.call("/admin/users", "POST", {
        name: "Outsider",
        email: "outsider@test.example",
        password: "OutsiderPassword123!",
      });
      assert.equal(registered.status, 201);
      await outsider.call("/auth/login", "POST", {
        email: "outsider@test.example",
        password: "OutsiderPassword123!",
      });
      assert.equal((await outsider.call(`/boards/${board.id}`)).status, 403);
      assert.equal(
        (await outsider.call(`/cards/${card.id}/comments`)).status,
        403,
      );
      assert.equal(
        (
          await viewer.call(`/boards/${board.id}/cards`, "POST", {
            title: "No",
            columnId: board.columns[0].id,
          })
        ).status,
        403,
      );
      assert.equal((await viewer.call("/admin/auth")).status, 403);
      assert.equal(
        (
          await editor.call(`/projects/${project.id}/invitations`, "POST", {
            email: "illegal@test.example",
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "project icons persist on creation and owner edits, retain omitted fields and reject unauthorized or invalid updates",
    async () => {
      assert.equal(project.icon, "code");
      const created = await admin.call("/projects", "POST", {
        name: "Website Icon",
        icon: "globe",
      });
      assert.equal(created.status, 201);
      assert.equal(created.data.icon, "globe");
      const before = (await admin.call("/projects")).data.find(
        (p) => p.id === project.id,
      );
      for (const user of [editor, viewer, outsider]) {
        assert.equal(
          (
            await user.call(`/projects/${project.id}`, "PATCH", {
              icon: "shield",
            })
          ).status,
          403,
        );
      }
      assert.equal(
        (
          await admin.call(`/projects/${project.id}`, "PATCH", {
            icon: "calendar",
          })
        ).status,
        200,
      );
      let saved = (await viewer.call("/projects")).data.find(
        (p) => p.id === project.id,
      );
      assert.equal(saved.icon, "calendar");
      assert.equal(saved.name, before.name);
      assert.equal(saved.description, before.description);
      assert.equal(saved.color, before.color);
      assert.deepEqual(
        saved.Boards.map((b) => b.id).sort(),
        before.Boards.map((b) => b.id).sort(),
      );
      assert.equal(
        (
          await admin.call(`/projects/${project.id}`, "PATCH", {
            description: before.description,
          })
        ).status,
        200,
      );
      for (const icon of ["unknown", "<svg onload=alert(1)>", null, 5]) {
        assert.equal(
          (await admin.call("/projects", "POST", { name: "Invalid Icon", icon }))
            .status,
          400,
        );
        assert.equal(
          (await admin.call(`/projects/${project.id}`, "PATCH", { icon })).status,
          400,
        );
      }
      saved = (await editor.call("/projects")).data.find(
        (p) => p.id === project.id,
      );
      assert.equal(saved.icon, "calendar");
      assert.equal(
        (await admin.call(`/projects/${created.data.id}`, "DELETE")).status,
        200,
      );
    },
  );
  await t.test("simultaneous moves cannot overwrite each other", async () => {
    const body = {
      cardId: card.id,
      columnId: board.columns[1].id,
      index: 0,
      revision: board.revision,
    };
    const results = await Promise.all([
      editor.call(`/boards/${board.id}/move`, "POST", body),
      admin.call(`/boards/${board.id}/move`, "POST", body),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    board = (await editor.call(`/boards/${board.id}`)).data;
    assert.equal(board.cards[0].columnId, board.columns[1].id);
  });
  await t.test("stale task edits and deletions are rejected", async () => {
    const latest = board.cards[0];
    assert.equal(
      (
        await editor.call(`/cards/${card.id}`, "PATCH", {
          ...latest,
          title: "Aktualisiert",
          version: latest.version,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await admin.call(`/cards/${card.id}`, "PATCH", {
          ...latest,
          title: "Lost update",
          version: latest.version,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await editor.call(`/cards/${card.id}`, "DELETE", {
          version: latest.version,
        })
      ).status,
      409,
    );
    board = (await editor.call(`/boards/${board.id}`)).data;
    card = board.cards[0];
    assert.equal(card.title, "Aktualisiert");
  });
  await t.test(
    "nonmember cannot be assigned and columns containing tasks cannot be removed",
    async () => {
      assert.equal(
        (
          await editor.call(`/cards/${card.id}`, "PATCH", {
            ...card,
            assigneeId: crypto.randomUUID(),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await editor.call(`/boards/${board.id}`, "PATCH", {
            revision: board.revision,
            columns: board.columns.filter((c) => c.id !== card.columnId),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await editor.call(`/boards/${board.id}`, "PATCH", {
            revision: board.revision,
            columns: [board.columns[0], board.columns[0]],
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "buckets preserve cards and completion when renamed, reordered, added or removed",
    async () => {
      board = (await editor.call(`/boards/${board.id}`)).data;
      const original = board.columns;
      const existingCards = board.cards.map(({ id, columnId }) => ({
        id,
        columnId,
      }));
      // Simulate an existing installation whose JSON predates the explicit flag.
      await Board.update(
        { columns: original.map(({ isDone, ...c }) => c) },
        { where: { id: board.id } },
      );
      const extra = {
        id: crypto.randomUUID(),
        name: "Wartet auf Kunden",
        color: "#abcdef",
      };
      const customized = [...original].reverse().map(({ isDone, ...c }) => ({
        ...c,
        name: c.id === card.columnId ? "Technik" : c.name,
      }));
      const patch = {
        revision: board.revision,
        columns: [...customized, extra],
      };
      assert.equal(
        (await viewer.call(`/boards/${board.id}`, "PATCH", patch)).status,
        403,
      );
      assert.equal(
        (await editor.call(`/boards/${board.id}`, "PATCH", patch)).status,
        200,
      );
      assert.equal(
        (await admin.call(`/boards/${board.id}`, "PATCH", patch)).status,
        409,
      );
      board = (await viewer.call(`/boards/${board.id}`)).data;
      assert.equal(board.columns[0].id, original.at(-1).id);
      assert.equal(board.columns[0].isDone, true);
      assert.equal(board.columns.at(-1).isDone, false);
      assert.equal(board.columns.at(-1).color, "#abcdef");
      assert.equal(
        board.columns.find((c) => c.id === card.columnId).name,
        "Technik",
      );
      assert.deepEqual(
        board.cards.map(({ id, columnId }) => ({ id, columnId })),
        existingCards,
      );
      for (const columns of [
        [],
        Array.from({ length: 13 }, () => ({
          ...extra,
          id: crypto.randomUUID(),
        })),
      ]) {
        assert.equal(
          (
            await editor.call(`/boards/${board.id}`, "PATCH", {
              revision: board.revision,
              columns,
            })
          ).status,
          400,
        );
      }
      const revised = board.columns.map((c) => ({
        ...c,
        isDone: c.id === extra.id,
      }));
      assert.equal(
        (
          await editor.call(`/boards/${board.id}`, "PATCH", {
            revision: board.revision,
            columns: revised,
          })
        ).status,
        200,
      );
      board = (await viewer.call(`/boards/${board.id}`)).data;
      assert.deepEqual(
        board.columns.filter((c) => c.isDone).map((c) => c.id),
        [extra.id],
      );
      // Restore the original buckets and remove the new empty one.
      assert.equal(
        (
          await editor.call(`/boards/${board.id}`, "PATCH", {
            revision: board.revision,
            columns: original,
          })
        ).status,
        200,
      );
      board = (await editor.call(`/boards/${board.id}`)).data;
      assert.deepEqual(board.columns, original);
    },
  );
  await t.test("comments are shared and recorded in activity", async () => {
    assert.equal(
      (
        await editor.call(`/cards/${card.id}/comments`, "POST", {
          body: "Status: bereit für Review.",
        })
      ).status,
      201,
    );
    assert.equal(
      (await viewer.call(`/cards/${card.id}/comments`)).data[0].body,
      "Status: bereit für Review.",
    );
    assert.equal(
      (await viewer.call(`/cards/${card.id}/comments`, "POST", { body: "No" }))
        .status,
      403,
    );
    const activity = (await viewer.call(`/boards/${board.id}/activity`)).data;
    assert.ok(activity.some((a) => a.action === "Kommentar hinzugefügt"));
    assert.ok(activity.some((a) => a.action.startsWith("Status geändert")));
  });
  await t.test(
    "uploads have authenticated downloads, safe file types and project permissions",
    async () => {
      const form = new FormData();
      form.append(
        "file",
        new Blob(["Projektplan"], { type: "text/plain" }),
        "Projektübersicht.txt",
      );
      const r = await editor.call(
        `/cards/${card.id}/attachments`,
        "POST",
        form,
      );
      assert.equal(r.status, 201);
      const file = r.data;
      assert.equal(
        (await viewer.call(`/cards/${card.id}/attachments`)).data[0].name,
        "Projektübersicht.txt",
      );
      const download = await viewer.call(`/attachments/${file.id}/download`);
      assert.equal(download.status, 200);
      assert.equal(download.data, "Projektplan");
      assert.match(download.headers.get("content-disposition"), /^attachment;/);
      assert.equal(download.headers.get("x-content-type-options"), "nosniff");
      assert.equal(
        (await outsider.call(`/attachments/${file.id}/download`)).status,
        403,
      );
      assert.equal(
        (await viewer.call(`/attachments/${file.id}`, "DELETE")).status,
        403,
      );
      const html = new FormData();
      html.append("file", new Blob(["<script>evil()</script>"]), "evil.html");
      assert.equal(
        (await editor.call(`/cards/${card.id}/attachments`, "POST", html))
          .status,
        400,
      );
      const big = new FormData();
      big.append(
        "file",
        new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]),
        "large.txt",
      );
      assert.equal(
        (await editor.call(`/cards/${card.id}/attachments`, "POST", big))
          .status,
        400,
      );
      assert.equal(
        (await editor.call(`/attachments/${file.id}`, "DELETE")).status,
        200,
      );
    },
  );
  await t.test(
    "removing a member revokes access and clears assignment",
    async () => {
      assert.equal(
        (
          await admin.call(
            `/projects/${project.id}/members/${editorUser.id}`,
            "DELETE",
          )
        ).status,
        200,
      );
      assert.equal((await editor.call(`/boards/${board.id}`)).status, 403);
      board = (await admin.call(`/boards/${board.id}`)).data;
      card = board.cards[0];
      assert.equal(card.assigneeId, null);
    },
  );
  await t.test(
    "authentication configuration hides and encrypts secrets and preserves blank values",
    async () => {
      const config = {
        provider: "local",
        oidc: {
          issuer: "https://identity.example",
          clientId: "client",
          secret: "sensitive-secret",
          name: "SSO",
        },
        ldap: { bindPassword: "sensitive-bind-password" },
      };
      assert.equal(
        (await admin.call("/admin/auth", "PUT", config)).status,
        200,
      );
      const read = (await admin.call("/admin/auth")).data;
      assert.equal(read.oidc.secret, "");
      assert.equal(read.oidc.hasSecret, true);
      assert.equal(read.ldap.bindPassword, "");
      const stored = await Setting.findByPk("authentication");
      assert.ok(!stored.value.includes("sensitive"));
      assert.ok(!stored.value.includes("identity"));
      await admin.call("/admin/auth", "PUT", read);
      assert.equal((await admin.call("/admin/auth")).data.oidc.hasSecret, true);
      assert.equal(
        (
          await admin.call("/admin/auth", "PUT", {
            ...read,
            provider: "oidc",
            oidc: { ...read.oidc, issuer: "http://identity.example" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await admin.call("/admin/auth", "PUT", {
            ...read,
            provider: "ldap",
            ldap: {
              ...read.ldap,
              url: "ldap://dc.example",
              baseDn: "DC=example",
              bindDn: "service",
              startTls: false,
            },
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "only administrators can change branding; public metadata contains no storage paths",
    async () => {
      assert.deepEqual((await anonymous.call("/public")).data.branding, {
        name: "Projektwerk",
        logoUrl: null,
        logoMime: null,
      });
      const current = await admin.call("/admin/branding");
      assert.equal(current.status, 200);
      assert.equal((await anonymous.call("/admin/branding")).status, 401);
      assert.equal((await viewer.call("/admin/branding")).status, 403);
      assert.equal(
        (await anonymous.call("/admin/branding", "PUT", { name: "Anonymous" }))
          .status,
        401,
      );
      assert.equal(
        (await editor.call("/admin/branding", "PUT", { name: "Editor" })).status,
        403,
      );
      const form = new FormData();
      form.append("name", "Unauthorized upload");
      form.append("logo", new Blob(["bad"]), "logo.png");
      assert.equal(
        (await viewer.call("/admin/branding", "PUT", form)).status,
        403,
      );
      assert.equal(
        (
          await admin.call(
            "/admin/branding",
            "PUT",
            { name: "Changed" },
            { Origin: "https://evil.example" },
          )
        ).status,
        403,
      );
      for (const body of [
        { name: "" },
        { name: "   " },
        { name: "x".repeat(61) },
        { name: "Allowed", role: "admin" },
        { name: "Allowed", removeLogo: "unexpected" },
      ]) {
        assert.equal(
          (await admin.call("/admin/branding", "PUT", body)).status,
          400,
        );
      }
      const saved = await admin.call("/admin/branding", "PUT", {
        name: "  Unsere Planung  ",
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.name, "Unsere Planung");
      assert.equal(
        JSON.parse((await Setting.findByPk("branding")).value).name,
        "Unsere Planung",
      );
      assert.deepEqual(
        (await anonymous.call("/public")).data.branding,
        saved.data,
      );
    },
  );
  await t.test(
    "PNG, JPEG and WebP logos persist, render publicly, replace and remove without affecting names",
    async () => {
      const fixtures = JSON.parse(
        await fs.readFile("tests/fixtures/logo-images.json", "utf8"),
      );
      let previousUrl;
      for (const [format, encoded] of Object.entries(fixtures)) {
        const bytes = Buffer.from(encoded, "base64");
        const form = new FormData();
        form.append("name", "Unsere Planung");
        // Detect the real format independently of the supplied filename and MIME.
        form.append(
          "logo",
          new Blob([bytes], { type: "application/octet-stream" }),
          "untrusted-name.txt",
        );
        const saved = await admin.call("/admin/branding", "PUT", form);
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        assert.equal(saved.data.logoMime, `image/${format}`);
        assert.deepEqual(Object.keys(saved.data).sort(), [
          "logoMime",
          "logoUrl",
          "name",
        ]);
        assert.match(
          saved.data.logoUrl,
          /^\/api\/branding\/logo\/[a-f0-9-]{36}$/,
        );
        const logo = await fetch(base + saved.data.logoUrl);
        assert.equal(logo.status, 200);
        assert.equal(logo.headers.get("content-type"), `image/${format}`);
        assert.equal(logo.headers.get("x-content-type-options"), "nosniff");
        assert.equal(logo.headers.get("content-disposition"), "inline");
        assert.deepEqual(Buffer.from(await logo.arrayBuffer()), bytes);
        if (previousUrl)
          assert.equal((await fetch(base + previousUrl)).status, 404);
        previousUrl = saved.data.logoUrl;
        const rename = await admin.call("/admin/branding", "PUT", {
          name: "Neuer Name",
        });
        assert.equal(rename.data.logoUrl, saved.data.logoUrl);
        assert.equal(
          (await anonymous.call("/public")).data.branding.name,
          "Neuer Name",
        );
        assert.equal(
          (await fs.readdir("artifacts/test-uploads/branding")).length,
          1,
        );
      }
      const removed = await admin.call("/admin/branding", "PUT", {
        name: "Neuer Name",
        removeLogo: true,
      });
      assert.deepEqual(removed.data, {
        name: "Neuer Name",
        logoUrl: null,
        logoMime: null,
      });
      assert.equal((await fetch(base + previousUrl)).status, 404);
      assert.deepEqual(await fs.readdir("artifacts/test-uploads/branding"), []);
      assert.equal(
        (await fetch(base + "/api/branding/logo/not-a-logo")).status,
        404,
      );
    },
  );
  await t.test(
    "invalid, active-content and oversized logos are rejected without changing saved branding",
    async () => {
      const fixtures = JSON.parse(
        await fs.readFile("tests/fixtures/logo-images.json", "utf8"),
      );
      const oversizedDimensions = Buffer.from(fixtures.png, "base64");
      oversizedDimensions.writeUInt32BE(4097, 16);
      const invalids = [
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
        Buffer.from("<html>bad</html>"),
        Buffer.from(fixtures.png, "base64").subarray(0, 35),
        oversizedDimensions,
        Buffer.alloc(2 * 1024 * 1024 + 1),
      ];
      for (const bytes of invalids) {
        const form = new FormData();
        form.append("name", "Should not be saved");
        form.append("logo", new Blob([bytes], { type: "image/png" }), "logo.png");
        const response = await admin.call("/admin/branding", "PUT", form, {
          "Accept-Language": "en",
        });
        assert.equal(response.status, 400);
        assert.match(response.data.error, /logo/);
      }
      const conflicting = new FormData();
      conflicting.append("name", "Should not be saved");
      conflicting.append("removeLogo", "true");
      conflicting.append(
        "logo",
        new Blob([Buffer.from(fixtures.png, "base64")]),
        "logo.png",
      );
      assert.equal(
        (await admin.call("/admin/branding", "PUT", conflicting)).status,
        400,
      );
      assert.deepEqual((await anonymous.call("/public")).data.branding, {
        name: "Neuer Name",
        logoUrl: null,
        logoMime: null,
      });
      assert.deepEqual(await fs.readdir("artifacts/test-uploads/branding"), []);
      await admin.call("/admin/branding", "PUT", { name: "Projektwerk" });
    },
  );
  await t.test("disabled user sessions stop working immediately", async () => {
    assert.equal(
      (
        await admin.call(`/admin/users/${viewerUser.id}`, "PATCH", {
          disabled: true,
        })
      ).status,
      200,
    );
    assert.equal((await viewer.call("/me")).status, 401);
    const me = (await admin.call("/me")).data;
    assert.equal(
      (await admin.call(`/admin/users/${me.id}`, "PATCH", { disabled: true }))
        .status,
      400,
    );
  });
  await t.test(
    "project deletion cascades and logout destroys sessions",
    async () => {
      assert.equal(
        (await admin.call(`/projects/${project.id}`, "DELETE")).status,
        200,
      );
      assert.equal((await admin.call(`/boards/${board.id}`)).status, 404);
      assert.equal((await admin.call("/auth/logout", "POST")).status, 200);
      assert.equal((await admin.call("/me")).status, 401);
    },
  );
});
await new Promise((r) => server.close(r));
await db.close();
await fs.rm("artifacts/test-uploads", { recursive: true, force: true });
