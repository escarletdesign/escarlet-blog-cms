import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { asCanonicalPost, postActionLabel, statusTone } from "../../content-model";
import type { CanonicalPost, ContentChannel, ContentItem, ContentVariant, PostVariant } from "../../types";
import { Badge, Button, Card, ChannelBadge, Drawer, EmptyState, Field, IconButton, Inline, Modal, PageHeader, Select, Stack, StatusBadge, Tabs, Textarea, TextField } from "../../ui";
import { useApp, useI18n, useToast } from "../../app/context";

const channels: ContentChannel[] = ["blog", "instagram", "instagram_story", "linkedin", "x", "video"];
const channelNameFallbacks: Record<string, string> = {
  blog: "Blog",
  instagram: "Instagram",
  instagram_story: "Instagram Story",
  linkedin: "LinkedIn",
  x: "X",
  video: "Vídeo"
};

function channelName(channel: string, t: (key: string, fallback?: string) => string) {
  return t(`channel.${channel}`, channelNameFallbacks[channel] || channel);
}

function bodyText(variant?: ContentVariant | null) {
  const body = variant?.body || {};
  const socialPack = body.socialPack && typeof body.socialPack === "object" ? body.socialPack : {};
  if (variant?.channel === "instagram") {
    return String(socialPack.instagramCaption || socialPack.caption || body.caption || body.text || body.body || body.topic || "");
  }
  if (variant?.channel === "instagram_story") {
    const story = socialPack.instagramStory && typeof socialPack.instagramStory === "object" ? socialPack.instagramStory : {};
    return String(story.text || story.caption || body.text || body.caption || body.topic || "");
  }
  if (variant?.channel === "video") {
    return String(body.publishCopy || body.caption || body.text || socialPack.videoCaption || socialPack.videoCopy || body.videoScript || body.script || "");
  }
  return String(body.text || body.caption || body.body || body.bodyHtml || "");
}

function variantTitle(variant: ContentVariant, fallback: string) {
  return String(variant.body?.title || fallback);
}

function mediaUrl(media: NonNullable<ContentVariant["media"]>[number]) {
  const value = media.thumbUrl || media.previewUrl || media.url || media.publicUrl || media.path || "";
  return String(value).startsWith("/") || /^https?:\/\//i.test(String(value)) ? String(value) : "";
}

function mediaIsVideo(media: NonNullable<ContentVariant["media"]>[number]) {
  const type = String(media.contentType || media.kind || media.metadata?.mimeType || "").toLowerCase();
  return type.includes("video") || /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(mediaUrl(media));
}

function previewMediaUrl(value: unknown) {
  const media = value && typeof value === "object" ? value as Record<string, any> : null;
  const candidate = media
    ? [media.previewUrl, media.previewPath, media.url, media.publicUrl, media.imageUrl, media.imagePreviewUrl, media.path, media.src].find(Boolean)
    : value;
  const url = String(candidate || "").trim();
  return url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "";
}

function previewMediaIsVideo(media: Record<string, any>) {
  const type = String(media.contentType || media.kind || media.mimeType || media.metadata?.mimeType || "").toLowerCase();
  return type.includes("video") || /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(previewMediaUrl(media));
}

function socialPackFor(variant: PostVariant) {
  return variant.body?.socialPack && typeof variant.body.socialPack === "object" ? variant.body.socialPack : {};
}

function variantCopy(variant: PostVariant) {
  return bodyText(variant).trim();
}

function bodyWithCopy(variant: PostVariant, body: Record<string, any>, copy: string) {
  const next = { ...body };
  if (variant.channel === "instagram") {
    const socialPack = socialPackFor(variant);
    const key = Object.prototype.hasOwnProperty.call(socialPack, "instagramCaption") || !Object.prototype.hasOwnProperty.call(socialPack, "caption") ? "instagramCaption" : "caption";
    next.socialPack = { ...socialPack, [key]: copy };
  } else if (variant.channel === "instagram_story") {
    const socialPack = socialPackFor(variant);
    const story = socialPack.instagramStory && typeof socialPack.instagramStory === "object" ? socialPack.instagramStory : {};
    const key = Object.prototype.hasOwnProperty.call(story, "text") || !Object.prototype.hasOwnProperty.call(story, "caption") ? "text" : "caption";
    next.socialPack = { ...socialPack, instagramStory: { ...story, [key]: copy } };
  } else if (variant.channel === "video") {
    if (Object.prototype.hasOwnProperty.call(next, "publishCopy")) next.publishCopy = copy;
    else if (Object.prototype.hasOwnProperty.call(next, "caption")) next.caption = copy;
    else next.text = copy;
  } else if (variant.channel !== "blog") {
    next.text = copy;
  }
  return next;
}

