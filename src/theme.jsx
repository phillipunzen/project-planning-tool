import React, { createContext, useContext, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

const storageKey = "projektwerk-theme";
const ThemeContext = createContext(null);
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
  const [preference, setPreference] = useState(readPreference);
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
      if (event.key === storageKey || event.key === null)
        setPreference(readPreference());
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
    <ThemeContext.Provider value={{ preference, changePreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeControl({ floating = false }) {
  const { preference, changePreference } = useContext(ThemeContext);
  const Icon =
    preference === "system" ? Monitor : preference === "dark" ? Moon : Sun;
  return (
    <label className={`theme-control ${floating ? "theme-floating" : ""}`}>
      <Icon size={16} aria-hidden="true" />
      <span className="visually-hidden">Darstellung</span>
      <select
        aria-label="Darstellung"
        value={preference}
        onChange={(event) => changePreference(event.target.value)}
      >
        <option value="system">System</option>
        <option value="light">Hell</option>
        <option value="dark">Dunkel</option>
      </select>
    </label>
  );
}
