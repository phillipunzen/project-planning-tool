(() => {
  let language, name;
  try {
    language = localStorage.getItem("projektwerk-pwa-language");
    name = localStorage.getItem("projektwerk-pwa-name");
  } catch {
    /* Browser storage is optional. */
  }
  if (!["de", "en"].includes(language)) {
    const supported = (navigator.languages || [navigator.language])
      .map((value) => value.toLowerCase().split("-")[0])
      .find((value) => ["de", "en"].includes(value));
    language = supported || "en";
  }
  document.documentElement.lang = language;
  const strings =
    language === "de"
      ? [
          "Du bist gerade offline.",
          "Verbinde dich mit dem Internet, um Projekte zu öffnen und Änderungen zu speichern.",
          "Erneut versuchen",
        ]
      : [
          "You're currently offline.",
          "Connect to the internet to open projects and save changes.",
          "Try again",
        ];
  for (const [index, id] of ["title", "message", "retry"].entries()) {
    document.getElementById(id).textContent = strings[index];
  }
  if (name) document.getElementById("brand").textContent = name;
  document.title = `${name || "Projektwerk"} · Offline`;
  document
    .getElementById("retry")
    .addEventListener("click", () => location.reload());
})();