function previewItemsFor(variant: PostVariant) {
  const media = Array.isArray(variant.media) ? variant.media : [];
  const socialPack = socialPackFor(variant);
  if (variant.channel === "instagram" && Array.isArray(socialPack.instagramSlides) && socialPack.instagramSlides.length) {
    return socialPack.instagramSlides.map((slide: Record<string, any>, index: number) => ({ ...(media[index] || {}), ...slide }));
  }
  if (variant.channel === "instagram_story") {
    const story = socialPack.instagramStory && typeof socialPack.instagramStory === "object" ? socialPack.instagramStory : {};
    const frames = Array.isArray(story.frames) ? story.frames : [];
    if (frames.length) return frames.map((frame: Record<string, any>, index: number) => ({ ...(media[index] || {}), ...frame }));
    if (story.imageUrl || story.url || story.image) return [{ ...(media[0] || {}), ...story }];
  }
  if (variant.channel === "video") {
    const body = variant.body || {};
    const source = body.videoUrl || body.videoPreviewUrl || body.url;
    return source ? [{ url: source, contentType: "video/mp4" }] : [];
  }
  return media;
}

function campaignLabel(item: ContentItem) {
  return String(item.planTitle || "").toLowerCase().includes("inbox editorial") ? "Sin campaña" : item.planTitle || "Sin campaña";
}

export function ContentInbox() {
  const { site } = useApp();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { campaignId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = searchParams.get("q") || "";
  const status = searchParams.get("status") || "all";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api.contentItems(site, controller.signal, { query, status: status === "all" ? undefined : status, batchId: campaignId })
      .then((result) => setItems(result.items || []))
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("common.error")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [site, query, status, campaignId, t]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  };

  return (
    <main className="ui-page v3-content-page">
      <PageHeader
        eyebrow={t("content.eyebrow", "Espacio editorial")}
        title={t("content.title", "Contenido")}
        description={t("content.description", "Revisa cada Post y sus variantes por canal desde un solo lugar.")}
        actions={<Button onClick={() => navigate("/apps")}>{t("content.create", "Crear contenido")}</Button>}
      />
      <div className="v3-content-filters" role="search" aria-label={t("content.filters", "Filtros de contenido")}>
        <TextField value={query} onChange={(event) => updateFilter("q", event.target.value)} placeholder={t("content.search", "Buscar Posts")} aria-label={t("content.search", "Buscar Posts")} />
        <Select value={status} onChange={(event) => updateFilter("status", event.target.value)} aria-label={t("content.statusFilter", "Filtrar por estado")}>
          <option value="all">{t("content.allStatuses", "Todos los estados")}</option>
          <option value="draft">{t("content.status.draft", "Borrador")}</option>
          <option value="needs_review">{t("content.status.review", "Listo para revisar")}</option>
          <option value="approved">{t("content.status.approved", "Aprobado")}</option>
          <option value="scheduled">{t("content.status.scheduled", "Programado")}</option>
          <option value="published">{t("content.status.published", "Publicado")}</option>
          <option value="failed">{t("content.status.failed", "Necesita atención")}</option>
        </Select>
      </div>
      {loading && <div className="v3-content-grid" role="status" aria-live="polite"><Card><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" /></Card><Card><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" /></Card></div>}
      {!loading && error && <Card className="v3-state-card"><p className="ui-field-error" role="alert">{error}</p><Button variant="secondary" onClick={() => updateFilter("refresh", String(Date.now()))}>{t("common.retry", "Reintentar")}</Button></Card>}
      {!loading && !error && !items.length && <EmptyState title={t("content.empty.title", "No hay Posts todavía")} description={t("content.empty.description", "Crea contenido desde una receta o conecta una IA externa mediante MCP.")} action={<Button onClick={() => navigate("/apps")}>{t("content.empty.action", "Explorar creación")}</Button>} />}
      {!loading && !error && items.length > 0 && <div className="v3-content-grid">
        {items.map((item) => {
          const canonical = asCanonicalPost(item);
          return <Link className="v3-post-card" to={`/content/${encodeURIComponent(item.id)}`} key={item.id}>
            <div className="v3-post-card-head"><Badge tone="neutral">{campaignLabel(item)}</Badge><StatusBadge status={canonical.status} /></div>
            <h2>{canonical.title}</h2>
            <p>{String(item.topic || "").slice(0, 180)}</p>
            <div className="v3-post-card-foot"><span>{canonical.variants.length} {canonical.variants.length === 1 ? t("content.variant.one", "variante") : t("content.variant.many", "variantes")}</span><span>{canonical.variants.map((variant) => channelName(variant.channel, t)).join(" · ")}</span></div>
          </Link>;
        })}
      </div>}
    </main>
  );
}

