export const pwaIcons = [
  {
    src: "/icons/icon-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

export const offlineAssets = [
  "/offline.html",
  "/offline.css",
  "/offline.js",
  "/theme.js",
  "/favicon.svg",
  "/icons/apple-touch-icon.png",
  ...pwaIcons.map((icon) => icon.src),
];

export function appManifest(name) {
  return {
    id: "/",
    name,
    short_name: name,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fafbfc",
    theme_color: "#4f46e5",
    prefer_related_applications: false,
    icons: pwaIcons,
  };
}
