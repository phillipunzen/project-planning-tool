import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const fixture = {
  ...process.env,
  COMPOSE_FILE: "docker-compose.yml",
  APP_IMAGE: "",
  DATABASE_HOST: "db.test.example",
  DATABASE_PORT: "3344",
  DATABASE_NAME: "external_project_test",
  DATABASE_USER: "external_project_user",
  DATABASE_PASSWORD: "fixture-not-a-real-password",
  DATABASE_ROOT_PASSWORD: "fixture-root-not-a-real-password",
  SESSION_SECRET: "fixture-session-secret-not-a-real-secret",
  APP_URL: "http://localhost:8110",
};
function config(files, backup = false, overrides = {}) {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        ".env.example",
        ...(backup ? ["--profile", "backup"] : []),
        ...files.flatMap((file) => ["-f", file]),
        "config",
        "--format",
        "json",
      ],
      { encoding: "utf8", env: { ...fixture, ...overrides } },
    ),
  );
}
await test("default compose uses external database settings without a database server", () => {
  const c = config(["docker-compose.yml"]);
  const app = c.services.app;
  assert.equal(app.image, "ghcr.io/phillipunzen/project-planning-tool:latest");
  assert.equal(app.build, undefined);
  assert.equal(app.pull_policy, "always");
  for (const name of [
    "DATABASE_HOST",
    "DATABASE_PORT",
    "DATABASE_NAME",
    "DATABASE_USER",
    "DATABASE_PASSWORD",
  ])
    assert.equal(app.environment[name], fixture[name]);
  assert.equal(c.services.mariadb, undefined);
  assert.equal(app.depends_on, undefined);
  assert.deepEqual(Object.keys(c.volumes), ["uploads"]);
  assert.deepEqual(Object.keys(c.services), ["app"]);
  const backup = config(["docker-compose.yml"], true).services["db-backup"];
  assert.deepEqual(backup.profiles, ["backup"]);
  assert.equal(backup.environment.DATABASE_HOST, fixture.DATABASE_HOST);
  assert.ok(JSON.stringify(app.extra_hosts).includes("host.docker.internal"));
});
await test("optional local database uses the same schema and account and a private port", () => {
  const c = config(["docker-compose.yml", "docker-compose.local.yml"]);
  assert.equal(c.services.app.environment.DATABASE_HOST, "mariadb");
  assert.equal(c.services.app.environment.DATABASE_PORT, "3306");
  assert.equal(c.services.app.environment.DATABASE_NAME, fixture.DATABASE_NAME);
  assert.equal(
    c.services.mariadb.environment.MARIADB_DATABASE,
    fixture.DATABASE_NAME,
  );
  assert.equal(
    c.services.mariadb.environment.MARIADB_USER,
    fixture.DATABASE_USER,
  );
  assert.equal(
    c.services.mariadb.environment.MARIADB_PASSWORD,
    fixture.DATABASE_PASSWORD,
  );
  assert.equal(c.services.mariadb.ports, undefined);
  assert.equal(c.services.app.depends_on.mariadb.condition, "service_healthy");
  assert.equal(
    config(["docker-compose.yml", "docker-compose.local.yml"], true).services[
      "db-backup"
    ].environment.DATABASE_HOST,
    "mariadb",
  );
  const dev = config([
    "docker-compose.yml",
    "docker-compose.local.yml",
    "docker-compose.dev.yml",
  ]);
  assert.equal(dev.services.mariadb.ports[0].host_ip, "127.0.0.1");
  assert.equal(dev.services.mariadb.ports[0].published, "3317");
});
await test("legacy image override remains compatible with the image default and external DB", () => {
  const c = config(["docker-compose.yml", "docker-compose.image.yml"]);
  assert.equal(c.services.app.build, undefined);
  assert.equal(c.services.app.image, "ghcr.io/phillipunzen/project-planning-tool:latest");
  assert.equal(c.services.app.pull_policy, "always");
  assert.equal(c.services.mariadb, undefined);
  for (const name of ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASSWORD"])
    assert.equal(c.services.app.environment[name], fixture[name]);
  const local = config(["docker-compose.yml", "docker-compose.local.yml", "docker-compose.image.yml"]);
  assert.equal(local.services.app.build, undefined);
  assert.equal(local.services.app.environment.DATABASE_HOST, "mariadb");
});

await test("APP_IMAGE pins a release and local builds require an explicit override", () => {
  const pinned = "ghcr.io/phillipunzen/project-planning-tool:sha-59fb2206c3863aa42f2f67c52a0a6d8c9987c0b7";
  const c = config(["docker-compose.yml"], false, { APP_IMAGE: pinned });
  assert.equal(c.services.app.image, pinned);
  assert.equal(c.services.app.build, undefined);
  const built = config(["docker-compose.yml", "docker-compose.build.yml"], false, { APP_IMAGE: pinned });
  assert.equal(built.services.app.image, "projektwerk:local");
  assert.equal(built.services.app.pull_policy, "build");
  assert.equal(built.services.app.build.context, process.cwd());
  assert.equal(built.services.mariadb, undefined);
  assert.equal(built.services.app.environment.DATABASE_HOST, fixture.DATABASE_HOST);
  const local = config(["docker-compose.yml", "docker-compose.local.yml", "docker-compose.build.yml"]);
  assert.equal(local.services.app.image, "projektwerk:local");
  assert.equal(local.services.app.pull_policy, "build");
  assert.equal(local.services.app.environment.DATABASE_HOST, "mariadb");
  assert.equal(local.services.app.depends_on.mariadb.condition, "service_healthy");
});
