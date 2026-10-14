import React, { useEffect, useRef, useState } from "react";
import { Copy, KeyRound, Plus, X } from "lucide-react";
import { t, useLanguage, getLocale } from "./i18n.js";
export function ApiAccessModal({ api, onClose }) {
  useLanguage();
  const dialog = useRef();
  const [tokens, setTokens] = useState([]),
    [boards, setBoards] = useState([]),
    [name, setName] = useState(""),
    [mode, setMode] = useState("read"),
    [boardIds, setBoardIds] = useState([]),
    [days, setDays] = useState(90),
    [secret, setSecret] = useState(""),
    [secretId, setSecretId] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const url = `${location.origin}/api/v1`;
  async function load() {
    const [entries, available] = await Promise.all([
      api("/me/api-tokens"),
      api("/me/api-token-boards"),
    ]);
    setTokens(entries);
    setBoards(available);
  }
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    let active = true;
    Promise.all([api("/me/api-tokens"), api("/me/api-token-boards")])
      .then(([entries, available]) => {
        if (active) {
          setTokens(entries);
          setBoards(available);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      element.close();
    };
  }, []);
  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const result = await api("/me/api-tokens", {
        method: "POST",
        body: {
          name,
          mode,
          boardIds,
          expiresInDays: days === "unlimited" ? null : Number(days),
        },
      });
      setSecret(result.token);
      setSecretId(result.id);
      setName("");
      setBoardIds([]);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id) {
    setBusy(true);
    setError("");
    try {
      await api(`/me/api-tokens/${id}`, { method: "DELETE" });
      if (id === secretId) setSecret("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setError(t("Bitte kopiere den API-Token aus dem Textfeld."));
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal wide api-access-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2>{t("API-Zugriff")}</h2>
          <p>
            {t("Verbinde KI und andere Anwendungen mit ausgewählten Boards.")}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label={t("Schließen")}
          type="button"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p className="form-note">
        {t(
          "Tokens gelten nur für die gewählten Boards und deine aktuellen Projektberechtigungen.",
        )}
      </p>
      <label>
        {t("API-Adresse")}
        <input readOnly value={url} aria-label={t("API-Adresse")} />
      </label>
      <a
        className="text-button"
        href="/api/integration/openapi.json"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("OpenAPI-Dokumentation öffnen")}
      </a>
      <a
        className="text-button swagger-docs-link"
        href="/api/docs"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("Swagger API-Dokumentation öffnen")}
      </a>
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      {secret && (
        <section className="api-created-token">
          <h3>{t("Dein neuer API-Token")}</h3>
          <p>{t("Kopiere den Token jetzt. Er wird nur einmal angezeigt.")}</p>
          <div className="api-token-copy">
            <input
              readOnly
              aria-label={t("Neuer API-Token")}
              value={secret}
              onFocus={(event) => event.target.select()}
            />
            <button className="button secondary" type="button" onClick={copy}>
              <Copy size={16} />
              {copied ? t("Kopiert") : t("Kopieren")}
            </button>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => setSecret("")}
          >
            {t("Token ausblenden")}
          </button>
        </section>
      )}
      <form onSubmit={create}>
        <fieldset disabled={busy}>
          <h3>{t("Neuen API-Token erstellen")}</h3>
          <label>
            {t("Tokenname")}
            <input
              required
              maxLength={100}
              aria-label={t("Tokenname")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("z. B. KI-Assistent")}
            />
          </label>
          <div className="form-grid">
            <label>
              {t("Berechtigung")}
              <select
                aria-label={t("API-Berechtigung")}
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value);
                  if (event.target.value === "write")
                    setBoardIds((ids) =>
                      ids.filter((id) =>
                        boards.some(
                          (board) => board.id === id && board.canEdit,
                        ),
                      ),
                    );
                }}
              >
                <option value="read">{t("Nur lesen")}</option>
                <option value="write">
                  {t("Lesen und Aufgaben bearbeiten")}
                </option>
              </select>
            </label>
            <label>
              {t("Gültigkeit")}
              <select
                aria-label={t("Token-Gültigkeit")}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              >
                <option value="unlimited">{t("Unbegrenzt")}</option>
                {[7, 30, 90, 365].map((value) => (
                  <option key={value} value={value}>
                    {t("{0} Tage", [value])}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <h4>{t("Freigegebene Boards")}</h4>
          <div className="api-board-list">
            {boards.map((board) => (
              <label className="checkbox-label" key={board.id}>
                <input
                  type="checkbox"
                  checked={boardIds.includes(board.id)}
                  disabled={mode === "write" && !board.canEdit}
                  onChange={(event) =>
                    setBoardIds((ids) =>
                      event.target.checked
                        ? [...ids, board.id]
                        : ids.filter((id) => id !== board.id),
                    )
                  }
                />
                <span>
                  {board.project} · {board.name}
                  {!board.canEdit && <small> · {t("Nur lesen")}</small>}
                </span>
              </label>
            ))}
          </div>
          {!boards.length && (
            <p className="form-note">
              {t(
                "Du benötigst Zugriff auf ein Board, um einen Token zu erstellen.",
              )}
            </p>
          )}
          <button
            className="button primary"
            type="submit"
            disabled={
              !boardIds.length ||
              tokens.filter(
                (token) =>
                  !token.revokedAt &&
                  (token.expiresAt === null ||
                    new Date(token.expiresAt) > new Date()),
              ).length >= 20
            }
          >
            <Plus size={16} />
            {busy ? t("Wird erstellt …") : t("API-Token erstellen")}
          </button>
        </fieldset>
      </form>
      <section className="api-token-list">
        <h3>{t("Deine API-Tokens")}</h3>
        {tokens.map((token) => {
          const active =
            !token.revokedAt &&
            (token.expiresAt === null ||
              new Date(token.expiresAt) > new Date());
          return (
            <div key={token.id} className="api-token-row">
              <KeyRound size={18} />
              <div>
                <strong>{token.name}</strong>
                <span>
                  {t(
                    token.mode === "read"
                      ? "Nur lesen"
                      : "Lesen und Aufgaben bearbeiten",
                  )}{" "}
                  · {t("{0} Boards", [token.boardIds.length])}
                </span>
                <small>
                  {token.boardIds
                    .map((id) => {
                      const board = boards.find((entry) => entry.id === id);
                      return board
                        ? `${board.project} · ${board.name}`
                        : t("Board nicht mehr verfügbar");
                    })
                    .join(", ")}
                </small>
                <small>
                  {token.revokedAt
                    ? t("Token ist widerrufen")
                    : !active
                      ? t("Abgelaufen")
                      : token.expiresAt === null
                        ? t("Unbegrenzt")
                        : t("Gültig bis {0}", [
                            new Date(token.expiresAt).toLocaleDateString(
                              getLocale(),
                            ),
                          ])}
                </small>
              </div>
              {active && (
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => revoke(token.id)}
                >
                  {t("Widerrufen")}
                </button>
              )}
            </div>
          );
        })}
        {!tokens.length && (
          <p className="form-note">{t("Noch keine API-Tokens erstellt.")}</p>
        )}
      </section>
      <div className="modal-actions">
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={onClose}
        >
          {t("Schließen")}
        </button>
      </div>
    </dialog>
  );
}
