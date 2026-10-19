import React, { createContext, useContext, useEffect, useState } from "react";
import { t, useLanguage } from "./i18n.js";
import { Monitor, Moon, Sun } from "lucide-react";

import { colorThemes } from "../shared/color-themes.js";
import {
  interfaceDesigns,
  defaultInterfaceDesign,
} from "../shared/interface-designs.js";

const storageKey = "projektwerk-theme";
const ThemeContext = createContext(null);
const designStorageKey = "projektwerk-design";
const validDesign = (value) =>
  interfaceDesigns.includes(value) ? value : defaultInterfaceDesign;
function readDesign() {
  try {
    return validDesign(localStorage.getItem(designStorageKey));
  } catch {
    return defaultInterfaceDesign;
  }
}
const validPreference = (value) =>
  ["light", "dark"].includes(value) ? value : "system";
function readPreference() {
  try {
    return validPreference(localStorage.getItem(storageKey));
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }) {
  const [design, setDesign] = useState(readDesign);
  useEffect(() => {
    document.documentElement.dataset.design = design;
    try {
      localStorage.setItem(designStorageKey, design);
    } catch {
      /* Storage is optional; the account preference still works. */
    }
  }, [design]);
  const [preference, setPreference] = useState(readPreference);
  const [colorTheme, setColorTheme] = useState(() => {
    try {
      const value = localStorage.getItem("projektwerk-color-theme");
      return Object.hasOwn(colorThemes, value) ? value : "indigo";
    } catch {
      return "indigo";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.colorTheme = colorTheme;
    try {
      localStorage.setItem("projektwerk-color-theme", colorTheme);
    } catch {
      /* Storage is optional. */
    }
  }, [colorTheme]);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const resolved =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#111827" : "#fafbfc");
  }, [resolved]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = (event) => setSystemDark(event.matches);
    const stored = (event) => {
      if (event.key === designStorageKey || event.key === null)
        setDesign(readDesign());
      if (event.key === storageKey || event.key === null)
        setPreference(readPreference());
      if (event.key === "projektwerk-color-theme" || event.key === null) {
        try {
          const value = localStorage.getItem("projektwerk-color-theme");
          setColorTheme(Object.hasOwn(colorThemes, value) ? value : "indigo");
        } catch {
          /* Storage is optional. */
        }
      }
    };
    media.addEventListener("change", changed);
    window.addEventListener("storage", stored);
    return () => {
      media.removeEventListener("change", changed);
      window.removeEventListener("storage", stored);
    };
  }, []);
  function changePreference(value) {
    setPreference(value);
    try {
      if (value === "system") localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, value);
    } catch {
      // Changing appearance also works when browser storage is unavailable.
    }
  }
  return (
    <ThemeContext.Provider
      value={{
        preference,
        resolved,
        changePreference,
        design,
        changeDesign: (value) => setDesign(validDesign(value)),
        colorTheme,
        changeColorTheme: (value) =>
          setColorTheme(Object.hasOwn(colorThemes, value) ? value : "indigo"),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeControl({ floating = false }) {
  useLanguage();
  const { preference, changePreference } = useContext(ThemeContext);
  const Icon =
    preference === "system" ? Monitor : preference === "dark" ? Moon : Sun;
  return (
    <label className={`theme-control ${floating ? "theme-floating" : ""}`}>
      <Icon size={16} aria-hidden="true" />
      <span className="visually-hidden">{t("Darstellung")}</span>
      <select
        aria-label={t("Darstellung")}
        value={preference}
        onChange={(event) => changePreference(event.target.value)}
      >
        <option value="system">{t("System")}</option>
        <option value="light">{t("Hell")}</option>
        <option value="dark">{t("Dunkel")}</option>
      </select>
    </label>
  );
}

export const useColorTheme = () => useContext(ThemeContext);
export function DesignChoices({ value, onChange, disabled }) {
  useLanguage();
  return (
    <fieldset className="design-choices" disabled={disabled}>
      <legend>{t("Interface-Design")}</legend>
      <div className="design-choice-grid">
        {[
          {
            id: "glass",
            label: t("Liquid Glass"),
            description: t("Licht, Tiefe und sanfte Glasflächen."),
          },
          {
            id: "classic",
            label: t("Klassisch"),
            description: t("Das vertraute Design mit klaren Flächen."),
          },
        ].map((option) => (
          <label className="design-choice" key={option.id}>
            <input
              type="radio"
              name="interface-design"
              value={option.id}
              aria-label={option.label}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <span
              className={`design-preview design-preview-${option.id}`}
              aria-hidden="true"
            >
              <i />
              <span><i /><i /><i /></span>
            </span>
            <span className="design-choice-title">
              {option.label}
              {option.id === defaultInterfaceDesign && (
                <small>{t("Standard")}</small>
              )}
            </span>
            <span className="design-choice-description">{option.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function ColorThemeChoices({ value, onChange, disabled, design }) {
  useLanguage();
  const appearance = useColorTheme();
  const selectedDesign = design || appearance.design;
  return (
    <div
      className="color-theme-choices"
      role="radiogroup"
      aria-label={t("Farbtheme")}
    >
      {Object.entries(colorThemes).map(([id, theme]) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === id}
          disabled={disabled}
          key={id}
          onClick={() => onChange(id)}
        >
          <span
            className="theme-swatch"
            style={{
              background: id === "indigo" && selectedDesign === "glass"
                ? appearance.resolved === "dark" ? "#40d6ff" : "#3c4fff"
                : theme.color,
            }}
            aria-hidden="true"
          />
          <span>{t(theme.label)}</span>
        </button>
      ))}
    </div>
  );
}
