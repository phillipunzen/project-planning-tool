import React, { useState } from "react";
import { Inbox, Check, X, RefreshCw, Shield } from "lucide-react";
import { t, useLanguage, getLocale } from "./i18n.js";
export function InvitationInbox({
  invitations,
  error,
  api,
  onRefresh,
  onAccepted,
}) {
  useLanguage();
  const [busy, setBusy] = useState(null),
    [actionError, setActionError] = useState("");
  async function decide(invitation, accept) {
    setBusy(invitation.id);
    setActionError("");
    try {
      const result = await api(
        `/invitations/${invitation.id}/${accept ? "accept" : "decline"}`,
        { method: "POST", body: {} },
      );
      await onRefresh();
      if (accept) await onAccepted(result.projectId);
    } catch (e) {
      setActionError(e.message);
      await onRefresh().catch(() => {});
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="invitations-inbox">
      <div className="invitations-inbox-heading">
        <div>
          <span className="eyebrow">{t("DEIN ARBEITSBEREICH")}</span>
          <h1>{t("Einladungen")}</h1>
          <p>{t("Deine Projekteinladungen erscheinen direkt hier.")}</p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={Boolean(busy)}
          onClick={() => onRefresh().catch((e) => setActionError(e.message))}
        >
          <RefreshCw size={16} />
          {t("Aktualisieren")}
        </button>
      </div>
      {(actionError || error) && (
        <p className="form-error" role="alert">
          {t(actionError || error)}
        </p>
      )}
      {!invitations.length && !error && (
        <div className="invitations-empty">
          <Inbox size={32} />
          <h2>{t("Keine offenen Einladungen")}</h2>
          <p>
            {t(
              "Sobald dich jemand einlädt, kannst du die Einladung hier annehmen oder ablehnen.",
            )}
          </p>
        </div>
      )}
      <div className="inbox-list">
        {invitations.map((entry) => (
          <article key={entry.id} className="inbox-invitation">
            <div
              className="inbox-project-icon"
              style={{ background: entry.project.color }}
            >
              <Inbox size={22} />
            </div>
            <div className="inbox-invitation-content">
              <h2>{entry.project.name}</h2>
              {entry.inviter && (
                <p>{t("Eingeladen von {0}", [entry.inviter.name])}</p>
              )}
              <span>
                <Shield size={14} />
                {t(entry.role === "editor" ? "Kann bearbeiten" : "Kann lesen")}
              </span>
              <small>
                {t("Gültig bis {0}", [
                  new Date(entry.expiresAt).toLocaleString(getLocale(), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                ])}
              </small>
            </div>
            <div className="inbox-invitation-actions">
              <button
                className="button secondary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => decide(entry, false)}
              >
                <X size={16} />
                {t("Ablehnen")}
              </button>
              <button
                className="button primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => decide(entry, true)}
              >
                <Check size={16} />
                {busy === entry.id ? t("Wird verarbeitet …") : t("Annehmen")}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
