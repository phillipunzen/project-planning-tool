import { useSyncExternalStore } from "react";
import en from "../shared/en.json";
import { detectLanguage, translateMessage } from "../shared/language.js";

let preference = "system";
const browserLanguage = () =>
  detectLanguage(
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
let language = browserLanguage();
const listeners = new Set();
export const getLocale = () => (language === "de" ? "de-DE" : "en-GB");
export const getLanguage = () => language;
export const t = (message, params) =>
  translateMessage(message, language, en, params);
function applyLanguage() {
  document.documentElement.lang = language;
  document.title = t("Projektwerk · Gemeinsam mehr bewegen");
}
export function setLanguagePreference(value) {
  preference = ["de", "en"].includes(value) ? value : "system";
  const next = preference === "system" ? browserLanguage() : preference;
  if (next !== language) {
    language = next;
    applyLanguage();
    for (const listener of listeners) listener();
  }
}
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useLanguage = () => useSyncExternalStore(subscribe, getLanguage);
window.addEventListener("languagechange", () =>
  setLanguagePreference(preference),
);
applyLanguage();
