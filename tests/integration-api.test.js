import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
const { app } = await import("../server/index.js");
const {
  db,
  Setting,
  ApiToken,
  User,
  Board,
  Card,
  Membership,
  initializeDatabase,
} = await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`,
  origin = new URL(process.env.APP_URL).origin;
function sessionClient() {
  let cookie = "";
  return async (path, method = "GET", body, useOrigin = true, headers = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        ...(useOrigin ? { Origin: origin } : {}),
        Cookie: cookie,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, data: await r.json(), headers: r.headers };
  };
}
const admin = sessionClient(),
  viewer = sessionClient();
const tokenCall = async (
  token,
  path,
  method = "GET",
  body,
  extraHeaders = {},
) => {
  const r = await fetch(base + "/v1" + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
};
let project, board, otherBoard, read, write, viewerUser, card;
try {
  await test("board-scoped external integration API", async (t) => {
    await t.test("additive token table preserves existing data", async () => {
      await admin("/setup", "POST", {
        name: "Admin",
        email: "admin@api.test",
        password: "IntegrationPassword123!",
        sample: true,
      });
      project = (await admin("/projects")).data[0];
      board = (await admin(`/boards/${project.Boards[0].id}`)).data;
      otherBoard = (
        await admin(`/projects/${project.id}/boards`, "POST", {
          name: "Private sibling board",
        })
      ).data;
      const before = (await Card.findAll({ order: [["id", "ASC"]] })).map(
        (row) => row.toJSON(),
      );
      assert.equal(db.getDatabaseName(), "projektwerk_test");
      await ApiToken.drop();
      await initializeDatabase();
      assert.deepEqual(
        (await Card.findAll({ order: [["id", "ASC"]] })).map((row) =>
          row.toJSON(),
        ),
        before,
      );
      assert.equal(await ApiToken.count(), 0);
      viewerUser = (
        await admin("/admin/users", "POST", {
          name: "Viewer",
          email: "viewer@api.test",
          password: "IntegrationPassword123!",
        })
      ).data;
      await Membership.create({
        ProjectId: project.id,
        UserId: viewerUser.id,
        role: "viewer",
      });
      await viewer("/auth/login", "POST", {
        email: viewerUser.email,
        password: "IntegrationPassword123!",
      });
    });
    await t.test(
      "session-only token creation validates scope, stores hashes and shows secrets once",
      async () => {
        for (const fields of [
          { boardIds: [] },
          { boardIds: [randomUUID()] },
          { boardIds: [board.id, board.id] },
          { mode: "admin" },
          { expiresInDays: 0 },
          { UserId: viewerUser.id },
        ])
          assert(
            (
              await admin("/me/api-tokens", "POST", {
                name: "Invalid",
                boardIds: [board.id],
                mode: "read",
                ...fields,
              })
            ).status >= 400,
          );
        assert.equal(
          (
            await admin(
              "/me/api-tokens",
              "POST",
              { name: "CSRF", boardIds: [board.id], mode: "read" },
              false,
            )
          ).status,
          403,
        );
        read = (
          await admin("/me/api-tokens", "POST", {
            name: "Read",
            boardIds: [board.id],
            mode: "read",
          })
        ).data;
        write = (
          await admin("/me/api-tokens", "POST", {
            name: "Agent",
            boardIds: [board.id],
            mode: "write",
            expiresInDays: 30,
          })
        ).data;
        assert.match(write.token, /^pw_[\w-]{43}$/);
        const stored = await ApiToken.findByPk(write.id);
        assert.notEqual(stored.tokenHash, write.token);
        assert.equal(stored.tokenHash.length, 64);
        const listed = (await admin("/me/api-tokens")).data;
        assert.equal(listed.length, 2);
        assert(!JSON.stringify(listed).includes(write.token));
        assert(
          listed.every(
            (entry) =>
              !Object.hasOwn(entry, "tokenHash") &&
              !Object.hasOwn(entry, "token"),
          ),
        );
        assert.deepEqual((await viewer("/me/api-tokens")).data, []);
        assert.equal(
          (await viewer(`/me/api-tokens/${write.id}`, "DELETE")).status,
          404,
        );
      },
    );
    await t.test(
      "bearer auth is required and restricted to the versioned board API",
      async () => {
        assert.equal((await tokenCall(null, "/boards")).status, 401);
        assert.equal((await tokenCall("bad", "/boards")).status, 401);
        assert.equal((await admin("/v1/boards")).status, 401);
        assert.equal(
          (
            await admin("/admin/users", "GET", undefined, true, {
              Authorization: `Bearer ${write.token}`,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await admin(
              "/me/api-tokens",
              "POST",
              { name: "Cannot mint", boardIds: [board.id], mode: "write" },
              true,
              { Authorization: `Bearer ${write.token}` },
            )
          ).status,
          403,
        );
        for (const path of ["/admin/users", "/me", "/invitations", "/projects"])
          assert.equal((await tokenCall(write.token, path)).status, 404);
        const list = await tokenCall(read.token, "/boards");
        assert.equal(list.status, 200);
        assert.deepEqual(
          list.data.map((entry) => entry.id),
          [board.id],
        );
        assert.equal(list.data[0].canEdit, false);
        assert.equal(list.headers.get("cache-control"), "no-store");
        assert.equal(list.headers.get("set-cookie"), null);
        assert.equal(
          (await tokenCall(write.token, `/boards/${otherBoard.id}`)).status,
          403,
        );
        const outsider = await Card.create({
          title: "Private task",
          BoardId: otherBoard.id,
          columnId: otherBoard.columns[0].id,
        });
        assert.equal(
          (await tokenCall(write.token, `/cards/${outsider.id}`)).status,
          403,
        );
        assert.equal(
          (
            await tokenCall(write.token, `/cards/${outsider.id}`, "PATCH", {
              version: 0,
              title: "Forged",
            })
          ).status,
          403,
        );
        assert.equal(
          (await tokenCall(read.token, `/boards/${board.id}/members`)).status,
          200,
        );
        assert.equal(
          (await tokenCall(read.token, `/boards/${board.id}/templates`)).status,
          200,
        );
      },
    );
    await t.test(
      "write token creates, edits and moves tasks without a cookie or Origin header",
      async () => {
        assert.equal(
          (
            await tokenCall(read.token, `/boards/${board.id}/cards`, "POST", {
              title: "Blocked",
              columnId: board.columns[0].id,
            })
          ).status,
          403,
        );
        const created = await tokenCall(
          write.token,
          `/boards/${board.id}/cards`,
          "POST",
          { title: "AI task", columnId: board.columns[0].id },
        );
        assert.equal(created.status, 201);
        card = created.data;
        let updated = await tokenCall(
          write.token,
          `/cards/${card.id}`,
          "PATCH",
          {
            version: card.version,
            description: "Created by an integration",
            progress: 50,
            checklist: [{ id: randomUUID(), text: "Verify", done: false }],
          },
          { Origin: "https://external.example" },
        );
        assert.equal(updated.status, 200);
        assert.equal(
          (
            await tokenCall(write.token, `/cards/${card.id}`, "PATCH", {
              version: 0,
              title: "Lost update",
            })
          ).status,
          409,
        );
        card = (await tokenCall(read.token, `/cards/${card.id}`)).data;
        assert.equal(card.progress, 50);
        assert.equal(card.version, updated.data.version);
        const current = (await tokenCall(read.token, `/boards/${board.id}`))
          .data;
        assert.equal(
          (
            await tokenCall(write.token, `/boards/${board.id}/move`, "POST", {
              cardId: card.id,
              columnId: board.columns[1].id,
              index: 0,
              revision: current.revision,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await tokenCall(write.token, `/boards/${board.id}/move`, "POST", {
              cardId: card.id,
              columnId: board.columns[0].id,
              index: 0,
              revision: current.revision,
            })
          ).status,
          409,
        );
        assert.equal(
          (await tokenCall(read.token, `/cards/${card.id}`)).data.columnId,
          board.columns[1].id,
        );
        assert.equal(
          (
            await tokenCall(write.token, `/cards/${card.id}/comments`, "POST", {
              body: "Integration status",
            })
          ).status,
          201,
        );
        assert.equal(
          (await tokenCall(read.token, `/cards/${card.id}/comments`)).data[0]
            .body,
          "Integration status",
        );
        const disposable = (
          await tokenCall(write.token, `/boards/${board.id}/cards`, "POST", {
            title: "Disposable",
            columnId: board.columns[0].id,
          })
        ).data;
        assert.equal(
          (
            await tokenCall(read.token, `/cards/${disposable.id}`, "DELETE", {
              version: disposable.version,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await tokenCall(write.token, `/cards/${disposable.id}`, "DELETE", {
              version: disposable.version + 1,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await tokenCall(write.token, `/cards/${disposable.id}`, "DELETE", {
              version: disposable.version,
            })
          ).status,
          200,
        );
        const specification = (await tokenCall(read.token, "/openapi.json"))
          .data;
        assert.equal(specification.openapi, "3.0.3");
        assert(specification.paths["/boards/{boardId}/move"]);
        assert.equal(specification.security[0].bearerAuth.length, 0);
      },
    );
    await t.test(
      "current membership, account state, expiry and revocation always limit access",
      async () => {
        assert.equal(
          (
            await viewer("/me/api-tokens", "POST", {
              name: "Too much",
              boardIds: [board.id],
              mode: "write",
            })
          ).status,
          403,
        );
        const viewToken = (
          await viewer("/me/api-tokens", "POST", {
            name: "Viewer",
            boardIds: [board.id],
            mode: "read",
          })
        ).data;
        assert.equal(
          (await tokenCall(viewToken.token, `/boards/${board.id}`)).status,
          200,
        );
        await Membership.update(
          { role: "viewer" },
          {
            where: {
              ProjectId: project.id,
              UserId: (await admin("/me")).data.id,
            },
          },
        );
        assert.equal(
          (
            await tokenCall(write.token, `/cards/${card.id}`, "PATCH", {
              version: 0,
              title: "Blocked",
            })
          ).status,
          403,
        );
        await Membership.update(
          { role: "owner" },
          {
            where: {
              ProjectId: project.id,
              UserId: (await admin("/me")).data.id,
            },
          },
        );
        await User.update({ disabled: true }, { where: { id: viewerUser.id } });
        assert.equal((await tokenCall(viewToken.token, "/boards")).status, 401);
        await User.update(
          { disabled: false },
          { where: { id: viewerUser.id } },
        );
        await Membership.destroy({
          where: { ProjectId: project.id, UserId: viewerUser.id },
        });
        assert.equal(
          (await tokenCall(viewToken.token, `/boards/${board.id}`)).status,
          403,
        );
        assert.deepEqual(
          (await tokenCall(viewToken.token, "/boards")).data,
          [],
        );
        await ApiToken.update(
          { expiresAt: new Date(Date.now() - 1000) },
          { where: { id: read.id } },
        );
        assert.equal((await tokenCall(read.token, "/boards")).status, 401);
        assert.equal(
          (await admin(`/me/api-tokens/${write.id}`, "DELETE")).status,
          200,
        );
        assert.equal((await tokenCall(write.token, "/boards")).status, 401);
        assert.equal(
          (await admin(`/me/api-tokens/${write.id}`, "DELETE")).status,
          200,
        );
      },
    );
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