export function PostWorkspace() {
  const { postId = "" } = useParams();
  const { site, session } = useApp();
  const { t } = useI18n();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [post, setPost] = useState<CanonicalPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeChannel, setActiveChannel] = useState<ContentChannel>("blog");
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  const load = () => {
    if (!postId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api.contentItem(postId, site, controller.signal)
      .then(({ item }) => {
        const next = asCanonicalPost(item);
        setPost(next);
        const first = next.variants.find((variant) => variant.channel === activeChannel) || next.variants[0];
        if (first) {
          setActiveChannel(first.channel);
          setDraft(bodyText(first));
          setTitle(variantTitle(first, next.title));
        }
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("common.error")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  };

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [postId, site]);

  const activeVariant = useMemo(() => post?.variants.find((variant) => variant.channel === activeChannel) || post?.variants[0] || null, [post, activeChannel]);
  const canApprove = [session.role, session.workspaceRole].some((role) => ["owner", "admin", "approver"].includes(String(role || "").toLowerCase()));
  const canEdit = [session.role, session.workspaceRole].some((role) => ["owner", "admin", "editor"].includes(String(role || "").toLowerCase()));

  const selectChannel = (channel: ContentChannel) => {
    const variant = post?.variants.find((item) => item.channel === channel);
    if (!variant) return;
    setActiveChannel(channel);
    setDraft(bodyText(variant));
    setTitle(variantTitle(variant, post?.title || ""));
  };

  const save = async (readyForReview = false) => {
    if (!post || !activeVariant) return;
    setSaving(true);
    try {
      const body = { ...(activeVariant.body || {}) };
      if (activeChannel === "blog") {
        body.title = title;
        body.bodyHtml = draft;
      }
      const nextBody = activeChannel === "blog" ? body : bodyWithCopy(activeVariant, body, draft);
      const updated = await api.updateContentItem(post.id, { site, channel: activeVariant.channel, body: nextBody, contentTitle: title, readyForReview, reviewChannels: readyForReview ? [activeVariant.channel] : undefined });
      showToast(readyForReview && updated.status !== "approved" ? t("content.toast.review", "Post enviado a revisión") : readyForReview ? t("content.toast.approved", "Post aprobado") : t("content.toast.saved", "Cambios guardados"));
      load();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("common.error"), "error");
    } finally { setSaving(false); }
  };

  const approve = async () => {
    if (!post) return;
    setSaving(true);
    try {
      await api.approveContent(post.id, site);
      showToast(t("content.toast.approved", "Post aprobado"));
      load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("common.error"), "error"); }
    finally { setSaving(false); }
  };

  const schedule = async () => {
    if (!post || !scheduleAt) return;
    setSaving(true);
    try {
      await api.scheduleContent(post.id, new Date(scheduleAt).toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone, site, post.variants.map((variant) => variant.channel));
      showToast(t("content.toast.scheduled", "Post programado"));
      load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("common.error"), "error"); }
    finally { setSaving(false); }
  };

  const archivePost = async () => {
    if (!post) return;
    setSaving(true);
    try {
      await api.archiveContent(post.id, site);
      showToast(t("content.toast.archived", "Post eliminado de la bandeja."));
      navigate("/content");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("common.error"), "error");
    } finally {
      setSaving(false);
      setDeleteOpen(false);
    }
  };

  const removeMedia = async (mediaId: string) => {
    if (!post || !activeVariant || !mediaId || mediaId === "undefined") return;
    setMediaBusy(true);
    try {
      await api.updateContentItem(post.id, { site, channel: activeVariant.channel, mediaAssetIds: activeVariant.media.filter((media) => media.id !== mediaId).map((media) => String(media.id)).filter(Boolean) });
      showToast(t("content.toast.mediaRemoved", "Imagen retirada de la variante."));
      load();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("common.error"), "error");
    } finally {
      setMediaBusy(false);
    }
  };

  const syncRemoteStatus = async () => {
    setSyncBusy(true);
    try {
      await api.syncContentRemoteStatus(site);
      await load();
      showToast(t("content.toast.syncQueued", "Actualización de estados solicitada."));
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("content.toast.syncError", "No se pudo actualizar el estado de las publicaciones."), "error");
    } finally {
      setSyncBusy(false);
    }
  };

  if (loading) return <main className="ui-page"><Card><p role="status">{t("common.loading", "Cargando Post…")}</p></Card></main>;
  if (error || !post) return <main className="ui-page"><Card className="v3-state-card"><p className="ui-field-error" role="alert">{error || t("content.notFound", "No se encontró este Post")}</p><Button variant="secondary" onClick={() => navigate("/content")}>{t("content.back", "Volver a contenido")}</Button></Card></main>;

  const tabs = post.variants.map((variant) => ({ id: variant.channel, label: channelName(variant.channel, t) })) as Array<{ id: ContentChannel; label: string }>;
  const tone = statusTone(post.status);
  return <main className="ui-page v3-post-workspace">
    <PageHeader
      back={<Link className="ui-back-link" to="/content">{t("content.back", "Contenido")}</Link>}
      eyebrow={post.campaignTitle || t("content.noCampaign", "Sin campaña")}
      title={post.title}
      description={t("content.post.description", "Edita, revisa y publica este Post desde un único espacio.")}
      actions={<Inline gap="sm"><StatusBadge status={post.status} label={t(`content.status.${post.status}`, post.status.replace(/_/g, " "))} /><IconButton label={t("content.refreshStatus", "Actualizar estado")} disabled={syncBusy} aria-busy={syncBusy} onClick={() => void syncRemoteStatus()}>↻</IconButton><IconButton label={t("content.review.open", "Revisión")} onClick={() => setReviewOpen(true)}>◉</IconButton>{canEdit && !["published", "scheduled"].includes(post.status) && <IconButton label={t("content.action.delete", "Eliminar borrador")} onClick={() => setDeleteOpen(true)}>⌫</IconButton>}</Inline>}
    />
    <div className="v3-post-layout">
      <section className="v3-post-main" aria-label={t("content.post.editor", "Editor del Post")}>
        <Tabs items={tabs} value={activeChannel} onChange={selectChannel} idPrefix="post-variants" panelIdPrefix="post-panel" ariaLabel={t("content.post.variants", "Variantes del Post")} />
        <div id={`post-panel-${encodeURIComponent(activeChannel)}`} role="tabpanel" aria-labelledby={`post-variants-${encodeURIComponent(activeChannel)}`} className="v3-variant-panel">
          {activeVariant ? <Stack gap="md">
            <div className="v3-variant-heading"><div><span className="ui-eyebrow">{channelName(activeVariant.channel, t)}</span><h2>{t("content.variant.title", "Versión para este canal")}</h2></div><StatusBadge status={activeVariant.status} /></div>
            <Field label={t("content.post.title", "Título")}><TextField value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
            <Field label={t("content.post.copy", "Contenido")} hint={t("content.post.copyHint", "La IA externa y el Brand Kit se muestran en el rail de revisión.")}><Textarea className="v3-copy-editor" value={draft} onChange={(event) => setDraft(event.target.value)} /></Field>
            <PostVariantPreview variant={activeVariant} />
            <div className="v3-variant-media"><div className="v3-card-heading"><div><span className="ui-eyebrow">{t("content.media.eyebrow", "Assets")}</span><h2>{t("content.media.title", "Elementos de esta variante")}</h2></div><Badge tone="neutral">{activeVariant.media.length}</Badge></div>{activeVariant.media.length ? <div className="v3-media-list">{activeVariant.media.map((media) => <Card className="v3-media-item" key={media.id || media.path || media.url}><div>{mediaUrl(media) ? mediaIsVideo(media) ? <video src={mediaUrl(media)} controls muted preload="metadata" aria-label={media.alt || media.filename || "Vídeo"} /> : <img src={mediaUrl(media)} alt={media.alt || media.filename || ""} loading="lazy" decoding="async" /> : <span className="v3-media-placeholder" aria-hidden="true">✦</span>}<div><strong>{media.filename || media.alt || media.id || t("content.media.asset", "Asset")}</strong><span className="ui-muted">{media.kind || media.contentType || "Media"}</span></div></div>{canEdit && !["published", "scheduled"].includes(activeVariant.status) && <Button size="sm" variant="danger" loading={mediaBusy} disabled={!media.id} onClick={() => void removeMedia(String(media.id))}>{t("content.media.remove", "Quitar")}</Button>}</Card>)}</div> : <p className="ui-muted">{t("content.media.empty", "Esta variante todavía no tiene imágenes ni vídeo asociados.")}</p>}</div>
            <Inline gap="sm"><Button loading={saving} onClick={() => void save()}>{t("common.save", "Guardar cambios")}</Button><Button variant="secondary" loading={saving} onClick={() => void save(true)}>{t("content.action.reviewVariant", "Enviar esta variante a revisión")}</Button></Inline>
          </Stack> : <EmptyState title={t("content.variant.empty", "No hay variante para este canal")} />}
        </div>
        <Card className="v3-provenance-card"><div className="v3-card-heading"><div><span className="ui-eyebrow">{t("content.provenance.eyebrow", "Procedencia")}</span><h2>{t("content.provenance.title", "Brand Kit aplicado")}</h2></div><Badge tone={tone}>{post.provenance.brandKitVersionId || t("content.provenance.unknown", "Pendiente")}</Badge></div><p>{post.provenance.brandKitSnapshotHash ? t("content.provenance.snapshot", "La generación externa utilizó un snapshot verificable de la marca.") : t("content.provenance.pending", "Este Post aún no tiene una procedencia completa registrada.")}</p></Card>
      </section>
      <aside className="v3-review-rail" aria-label={t("content.review.rail", "Revisión y publicación")}>
        <ReviewRail post={post} canApprove={canApprove} saving={saving} scheduleAt={scheduleAt} setScheduleAt={setScheduleAt} onApprove={approve} onSchedule={schedule} />
      </aside>
    </div>
    <Drawer open={reviewOpen} title={t("content.review.title", "Revisión y publicación")} onClose={() => setReviewOpen(false)}><ReviewRail post={post} canApprove={canApprove} saving={saving} scheduleAt={scheduleAt} setScheduleAt={setScheduleAt} onApprove={approve} onSchedule={schedule} /></Drawer>
    <Modal open={deleteOpen} title={t("content.delete.title", "Eliminar este borrador") } onClose={() => setDeleteOpen(false)}><Stack gap="md"><p className="ui-muted">{t("content.delete.description", "El Post se archivará y dejará de aparecer en Contenido y Publicación. Podrás restaurarlo desde el filtro de archivados.")}</p><Inline gap="sm"><Button variant="ghost" onClick={() => setDeleteOpen(false)}>{t("common.cancel", "Cancelar")}</Button><Button variant="danger" loading={saving} onClick={() => void archivePost()}>{t("content.action.deleteConfirm", "Eliminar borrador")}</Button></Inline></Stack></Modal>
  </main>;
}

