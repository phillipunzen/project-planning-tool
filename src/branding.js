import { useSyncExternalStore } from "react";
let brand = { name: "Projektwerk", logoUrl: null, logoMime: null };
const listeners = new Set();
export const getBranding = () => brand;
export function setBranding(value) {
  if (!value) return;
  brand = value;
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) {
    favicon.href = brand.logoUrl || "/favicon.svg";
    favicon.type = brand.logoMime || "image/svg+xml";
  }
  document.dispatchEvent(new Event("brandingchange"));
  for (const listener of listeners) listener();
}
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useBranding = () => useSyncExternalStore(subscribe, getBranding);
