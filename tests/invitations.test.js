import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
const { app } = await import("../server/index.js");
const { db, Setting, User, Invitation, Membership, initializeDatabase } =
  await import("../server/db.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`,
  origin = new URL(process.env.APP_URL).origin;
function client() {
  let cookie = "";
  return async (path, method = "GET", body) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, data: await r.json() };
  };
}
const admin = client(),
  receiver = client(),
  outsider = client(),
  anonymous = client();
const password = "InvitationPassword123!";
let project, target, other, disabled;
try {
  await test("authenticated in-app invitations", async (t) => {
    await t.test(
      "set up accounts, project and existing invitation migration",
      async () => {
        await admin("/setup", "POST", {
          name: "Admin",
          email: "admin@inbox.test",
          password,
          sample: false,
        });
        project = (await admin("/projects", "POST", { name: "Zusammenarbeit" }))
          .data;
        const create = async (name, email) =>
          (await admin("/admin/users", "POST", { name, email, password })).data;
        target = await create("Zielkonto", "target@inbox.test");
        other = await create("Anderes Konto", "other@inbox.test");
        disabled = await create("Deaktiviert", "disabled@inbox.test");
        await admin(`/admin/users/${disabled.id}`, "PATCH", { disabled: true });
        await receiver("/auth/login", "POST", {
          email: target.email,
          password,
        });
        await outsider("/auth/login", "POST", { email: other.email, password });
        const legacy = await Invitation.create({
          ProjectId: project.id,
          email: target.email,
          tokenHash: randomBytes(32).toString("hex"),
          role: "viewer",
          expiresAt: new Date(Date.now() + 86400000),
        });
        const before = await Invitation.findAll({
          attributes: [
            "id",
            "email",
            "tokenHash",
            "role",
            "ProjectId",
            "expiresAt",
            "acceptedAt",
            "createdAt",
            "updatedAt",
          ],
          raw: true,
        });
        assert.equal(db.getDatabaseName(), "projektwerk_test");
        const constraints = await db.query(
          "SELECT DISTINCT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = 'Invitations' AND COLUMN_NAME IN ('recipientId','inviterId') AND REFERENCED_TABLE_NAME IS NOT NULL",
          { replacements: { schema: "projektwerk_test" }, type: "SELECT" },
        );
        for (const row of constraints)
          await db.query(
            `ALTER TABLE Invitations DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``,
          );
        for (const field of ["recipientId", "inviterId"])
          await db.query(`ALTER TABLE Invitations DROP COLUMN \`${field}\``);
        await initializeDatabase();
        await initializeDatabase();
        assert.deepEqual(
          await Invitation.findAll({
            attributes: [
              "id",
              "email",
              "tokenHash",
              "role",
              "ProjectId",
              "expiresAt",
              "acceptedAt",
              "createdAt",
              "updatedAt",
            ],
            raw: true,
          }),
          before,
        );
        assert.equal((await receiver("/invitations")).data[0].id, legacy.id);
        assert.deepEqual((await outsider("/invitations")).data, []);
        assert.equal(
          (await receiver(`/invitations/${legacy.id}/decline`, "POST", {}))
            .status,
          200,
        );
      },
    );
    const invite = (userId = target.id, role = "editor") =>
      admin(`/projects/${project.id}/invitations`, "POST", { userId, role });
    await t.test(
      "only project owners invite active registered accounts without links",
      async () => {
        assert.equal((await invite(disabled.id)).status, 400);
        assert.equal((await invite(randomUUID())).status, 400);
        assert.equal(
          (
            await admin(`/projects/${project.id}/invitations`, "POST", {
              email: target.email,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await outsider(`/projects/${project.id}/invitations`, "POST", {
              userId: target.id,
            })
          ).status,
          403,
        );
        const created = await invite();
        assert.equal(created.status, 201);
        assert.deepEqual(Object.keys(created.data).sort(), [
          "expiresAt",
          "id",
          "role",
        ]);
        assert.equal((await invite()).status, 409);
        assert.deepEqual(
          (await admin(`/projects/${project.id}/invite-candidates?q=Ziel`))
            .data,
          [],
        );
        const ownerList = (await admin(`/projects/${project.id}/invitations`))
          .data;
        assert.equal(ownerList[0].recipient.name, target.name);
        assert.equal(ownerList[0].email, undefined);
      },
    );
    await t.test(
      "inbox and decisions are bound to immutable user ID",
      async () => {
        const entries = (await receiver("/invitations")).data,
          entry = entries[0];
        assert.equal(entry.project.name, project.name);
        assert.equal(entry.inviter.name, "Admin");
        assert.equal(entry.tokenHash, undefined);
        assert.equal((await anonymous("/invitations")).status, 401);
        assert.equal(
          (await anonymous(`/invitations/${entry.id}/accept`, "POST", {}))
            .status,
          401,
        );
        assert.equal(
          (await outsider(`/invitations/${entry.id}/accept`, "POST", {}))
            .status,
          404,
        );
        assert.equal(
          (await outsider(`/invitations/${entry.id}/decline`, "POST", {}))
            .status,
          404,
        );
        await User.update(
          { email: "changed@inbox.test" },
          { where: { id: target.id } },
        );
        const responses = await Promise.all([
          receiver(`/invitations/${entry.id}/accept`, "POST", {}),
          receiver(`/invitations/${entry.id}/accept`, "POST", {}),
        ]);
        assert.deepEqual(
          responses.map((result) => result.status).sort(),
          [200, 404],
        );
        assert.equal(
          await Membership.count({
            where: { ProjectId: project.id, UserId: target.id },
          }),
          1,
        );
        assert.equal(
          (
            await Membership.findOne({
              where: { ProjectId: project.id, UserId: target.id },
            })
          ).role,
          "editor",
        );
        assert.deepEqual((await receiver("/invitations")).data, []);
        assert.equal((await invite()).status, 409);
      },
    );
    await t.test(
      "decline, revoke, expiry and archived projects grant no membership",
      async () => {
        const create = () => invite(other.id, "viewer");
        let entry = (await create()).data;
        assert.equal(
          (await outsider(`/invitations/${entry.id}/decline`, "POST", {}))
            .status,
          200,
        );
        assert.equal(
          (await outsider(`/invitations/${entry.id}/accept`, "POST", {}))
            .status,
          404,
        );
        entry = (await create()).data;
        await admin(
          `/projects/${project.id}/invitations/${entry.id}`,
          "DELETE",
        );
        assert.deepEqual((await outsider("/invitations")).data, []);
        assert.equal(
          (await outsider(`/invitations/${entry.id}/accept`, "POST", {}))
            .status,
          404,
        );
        entry = (await create()).data;
        await Invitation.update(
          { expiresAt: new Date(Date.now() - 1000) },
          { where: { id: entry.id } },
        );
        assert.deepEqual((await outsider("/invitations")).data, []);
        assert.equal(
          (await outsider(`/invitations/${entry.id}/accept`, "POST", {}))
            .status,
          404,
        );
        entry = (await create()).data;
        await admin(`/projects/${project.id}`, "PATCH", { archived: true });
        assert.deepEqual((await outsider("/invitations")).data, []);
        assert.equal(
          (await outsider(`/invitations/${entry.id}/accept`, "POST", {}))
            .status,
          404,
        );
        assert.equal(
          await Membership.count({
            where: { ProjectId: project.id, UserId: other.id },
          }),
          0,
        );
      },
    );
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
