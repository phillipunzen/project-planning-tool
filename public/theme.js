// Apply the saved appearance before loading the app to avoid a light flash.
(() => {
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
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#111827" : "#fafbfc");
})();