function PostVariantPreview({ variant }: { variant: PostVariant }) {
  const { t } = useI18n();
  const [activeIndex, setActiveIndex] = useState(0);
  const items = previewItemsFor(variant);
  const copy = variantCopy(variant);
  const isVideoChannel = variant.channel === "video";
  const isStoryChannel = variant.channel === "instagram_story";
  const previewLabel = isVideoChannel ? t("content.preview.video", "Vídeo") : isStoryChannel ? t("content.preview.story", "Story") : t("content.preview.carousel", "Carrusel");
  const safeIndex = items.length ? Math.min(activeIndex, items.length - 1) : 0;
  const current = items[safeIndex] || {};
  const source = previewMediaUrl(current);
  const title = String(current.headline || current.title || current.alt || current.filename || `${previewLabel} ${safeIndex + 1}`);

  useEffect(() => setActiveIndex(0), [variant.id, variant.channel]);

  if (!["instagram", "instagram_story", "video"].includes(variant.channel)) return null;

  return <Card className={`v3-channel-preview v3-channel-preview-${variant.channel}`}>
    <div className="v3-preview-heading"><div><span className="ui-eyebrow">{t("content.preview.eyebrow", "Vista previa")}</span><h3>{previewLabel}</h3></div><ChannelBadge channel={variant.channel} /></div>
    <div className="v3-preview-stage" role="region" aria-label={t("content.preview.region", "Vista previa del contenido")}>
      <IconButton label={t("content.preview.previous", "Anterior")} onClick={() => setActiveIndex((safeIndex - 1 + items.length) % items.length)} disabled={items.length < 2}>‹</IconButton>
      <figure className="v3-preview-frame">
        {source ? previewMediaIsVideo(current) ? <video className="v3-preview-media" src={source} controls playsInline preload="metadata" aria-label={title} /> : <img className="v3-preview-media" src={source} alt={title} loading="lazy" decoding="async" /> : <div className="v3-preview-media v3-preview-placeholder">{isVideoChannel ? t("content.preview.missingVideo", "Vídeo pendiente de cargar") : t("content.preview.missingMedia", "Sin media")}</div>}
        <figcaption>{title}</figcaption>
      </figure>
      <IconButton label={t("content.preview.next", "Siguiente")} onClick={() => setActiveIndex((safeIndex + 1) % items.length)} disabled={items.length < 2}>›</IconButton>
    </div>
    {items.length > 1 && <div className="v3-preview-dots" role="tablist" aria-label={previewLabel}>{items.map((item, index) => <Button key={item.id || `${variant.id}-${index}`} className={`v3-preview-dot${index === safeIndex ? " active" : ""}`} variant="ghost" size="sm" role="tab" aria-selected={index === safeIndex} aria-label={`${previewLabel} ${index + 1}`} onClick={() => setActiveIndex(index)}>{index + 1}</Button>)}</div>}
    <div className="v3-preview-copy"><span className="ui-eyebrow">{t("content.preview.copy", "Copy")}</span><p>{copy || t("content.preview.emptyCopy", "Este canal todavía no tiene copy.")}</p></div>
  </Card>;
}

