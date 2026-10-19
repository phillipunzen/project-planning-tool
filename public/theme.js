// Apply the saved appearance before loading the app to avoid a light flash.
(() => {
  let design = "glass";
  try {
    const saved = localStorage.getItem("projektwerk-design");
    if (["glass", "classic"].includes(saved)) design = saved;
  } catch {
    /* Storage is optional. */
  }
  document.documentElement.dataset.design = design;
  let preference;
  try {
    preference = localStorage.getItem("projektwerk-theme");
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
  const theme = ["light", "dark"].includes(preference)
    ? preference
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  document.documentElement.dataset.theme = theme;
  const colors = {
    indigo: "#5550df",
    ocean: "#185abd",
    forest: "#146c4a",
    sunset: "#a43b12",
    rose: "#ad2859",
  };
  let colorTheme = "indigo";
  try {
    const saved = localStorage.getItem("projektwerk-color-theme");
    if (Object.hasOwn(colors, saved)) colorTheme = saved;
  } catch {
    /* Storage is optional. */
  }
  document.documentElement.dataset.colorTheme = colorTheme;
  document.documentElement.style.setProperty(
    "--pwa-accent",
    colors[colorTheme],
  );
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#111827" : "#fafbfc");
})();
