import React, { useEffect, useRef, useState } from "react";
import { Copy, Plus, Trash2, X, CheckCircle2 } from "lucide-react";
import { t, useLanguage } from "./i18n.js";

const empty = () => ({
  name: "",
  title: "",
  description: "",
  priority: "medium",
  labels: [],
  checklist: [],
});
const formData = (entry) => ({
  name: entry.name || "",
  title: entry.title || "",
  description: entry.description || "",
  priority: entry.priority || "medium",
  labels: (entry.labels || []).join(", "),
  checklist: (entry.checklist || []).join("\n"),
});
const priorityLabels = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  urgent: "Dringend",
};

export function TemplatesModal({ board, seed, onClose, onChanged, api }) {
  useLanguage();
  const dialog = useRef();
  const [settings, setSettings] = useState(() => ({
    templates: board.templates || [],
    defaultTemplateId: board.defaultTemplateId,
    revision: board.templateRevision || 0,
  }));
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(() => formData(seed || empty()));
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [saved, setSaved] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    let cancelled = false;
    setBusy(true);
    api(`/boards/${board.id}/templates`)
      .then((latest) => {
        if (!cancelled) setSettings(latest);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      element.close();
    };
  }, []);
  function edit(entry) {
    setSelectedId(entry?.id || null);
    setDraft(formData(entry || empty()));
    setIsDefault(Boolean(entry && settings.defaultTemplateId === entry.id));
    setError("");
    setSaved(false);
    setConfirmDelete(false);
  }
  function field(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }
  async function reload() {
    setBusy(true);
    try {
      const latest = await api(`/boards/${board.id}`);
      setSettings({
        templates: latest.templates || [],
        defaultTemplateId: latest.defaultTemplateId,
        revision: latest.templateRevision || 0,
      });
      setSelectedId(null);
      setDraft(formData(empty()));
      setIsDefault(false);
      setConflict(false);
      setError("");
      setConfirmDelete(false);
      setSaved(false);
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function changeDefault(id) {
    setBusy(true);
    setError("");
    try {
      const updated = await api(`/boards/${board.id}/default-template`, {
        method: "PUT",
        body: { templateId: id || null, revision: settings.revision },
      });
      setSettings(updated);
      setIsDefault(
        Boolean(selectedId && updated.defaultTemplateId === selectedId),
      );
      await onChanged();
    } catch (e) {
      setError(e.message);
      setConflict(e.status === 409);
    } finally {
      setBusy(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const content = {
        ...draft,
        labels: [
          ...new Set(
            draft.labels
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ],
        checklist: draft.checklist
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
      };
      const updated = await api(
        `/boards/${board.id}/templates${selectedId ? `/${selectedId}` : ""}`,
        {
          method: selectedId ? "PATCH" : "POST",
          body: {
            ...content,
            revision: settings.revision,
            setAsDefault: isDefault,
          },
        },
      );
      setSettings(updated);
      setSelectedId(selectedId || updated.templates.at(-1).id);
      setSaved(true);
      await onChanged();
    } catch (e) {
      setError(e.message);
      setConflict(e.status === 409);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      const updated = await api(`/boards/${board.id}/templates/${selectedId}`, {
        method: "DELETE",
        body: { revision: settings.revision },
      });
      setSettings(updated);
      edit(null);
      await onChanged();
    } catch (e) {
      setError(e.message);
      setConflict(e.status === 409);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal wide templates-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2>{t("Aufgabenvorlagen")}</h2>
          <p>{t("Gemeinsame Vorlagen für {0}", [board.name])}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Schließen")}
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p className="form-note">
        {t(
          "Eine Standardvorlage gilt für alle Mitglieder dieses Boards. Bestehende Aufgaben bleiben erhalten.",
        )}
      </p>
      <label>
        {t("Board-Standard")}
        <select
          aria-label={t("Board-Standard")}
          value={settings.defaultTemplateId || ""}
          disabled={busy || conflict}
          onChange={(event) => changeDefault(event.target.value)}
        >
          <option value="">{t("Keine Standardvorlage")}</option>
          {settings.templates.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <div className="template-layout">
        <div className="template-list" aria-label={t("Gespeicherte Vorlagen")}>
          {settings.templates.map((entry) => (
            <button
              type="button"
              className={selectedId === entry.id ? "selected" : ""}
              key={entry.id}
              disabled={busy || conflict}
              onClick={() => edit(entry)}
            >
              <Copy size={16} />
              <span>
                {entry.name}
                {settings.defaultTemplateId === entry.id && (
                  <small>{t("Board-Standard")}</small>
                )}
              </span>
            </button>
          ))}
          <button
            type="button"
            disabled={busy || conflict || settings.templates.length >= 20}
            onClick={() => edit(null)}
          >
            <Plus size={17} />
            {t("Neue Vorlage")}
          </button>
        </div>
        <form onSubmit={save}>
          <fieldset disabled={busy || conflict}>
            <label>
              {t("Vorlagenname")}
              <input
                aria-label={t("Vorlagenname")}
                required
                maxLength={100}
                value={draft.name}
                onChange={(event) => field("name", event.target.value)}
              />
            </label>
            <label>
              {t("Aufgabentitel (optional)")}
              <input
                aria-label={t("Aufgabentitel (optional)")}
                maxLength={200}
                value={draft.title}
                onChange={(event) => field("title", event.target.value)}
              />
            </label>
            <label>
              {t("Beschreibung")}
              <textarea
                aria-label={t("Vorlagenbeschreibung")}
                rows={4}
                maxLength={20000}
                value={draft.description}
                onChange={(event) => field("description", event.target.value)}
              />
            </label>
            <div className="form-grid">
              <label>
                {t("Priorität")}
                <select
                  aria-label={t("Vorlagenpriorität")}
                  value={draft.priority}
                  onChange={(event) => field("priority", event.target.value)}
                >
                  {Object.entries(priorityLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Labels")}
                <input
                  aria-label={t("Vorlagenlabels")}
                  value={draft.labels}
                  onChange={(event) => field("labels", event.target.value)}
                  maxLength={250}
                />
              </label>
            </div>
            <label>
              {t("Checkliste – ein Punkt pro Zeile")}
              <textarea
                aria-label={t("Vorlagencheckliste")}
                rows={4}
                maxLength={15050}
                value={draft.checklist}
                onChange={(event) => field("checklist", event.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(event) => setIsDefault(event.target.checked)}
              />
              {t("Als Standard für dieses Board verwenden")}
            </label>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {t(error)}
            </p>
          )}
          {conflict && (
            <>
              <p className="form-note">
                {t(
                  "Das Board wurde geändert. Dein Entwurf bleibt erhalten. Beim Neuladen wird der Entwurf verworfen.",
                )}
              </p>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={reload}
              >
                {t("Aktuellen Stand laden")}
              </button>
            </>
          )}
          {saved && (
            <p className="template-saved" role="status">
              <CheckCircle2 size={16} />
              {t("Vorlage gespeichert")}
            </p>
          )}
          <div className="modal-actions">
            {selectedId && (
              <button
                type="button"
                className="button danger-text"
                disabled={busy || conflict}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={16} />
                {t("Vorlage löschen")}
              </button>
            )}
            <button
              className="button primary"
              type="submit"
              disabled={busy || conflict}
            >
              {busy ? t("Wird gespeichert …") : t("Vorlage speichern")}
            </button>
          </div>
          {confirmDelete && (
            <div className="delete-confirmation">
              <p>
                {t(
                  "Diese Vorlage löschen? Bereits angelegte Aufgaben bleiben erhalten.",
                )}
              </p>
              <button
                type="button"
                className="button danger"
                disabled={busy || conflict}
                onClick={remove}
              >
                {t("Endgültig löschen")}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setConfirmDelete(false)}
              >
                {t("Behalten")}
              </button>
            </div>
          )}
        </form>
      </div>
    </dialog>
  );
}
