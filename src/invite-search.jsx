import React, { useEffect, useRef, useState } from "react";
import { Search, LoaderCircle } from "lucide-react";
import { t, useLanguage } from "./i18n.js";

export function InviteUserSearch({ projectId, api, onSelect }) {
  useLanguage();
  const [query, setQuery] = useState(""),
    [results, setResults] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [active, setActive] = useState(0);
  const input = useRef();
  useEffect(() => {
    setResults([]);
    setError("");
    setActive(0);
    setBusy(false);
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const matches = await api(
          `/projects/${projectId}/invite-candidates?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        if (!cancelled) setResults(matches);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, projectId]);
  function select(user) {
    onSelect(user);
    setQuery("");
    setResults([]);
    input.current?.blur();
  }
  function keyDown(event) {
    if (event.key === "Escape") {
      setResults([]);
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(
        (index) =>
          (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) %
          results.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(results[active]);
    }
  }
  return (
    <div className="invite-search">
      <label>
        {t("Name oder E-Mail suchen")}
        <div className="input-with-icon">
          <Search size={17} />
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-label={t("Name oder E-Mail suchen")}
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls="invite-user-results"
            aria-activedescendant={
              results[active] ? `invite-user-${results[active].id}` : undefined
            }
            maxLength={100}
            value={query}
            autoComplete="off"
            placeholder={t("Mindestens 2 Zeichen eingeben …")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={keyDown}
          />
        </div>
      </label>
      {busy && (
        <p className="form-note" role="status">
          <LoaderCircle size={14} className="spin" />{" "}
          {t("Benutzer werden gesucht …")}
        </p>
      )}
      {!!results.length && (
        <ul
          id="invite-user-results"
          role="listbox"
          aria-label={t("Gefundene Benutzer")}
          className="invite-search-results"
        >
          {results.map((user, index) => (
            <li key={user.id} role="presentation">
              <button
                type="button"
                role="option"
                id={`invite-user-${user.id}`}
                aria-selected={active === index}
                tabIndex={-1}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => select(user)}
              >
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!busy && query.trim().length >= 2 && !results.length && !error && (
        <p className="form-note">
          {t(
            "Keine passenden registrierten Benutzer gefunden. Neue Personen kannst du über ihre E-Mail-Adresse einladen.",
          )}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
