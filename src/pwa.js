import { useSyncExternalStore } from "react";

const displayMode = matchMedia("(display-mode: standalone)");
let installed = displayMode.matches || navigator.standalone === true;
let installPrompt;
const listeners = new Set();
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener("appinstalled", () => {
  installed = true;
  installPrompt = null;
  notify();
});
displayMode.addEventListener("change", () => {
  installed = displayMode.matches || navigator.standalone === true;
  notify();
});

export const usePwaInstalled = () =>
  useSyncExternalStore(subscribe, () => installed);

export async function promptInstall() {
  if (!installPrompt) return "unavailable";
  const prompt = installPrompt;
  installPrompt = null;
  try {
    await prompt.prompt();
    return (await prompt.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}

if (
  import.meta.env.PROD &&
  window.isSecureContext &&
  "serviceWorker" in navigator
) {
  const register = () =>
    navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      .catch(() => {
        // The web app stays usable when browser policy disables service workers.
      });
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
