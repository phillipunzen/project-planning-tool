import { createRequire } from "node:module";
import { detectLanguage, translateMessage } from "../shared/language.js";
const en = createRequire(import.meta.url)("../shared/en.json");
export function requestLanguage(req) {
  if (["de", "en"].includes(req.user?.language)) return req.user.language;
  const languages = (req.get("accept-language") || "")
    .split(",")
    .map((part) => {
      const [language, quality] = part.trim().split(";q=");
      return { language, quality: quality === undefined ? 1 : Number(quality) };
    })
    .filter((item) => item.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  return detectLanguage(
    languages.map((item) => item.language),
    "de",
  );
}
export const translateForRequest = (req, message) =>
  translateMessage(message, requestLanguage(req), en);

export const translateForLanguage = (language, message) =>
  translateMessage(message, language, en);
