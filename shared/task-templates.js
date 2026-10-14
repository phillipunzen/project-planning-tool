export function checklistId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function templateCardFields(template, makeId = checklistId) {
  return {
    title: template?.title || "",
    description: template?.description || "",
    priority: template?.priority || "medium",
    progress: 0,
    labels: [...(template?.labels || [])],
    checklist: (template?.checklist || []).map((text) => ({
      id: makeId(),
      text,
      done: false,
    })),
  };
}

// Current definitions remain live; historical definitions preserve removed values.
export function resolveCustomFields(current = [], historical = []) {
  const live = current.map((field) => {
    const old = historical.find((entry) => entry.id === field.id);
    return {
      ...field,
      options: [
        ...(field.options || []),
        ...(old?.options || [])
          .filter(
            (option) =>
              !(field.options || []).some((entry) => entry.id === option.id),
          )
          .map((option) => ({ ...option, archived: true })),
      ],
    };
  });
  return [
    ...live,
    ...historical
      .filter((field) => !current.some((entry) => entry.id === field.id))
      .map((field) => ({ ...field, archived: true })),
  ];
}
