import test from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  createHash,
  sign,
  randomBytes,
} from "node:crypto";
import { Client } from "ldapts";
process.env.NODE_ENV = "test";
process.env.DATABASE_NAME = "projektwerk_test";
process.env.UPLOAD_DIR = "artifacts/auth-uploads";
const { app } = await import("../server/index.js");
const { db, Setting, User } = await import("../server/db.js");
const { ldapIdentity } = await import("../server/security.js");
await db.sync({ force: true });
await Setting.create({ key: "installation", value: "{}" });
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`,
  origin = new URL(process.env.APP_URL).origin;
const originalFetch = globalThis.fetch;
function client() {
  let cookie = "";
  return {
    async call(url, method = "GET", body) {
      const r = await originalFetch(`${base}/api${url}`, {
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
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
      return { status: r.status, data, location: r.headers.get("location") };
    },
  };
}
const issuer = "https://idp.test.example";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
  use: "sig",
  alg: "RS256",
};
let authorized = new Map(),
  claimOverrides = {},
  tokenRequests = 0;
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
function jwt(claims) {
  const h = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }),
    ).toString("base64url"),
    b = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${h}.${b}.${sign("RSA-SHA256", Buffer.from(`${h}.${b}`), privateKey).toString("base64url")}`;
}
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? new URL(input.url) : new URL(input);
  if (url.origin !== issuer) return originalFetch(input, init);
  if (url.pathname === "/.well-known/openid-configuration")
    return json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
      ],
      code_challenge_methods_supported: ["S256"],
    });
  if (url.pathname === "/jwks") return json({ keys: [jwk] });
  if (url.pathname === "/token") {
    tokenRequests++;
    const body = new URLSearchParams(init.body);
    const flow = authorized.get(body.get("code"));
    assert.ok(flow, "valid authorization code");
    assert.equal(
      createHash("sha256")
        .update(body.get("code_verifier"))
        .digest("base64url"),
      flow.challenge,
      "PKCE challenge",
    );
    assert.equal(body.get("redirect_uri"), `${origin}/api/auth/oidc/callback`);
    const now = Math.floor(Date.now() / 1000);
    return json({
      access_token: "test-access",
      token_type: "Bearer",
      expires_in: 3600,
      id_token: jwt({
        iss: issuer,
        sub: "subject-1",
        aud: "projektwerk-test",
        iat: now,
        exp: now + 3600,
        nonce: flow.nonce,
        email: "external@test.example",
        email_verified: true,
        name: "External User",
        ...claimOverrides,
      }),
    });
  }
  throw new Error(`Unexpected IdP request: ${url}`);
};
const admin = client();
let pid, invite;
await test("OIDC authorization code flow and directory identity", async (t) => {
  await t.test("prepare local admin and invited external user", async () => {
    assert.equal(
      (
        await admin.call("/setup", "POST", {
          name: "Admin",
          email: "local@test.example",
          password: "AdminPassword123!",
          sample: false,
        })
      ).status,
      201,
    );
    pid = (await admin.call("/projects", "POST", { name: "Identity Test" }))
      .data.id;
    const result = await admin.call(`/projects/${pid}/invitations`, "POST", {
      email: "external@test.example",
    });
    invite = new URL(result.data.url).searchParams.get("invite");
    assert.equal(
      (
        await admin.call("/admin/auth", "PUT", {
          provider: "oidc",
          oidc: {
            issuer,
            clientId: "projektwerk-test",
            secret: "secret",
            name: "Test IdP",
          },
          ldap: {},
        })
      ).status,
      200,
    );
  });
  async function start(c, token) {
    const result = await c.call(`/auth/oidc${token ? `?invite=${token}` : ""}`);
    assert.equal(result.status, 302);
    const url = new URL(result.location);
    assert.equal(url.origin, issuer);
    const code = randomBytes(10).toString("hex");
    authorized.set(code, {
      nonce: url.searchParams.get("nonce"),
      challenge: url.searchParams.get("code_challenge"),
    });
    return { code, state: url.searchParams.get("state") };
  }
  async function finish(c, flow) {
    return c.call(
      `/auth/oidc/callback?code=${flow.code}&state=${encodeURIComponent(flow.state)}`,
    );
  }
  await t.test(
    "state mismatch rejects login before token exchange",
    async () => {
      const c = client(),
        flow = await start(c, invite);
      const before = tokenRequests;
      const result = await finish(c, { ...flow, state: "wrong-state" });
      assert.match(result.location, /authError=/);
      assert.equal((await c.call("/me")).status, 401);
      assert.equal(tokenRequests, before);
    },
  );
  await t.test("nonce mismatch rejects identity token", async () => {
    claimOverrides = { nonce: "wrong-nonce" };
    const c = client(),
      result = await finish(c, await start(c, invite));
    assert.match(result.location, /authError=/);
    assert.equal((await c.call("/me")).status, 401);
    claimOverrides = {};
  });
  await t.test("unverified email cannot provision an account", async () => {
    claimOverrides = { email_verified: false };
    const c = client(),
      result = await finish(c, await start(c, invite));
    assert.match(result.location, /authError=/);
    assert.equal((await c.call("/me")).status, 401);
    claimOverrides = {};
  });
  await t.test("uninvited subject cannot provision an account", async () => {
    const c = client(),
      result = await finish(c, await start(c));
    assert.match(result.location, /authError=/);
    assert.equal((await c.call("/me")).status, 401);
  });
  await t.test(
    "valid PKCE, state, nonce and invited verified email create external identity",
    async () => {
      const c = client();
      const result = await finish(c, await start(c, invite));
      assert.equal(result.location, `/?invite=${invite}`);
      const me = await c.call("/me");
      assert.equal(me.data.authType, "oidc");
      assert.equal(me.data.email, "external@test.example");
      assert.equal(
        (await c.call(`/invitations/${invite}/accept`, "POST", {})).status,
        200,
      );
      assert.equal((await c.call("/projects")).data.length, 1);
      assert.match(result.location, /invite/);
    },
  );
  await t.test(
    "existing external subject can log in without another invitation; disabled identity cannot",
    async () => {
      const c = client();
      assert.equal((await finish(c, await start(c))).location, "/");
      const user = (await c.call("/me")).data;
      await admin.call(`/admin/users/${user.id}`, "PATCH", { disabled: true });
      assert.equal((await c.call("/me")).status, 401);
      const disabled = client();
      assert.match(
        (await finish(disabled, await start(disabled))).location,
        /authError=/,
      );
    },
  );
  await t.test(
    "directory flow escapes filters, verifies user bind and refuses disabled users",
    async () => {
      const calls = [];
      const original = {
        bind: Client.prototype.bind,
        search: Client.prototype.search,
        unbind: Client.prototype.unbind,
        startTLS: Client.prototype.startTLS,
      };
      let disabled = false;
      Client.prototype.bind = async function (dn, password) {
        calls.push(["bind", dn, password]);
        if (dn === "CN=Test" && password !== "user-password")
          throw new Error("Invalid credentials");
      };
      Client.prototype.startTLS = async function () {
        calls.push(["tls"]);
      };
      Client.prototype.unbind = async function () {
        calls.push(["unbind"]);
      };
      Client.prototype.search = async function (base, opts) {
        calls.push(["search", base, opts.filter]);
        return {
          searchEntries: [
            {
              dn: "CN=Test",
              mail: "person@test.example",
              displayName: "AD Person",
              entryUUID: "stable-id",
              userAccountControl: disabled ? "514" : "512",
            },
          ],
        };
      };
      const config = {
        ldap: {
          url: "ldap://directory.test.example",
          startTls: true,
          bindDn: "CN=Service",
          bindPassword: "service-password",
          baseDn: "DC=test",
          filter: "(&(objectClass=user)(sAMAccountName={username}))",
        },
      };
      try {
        const identity = await ldapIdentity(
          config,
          "user*)(evil=value)",
          "user-password",
        );
        assert.equal(identity.email, "person@test.example");
        assert.equal(identity.authType, "ldap");
        assert.ok(
          calls.some(
            (c) =>
              c[0] === "bind" && c[1] === "CN=Test" && c[2] === "user-password",
          ),
        );
        assert.ok(
          calls.some(
            (c) => c[0] === "search" && !c[2].includes("user*)(evil=value)"),
          ),
        );
        assert.equal(calls.filter((c) => c[0] === "tls").length, 2);
        assert.ok(
          calls.some((c) => c[0] === "search" && c[2].includes("\\2a\\29\\28")),
        );
        const ldapConfig = { provider: "ldap", oidc: {}, ldap: config.ldap };
        assert.equal(
          (await admin.call("/admin/auth", "PUT", ldapConfig)).status,
          200,
        );
        const directoryUser = client();
        assert.equal(
          (
            await directoryUser.call("/auth/login", "POST", {
              method: "ldap",
              email: "user",
              password: "user-password",
            })
          ).status,
          403,
        );
        const link = await admin.call(`/projects/${pid}/invitations`, "POST", {
          email: "person@test.example",
        });
        const token = new URL(link.data.url).searchParams.get("invite");
        assert.equal(
          (
            await directoryUser.call("/auth/login", "POST", {
              method: "ldap",
              email: "user",
              password: "user-password",
              invite: token,
            })
          ).status,
          200,
        );
        assert.equal((await directoryUser.call("/me")).data.authType, "ldap");
        assert.equal(
          (await directoryUser.call(`/invitations/${token}/accept`, "POST", {}))
            .status,
          200,
        );
        await assert.rejects(() =>
          ldapIdentity(config, "user", "wrong-password"),
        );
        disabled = true;
        await assert.rejects(
          () => ldapIdentity(config, "user", "user-password"),
          /deaktiviert/,
        );
        await assert.rejects(
          () => ldapIdentity(config, "user", ""),
          /Passwort/,
        );
      } finally {
        Object.assign(Client.prototype, original);
      }
    },
  );
});
globalThis.fetch = originalFetch;
await new Promise((r) => server.close(r));
await db.close();
