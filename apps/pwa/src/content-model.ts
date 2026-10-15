import type { CanonicalPost, ContentChannel, ContentItem, ContentStatus, ContentVariant, PostStatus, PostVariant } from "./types";

const POST_STATUS: Record<string, PostStatus> = {
  draft: "draft",
  generated: "ready_for_review",
  needs_review: "ready_for_review",
  approved: "approved",
  scheduled: "scheduled",
  syncing: "publishing",
  action_required: "failed",
  published: "published",
  failed: "failed",
  canceled: "archived",
};

export function postStatus(status?: string | null): PostStatus {
  return POST_STATUS[String(status || "draft").toLowerCase()] || "draft";
}

export function variantStatus(status?: string | null): PostStatus {
  return postStatus(status);
}

export function asCanonicalPost(item: ContentItem): CanonicalPost {
  const variants = (item.variants || []).map((variant: ContentVariant) => ({
    id: variant.id,
    postId: item.id,
    channel: variant.channel as ContentChannel,
    body: variant.body || {},
    media: variant.media || [],
    status: variantStatus(variant.scheduleStatus || variant.status),
    destinationId: variant.metadata?.destinationId || null,
    publicationRunId: variant.metadata?.publicationRunId || null,
    publicationDate: variant.publicationDate || null,
    scheduleTimezone: variant.scheduleTimezone || null,
    lastError: variant.lastError || null,
  })) as PostVariant[];
  const metadata = item.metadata || {};
  const brandOs = metadata.brandOs || {};
  const brandContext = brandOs.brandContext || {};
  return {
    id: item.id,
    brandId: String(item.site_id || item.siteId || brandContext.site || ""),
    campaignId: item.batch_id || item.batchId || null,
    campaignTitle: item.planTitle && !String((item as any).campaignMetadata?.system || "").includes("inbox") ? item.planTitle : null,
    title: String(metadata.contentTitle || item.topic || "Nueva publicación"),
    topic: item.topic,
    status: postStatus(item.status),
    brandKitVersionId: brandContext.brandKitVersionId || null,
    provenance: {
      brandKitVersionId: brandContext.brandKitVersionId || null,
      brandKitSnapshotHash: brandContext.brandKitSnapshotHash || null,
      generationRunId: metadata.generationRunId || null,
      source: metadata.source || "escarlet",
      findings: brandOs.findings || [],
    },
    variants,
    generationRunId: metadata.generationRunId || null,
    createdAt: item.created_at || item.createdAt || null,
    updatedAt: item.updated_at || item.updatedAt || null,
  };
}

export function postActionLabel(status: PostStatus, t: (key: string, fallback?: string) => string): string {
  const labels: Record<PostStatus, [string, string]> = {
    draft: ["content.action.edit", "Editar"],
    generating: ["content.action.progress", "Ver progreso"],
    ready_for_review: ["content.action.review", "Revisar"],
    changes_requested: ["content.action.edit", "Editar"],
    approved: ["content.action.schedule", "Programar"],
    scheduled: ["content.action.calendar", "Ver calendario"],
    publishing: ["content.action.progress", "Ver publicación"],
    published: ["content.action.open", "Ver publicación"],
    failed: ["content.action.retry", "Reintentar"],
    archived: ["content.action.restore", "Restaurar"],
  };
  const [key, fallback] = labels[status] || labels.draft;
  return t(key, fallback);
}

export function statusTone(status?: string | null): "neutral" | "info" | "success" | "warning" | "danger" | "review" | "published" {
  switch (postStatus(status as ContentStatus)) {
    case "published": return "published";
    case "approved":
    case "scheduled": return "success";
    case "ready_for_review":
    case "changes_requested": return "review";
    case "generating":
    case "publishing": return "info";
    case "failed": return "danger";
    default: return "neutral";
  }
}
