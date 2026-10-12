import test from "node:test";
import assert from "node:assert/strict";
import { CardAutosave } from "../src/card-autosave.js";

function fixture(persist, delay = 20) {
  const statuses = [],
    errors = [];
  const save = new CardAutosave(
    { version: 0, progress: 0, title: "Aufgabe", description: "Alt" },
    {
      persist,
      delay,
      onStatus: (s) => statuses.push(s),
      onError: (e) => errors.push(e),
      onSaved() {},
    },
  );
  return { save, statuses, errors };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("immediate changes serialize versions and retain the latest queued value", async () => {
  const calls = [],
    resolve = [];
  const { save } = fixture((fields, version) => {
    calls.push({ fields, version });
    return new Promise((r) => resolve.push(r));
  });
  save.change("progress", 25);
  await tick();
  save.change("progress", 75);
  save.change("progress", 100);
  assert.equal(calls.length, 1);
  resolve.shift()(1);
  await tick();
  assert.deepEqual(calls[1], { fields: { progress: 100 }, version: 1 });
  resolve.shift()(2);
  assert.equal(await save.flush(), true);
  assert.equal(save.saved.progress, 100);
  assert.equal(save.version, 2);
  save.dispose();
});

test("text drafts wait and an immediate change does not include unfinished text", async () => {
  const calls = [];
  const { save } = fixture(async (fields, version) => {
    calls.push(fields);
    return version + 1;
  }, 100);
  save.change("description", "Noch am Schreiben", true);
  save.change("progress", 50);
  await save.flight;
  assert.deepEqual(calls, [{ progress: 50 }]);
  assert.equal(save.saved.description, "Alt");
  save.change("description", "Fertig", true);
  await save.finish("description");
  assert.deepEqual(calls[1], { description: "Fertig" });
  assert.equal(save.dirty(), false);
  save.dispose();
});

test("a typing pause saves only the final text", async () => {
  const calls = [];
  const { save } = fixture(async (fields, version) => {
    calls.push(fields);
    return version + 1;
  });
  save.change("title", "Erst", true);
  await tick();
  save.change("title", "Fertig", true);
  assert.equal(calls.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(calls, [{ title: "Fertig" }]);
  save.dispose();
});

test("closing during a request flushes a reverted field and pending text", async () => {
  let release;
  const calls = [];
  const { save } = fixture(async (fields, version) => {
    calls.push({ fields, version });
    if (!version) await new Promise((r) => (release = r));
    return version + 1;
  });
  save.change("progress", 100);
  await tick();
  save.change("progress", 0);
  save.change("title", "Vor dem Schließen", true);
  const flushed = save.flush();
  release();
  assert.equal(await flushed, true);
  assert.deepEqual(calls[1], {
    fields: { progress: 0, title: "Vor dem Schließen" },
    version: 1,
  });
  assert.equal(save.saved.progress, 0);
  save.dispose();
});

test("errors retain drafts, pause automatic retries and can be retried explicitly", async () => {
  let fail = true,
    count = 0;
  const { save, errors } = fixture(async (_fields, version) => {
    count++;
    if (fail) throw new Error("Offline");
    return version + 1;
  });
  save.change("progress", 25);
  assert.equal(await save.flight, false);
  save.change("progress", 75);
  assert.equal(await save.flush(), false);
  assert.equal(count, 1);
  assert.equal(save.saved.progress, 0);
  assert.equal(errors.length, 1);
  fail = false;
  assert.equal(await save.retry(), true);
  assert.equal(save.saved.progress, 75);
  save.dispose();
});

test("unchanged fields and cancelled timers cause no writes", async () => {
  let count = 0;
  const { save } = fixture(async () => ++count);
  save.change("progress", 0);
  await save.flush();
  save.change("title", "Unfertig", true);
  save.dispose();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(count, 0);
});
