import type { ContentItem, ContentStatus } from "./types";

export const CONTENT_TITLE_MAX = 72;

export function contentTitle(value: unknown, fallback = "Publicación") {
  const clean = String(value || "")
    .replace(/\r?\n+/g, " ")
    .replace(/^\s*(?:título|title|brief|tema|enfoque|contexto|objetivo)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return fallback;
  const first = clean.split(/\b(?:enfoque|contexto|objetivo|idea central|brief)\s*:/i)[0].split(/[.!?]\s+/)[0].replace(/[.!?]+$/, "").trim();
  if (first.length <= CONTENT_TITLE_MAX) return first;
  return `${first.slice(0, CONTENT_TITLE_MAX - 1).replace(/\s+\S*$/, "").trim()}…`;
}

export function itemTitle(item: ContentItem) {
  return contentTitle(item.metadata?.contentTitle, contentTitle(item.topic));
}

export function socialPackPath(item: ContentItem) {
  const slug = itemTitle(item).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return "/social-pack/" + encodeURIComponent(slug || "social-pack") + "?itemId=" + encodeURIComponent(item.id) + "&batchId=" + encodeURIComponent(String(item.batchId || item.batch_id || ""));
}

export const statusLabels: Record<string, string> = {
  draft: "Borrador",
  generated: "Generado",
  needs_review: "Requiere revisión",
  approved: "Aprobado",
  scheduled: "Programado",
  syncing: "Sincronizando",
  action_required: "Requiere acción",
  published: "Publicado",
  failed: "Con error",
  canceled: "Cancelado",
};

export function statusLabel(status?: ContentStatus | string) {
  return statusLabels[String(status || "draft")] || String(status || "Borrador").replace(/_/g, " ");
}

export function aggregateStatus(item: ContentItem): ContentStatus {
  const statuses = (item.variants || []).map((variant) => variant.scheduleStatus || variant.status).filter(Boolean);
  if (statuses.includes("action_required")) return "action_required";
  if (statuses.includes("failed")) return "failed";
  if (statuses.length && statuses.every((status) => status === statuses[0])) return statuses[0] as ContentStatus;
  if (statuses.includes("scheduled") || statuses.includes("syncing")) return "scheduled";
  if (statuses.includes("approved")) return "approved";
  return item.status;
}
