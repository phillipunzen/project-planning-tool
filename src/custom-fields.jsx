import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { t } from "./i18n.js";
import { checklistId } from "../shared/task-templates.js";

const types = {
  text: "Text",
  number: "Zahl",
  date: "Datum",
  dropdown: "Dropdown",
};
export function CustomFieldsEditor({ fields, onChange, existingIds = [] }) {
  const change = (id, values) =>
    onChange(
      fields.map((field) =>
        field.id === id ? { ...field, ...values } : field,
      ),
    );
  return (
    <section className="custom-fields-editor">
      <h3>{t("Eigene Felder")}</h3>
      <p className="form-note">
        {t(
          "Felder und Dropdown-Optionen gelten auch für bestehende Aufgaben dieser Vorlage.",
        )}
      </p>
      {fields.map((field, index) => (
        <div key={field.id} className="custom-field-definition">
          <div className="form-grid">
            <label>
              {t("Feldname")}
              <input
                aria-label={t("Feldname {0}", [index + 1])}
                required
                maxLength={100}
                value={field.name}
                onChange={(event) =>
                  change(field.id, { name: event.target.value })
                }
              />
            </label>
            <label>
              {t("Feldtyp")}
              <select
                aria-label={t("Feldtyp {0}", [index + 1])}
                value={field.type}
                disabled={existingIds.includes(field.id)}
                onChange={(event) =>
                  change(field.id, { type: event.target.value, options: [] })
                }
              >
                {Object.entries(types).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {field.type === "dropdown" && (
            <div className="custom-field-options">
              {field.options.map((option, optionIndex) => (
                <div className="custom-option-row" key={option.id}>
                  <input
                    required
                    aria-label={t("Option {0} für Feld {1}", [
                      optionIndex + 1,
                      index + 1,
                    ])}
                    maxLength={100}
                    value={option.label}
                    onChange={(event) =>
                      change(field.id, {
                        options: field.options.map((entry) =>
                          entry.id === option.id
                            ? { ...entry, label: event.target.value }
                            : entry,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Option {0} entfernen", [optionIndex + 1])}
                    onClick={() =>
                      change(field.id, {
                        options: field.options.filter(
                          (entry) => entry.id !== option.id,
                        ),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button secondary"
                disabled={field.options.length >= 50}
                onClick={() =>
                  change(field.id, {
                    options: [
                      ...field.options,
                      { id: checklistId(), label: "" },
                    ],
                  })
                }
              >
                <Plus size={16} />
                {t("Option hinzufügen")}
              </button>
            </div>
          )}
          <button
            type="button"
            className="text-button danger-text"
            onClick={() =>
              onChange(fields.filter((entry) => entry.id !== field.id))
            }
          >
            <Trash2 size={16} />
            {t("Feld entfernen")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button secondary"
        disabled={fields.length >= 20}
        onClick={() =>
          onChange([
            ...fields,
            { id: checklistId(), name: "", type: "text", options: [] },
          ])
        }
      >
        <Plus size={16} />
        {t("Feld hinzufügen")}
      </button>
    </section>
  );
}

export function CustomTaskFields({
  fields,
  values,
  onChange,
  onFinish,
  onRefresh,
}) {
  if (!fields.length) return null;
  return (
    <section className="custom-task-fields">
      <h3>{t("Eigene Felder")}</h3>
      {fields.map((field) => {
        const value = values[field.id] ?? "";
        const props = {
          "aria-label": field.name,
          value,
          disabled: Boolean(field.archived),
        };
        return (
          <label key={field.id}>
            {field.name}
            {field.archived && (
              <span className="label-hint"> · {t("Aus Vorlage entfernt")}</span>
            )}
            {field.type === "dropdown" ? (
              <select
                {...props}
                onFocus={onRefresh}
                onChange={(event) =>
                  onChange(field.id, event.target.value || null)
                }
              >
                <option value="">{t("Keine Auswahl")}</option>
                {(field.options || [])
                  .filter((option) => !option.archived || option.id === value)
                  .map((option) => (
                    <option
                      key={option.id}
                      value={option.id}
                      disabled={Boolean(option.archived)}
                    >
                      {option.label}
                      {option.archived ? ` · ${t("Entfernt")}` : ""}
                    </option>
                  ))}
              </select>
            ) : (
              <input
                {...props}
                type={
                  field.type === "number"
                    ? "number"
                    : field.type === "date"
                      ? "date"
                      : "text"
                }
                step={field.type === "number" ? "any" : undefined}
                maxLength={field.type === "text" ? 5000 : undefined}
                onChange={(event) =>
                  onChange(
                    field.id,
                    event.target.value === ""
                      ? null
                      : field.type === "number"
                        ? Number(event.target.value)
                        : event.target.value,
                    field.type !== "date",
                  )
                }
                onBlur={onFinish}
              />
            )}
          </label>
        );
      })}
    </section>
  );
}