function ReviewRail({ post, canApprove, saving, scheduleAt, setScheduleAt, onApprove, onSchedule }: { post: CanonicalPost; canApprove: boolean; saving: boolean; scheduleAt: string; setScheduleAt: (value: string) => void; onApprove: () => void; onSchedule: () => void }) {
  const { t } = useI18n();
  return <Stack gap="md">
    <Card className="v3-review-card"><div className="v3-card-heading"><h2>{t("content.review.title", "Revisión")}</h2><StatusBadge status={post.status} /></div><p>{t("content.review.summary", "Comprueba el contenido, la marca y los destinos antes de publicar.")}</p><div className="v3-channel-summary">{post.variants.map((variant) => <div key={variant.id}><div><ChannelBadge channel={variant.channel} /><StatusBadge status={variant.status} /></div>{variant.lastError && <p className="ui-field-error" role="alert">{variant.lastError}</p>}</div>)}</div></Card>
    <Card className="v3-review-card"><span className="ui-eyebrow">{t("content.review.next", "Siguiente acción")}</span><h2>{postActionLabel(post.status, t)}</h2>{canApprove && ["ready_for_review", "changes_requested"].includes(post.status) && <Button loading={saving} onClick={onApprove}>{t("content.action.approve", "Aprobar Post")}</Button>}{canApprove && post.status === "approved" && <Stack gap="sm"><Field label={t("content.schedule.label", "Fecha de publicación")}><TextField type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></Field><Button loading={saving} disabled={!scheduleAt} onClick={onSchedule}>{t("content.action.schedule", "Programar")}</Button></Stack>}<p className="ui-muted">{post.variants.length} {post.variants.length === 1 ? t("content.variant.one", "variante") : t("content.variant.many", "variantes")}</p></Card>
  </Stack>;
}
