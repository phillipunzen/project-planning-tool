export function detectLanguage(languages = [], fallback = "en") {
  for (const language of languages) {
    const base = String(language).trim().toLowerCase().split(/[-_]/)[0];
    if (base === "de" || base === "en") return base;
  }
  return fallback;
}

const patternCache = new WeakMap();
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function patternsFor(catalog) {
  if (!patternCache.has(catalog)) {
    patternCache.set(
      catalog,
      Object.entries(catalog)
        .filter(([key]) => /\{\d+\}/.test(key))
        .map(([key, value]) => ({
          pattern: new RegExp(
            "^" +
              key
                .split(/(\{\d+\})/)
                .map((part) =>
                  /^\{\d+\}$/.test(part) ? "([\\s\\S]*?)" : escapeRegex(part),
                )
                .join("") +
              "$",
          ),
          value,
        })),
    );
  }
  return patternCache.get(catalog);
}
export function translateMessage(message, language, catalog, params) {
  if (typeof message !== "string") return message;
  const key = message.trim();
  if (!key) return message;
  let translated = language === "en" ? (catalog[key] ?? key) : key;
  // Stored system activity and backend errors are translated for each reader.
  if (language === "en" && !catalog[key] && params === undefined) {
    for (const { pattern, value } of patternsFor(catalog)) {
      const matched = key.match(pattern);
      if (matched) {
        translated = value;
        params = matched.slice(1);
        break;
      }
    }
  }
  if (params !== undefined)
    translated = translated.replace(/\{(\d+)\}/g, (token, index) =>
      params[index] === undefined ? token : String(params[index]),
    );
  return (
    message.slice(0, message.length - message.trimStart().length) +
    translated +
    message.slice(message.trimEnd().length)
  );
}
