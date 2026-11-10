// apps/web/lib/labels.ts
export function aiRole(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("extract")) return "Extraction";
  if (m.includes("vision")) return "Vision";
  if (m.includes("reason")) return "Reasoning";
  return model;
}
