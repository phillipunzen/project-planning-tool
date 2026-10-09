import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { projectIcons } from "../shared/project-icons.js";
import { detectLanguage, translateMessage } from "../shared/language.js";
const en = JSON.parse(fs.readFileSync(new URL("../shared/en.json", import.meta.url), "utf8"));

test("browser language selects the first supported language and handles regions", () => {
  assert.equal(detectLanguage(["de-AT", "en-GB"]), "de");
  assert.equal(detectLanguage(["en-US", "de-DE"]), "en");
  assert.equal(detectLanguage(["fr-FR", "DE-ch"]), "de");
  assert.equal(detectLanguage(["fr-FR"]), "en");
});
test("translations preserve whitespace and substitute user data without translating it", () => {
  assert.equal(translateMessage(" ", "en", en), " ");
  assert.equal(translateMessage(" Benutzer ", "en", en), " Users ");
  assert.equal(translateMessage("{0} von {1} Aufgaben erledigt", "en", en, [2, 7]), "2 of 7 tasks completed");
  assert.equal(translateMessage("Aufgabe in {0} erstellen", "en", en, ["Offen {1} <test>"]), "Create task in Offen {1} <test>");
  assert.equal(translateMessage("Aufgabe in {0} erstellen", "de", en, ["English bucket"]), "Aufgabe in English bucket erstellen");
  assert.equal(translateMessage("Custom text", "en", en), "Custom text");
});
test("stored activity is localized without changing embedded bucket names", () => {
  assert.equal(translateMessage("Fortschritt geändert: 25 % → 75 %", "en", en), "Progress changed: 25 % → 75 %");
  assert.equal(translateMessage("Status geändert: Kundenfreigabe [A+B]", "en", en), "Status changed: Kundenfreigabe [A+B]");
});
test("every static interface message has an English translation with matching placeholders", () => {
  for (const file of ["src/main.jsx", "src/theme.jsx", "src/i18n.js"]) {
    const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
    for (const match of source.matchAll(/\bt\(\s*("(?:\\.|[^"\\])*")/g)) {
      const key = JSON.parse(match[1]).trim();
      if (!key || ["projekt", "werk"].includes(key)) continue;
      assert(Object.hasOwn(en, key), `Missing translation: ${key}`);
    }
  }
  for (const label of Object.values(projectIcons)) {
    assert(Object.hasOwn(en, label), `Missing project icon translation: ${label}`);
  }
  for (const [key, value] of Object.entries(en)) {
    assert.deepEqual([...key.matchAll(/\{\d+\}/g)].map(m => m[0]).sort(), [...value.matchAll(/\{\d+\}/g)].map(m => m[0]).sort(), key);
  }
});
