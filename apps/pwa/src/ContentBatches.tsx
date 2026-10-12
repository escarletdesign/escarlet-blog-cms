import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "./api";
import type { ContentChannel, ContentItem, ContentPlanSummary, ContentStatus, ContentVariant, MediaItem } from "./types";
import { aggregateStatus, canApproveStatus, CONTENT_TITLE_MAX, contentPreviewPath, itemTitle, statusLabel } from "./content-format";
import { ContentPackPreview } from "./ContentPackPreview";
import { Badge, Button, Card, ChannelBadge, Checkbox, Drawer, EmptyState, Field, Inline, Modal, MultiSelectPills, PageHeader, Progress, Select, Stack, StatusBadge, Tabs, TextField, Textarea } from "./ui";

const ALL_CHANNELS: ContentChannel[] = ["blog", "instagram", "instagram_story", "linkedin", "x", "video"];
const channelLabel = (channel: string) => channel === "x" ? "X" : channel === "instagram_story" ? "Instagram Story" : channel === "video" ? "Vídeo / Reel" : channel.charAt(0).toUpperCase() + channel.slice(1);
const mediaUrl = (value: unknown, resolution: "thumb" | "preview" | "original" = "thumb") => {
  const media = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const candidates = media ? resolution === "thumb"
    ? [media.thumbUrl, media.thumbPath, media.previewUrl, media.previewPath, media.url, media.publicUrl, media.imageUrl, media.path]
    : resolution === "preview"
      ? [media.previewUrl, media.previewPath, media.thumbUrl, media.thumbPath, media.url, media.publicUrl, media.imageUrl, media.path]
      : [media.url, media.publicUrl, media.imageUrl, media.path]
    : [value];
  const url = String(candidates.find((candidate) => candidate) || "").trim();
  return url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "";
};
const itemCover = (item: ContentItem) => { const blog = (item.variants || []).find((variant) => variant.channel === "blog"); const candidates = [blog?.body?.imageThumbUrl, blog?.body?.imagePreviewUrl, blog?.body?.imageUrl, blog?.body?.coverUrl, blog?.media?.[0], ...(item.variants || []).flatMap((variant) => variant.media || [])]; return candidates.map((value) => mediaUrl(value, "thumb")).find(Boolean) || ""; };
const itemExcerpt = (item: ContentItem) => { const blog = (item.variants || []).find((variant) => variant.channel === "blog"); const excerpt = String(blog?.body?.excerpt || "").replace(/\s+/g, " ").trim(); const topic = String(item.topic || "").replace(/\s+/g, " ").trim(); const title = itemTitle(item); const text = excerpt || (topic && topic !== title ? topic : ""); return text.length > 180 ? text.slice(0, 177).trim() + "…" : text; };
const blogEditorValues = (item: ContentItem) => { const blog = (item.variants || []).find((variant) => variant.channel === "blog"); const body = blog?.body || {}; return { title: String(body.title || itemTitle(item)).trim(), excerpt: String(body.excerpt || body.excerptEs || "").trim(), content: String(body.bodyHtml || body.body || "").trim(), usesHtml: Boolean(body.bodyHtml) }; };
const localDateInput = (value?: string) => { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const pad = (part: number) => String(part).padStart(2, "0"); return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()); };
const dateKey = (itemId: string, channel: string) => itemId + ":" + channel;
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Sin fecha";
const publicationSortTime = (item: ContentItem) => {
  const times = (item.variants || []).filter((variant) => !["published", "canceled"].includes(variant.scheduleStatus || variant.status)).map((variant) => variant.publicationDate).filter(Boolean).map((value) => new Date(value as string).getTime()).filter((value) => Number.isFinite(value));
  return times.length ? Math.min(...times) : Number.POSITIVE_INFINITY;
};
const statusPriority: Record<string, number> = { action_required: 0, failed: 1, needs_review: 2, draft: 3, generated: 4, approved: 5, scheduled: 6, syncing: 7, published: 8, canceled: 9 };
const normalizeVariant = (raw: any): ContentVariant => ({ ...raw, channel: raw.channel, status: raw.status || "draft", body: raw.body || {}, publicationDate: raw.publicationDate || raw.publication_date || "", scheduleTimezone: raw.scheduleTimezone || raw.schedule_timezone || "", scheduleStatus: raw.scheduleStatus || raw.schedule_status || undefined, lastError: raw.lastError || raw.last_error || null });
const normalizeItem = (raw: any): ContentItem => ({ ...raw, batchId: raw.batchId || raw.batch_id, planTitle: raw.planTitle || raw.plan_title, planStatus: raw.planStatus || raw.plan_status, metadata: raw.metadata || {}, variants: Array.isArray(raw.variants) ? raw.variants.map(normalizeVariant) : [] });
const BUFFER_PUBLISH_CHANNELS: ContentChannel[] = ["instagram", "linkedin", "x", "video"];
const bufferPublishableChannels = (rows: Array<{ channel: string; enabled?: boolean; connectionStatus?: string }> = []) => {
  const ready: ContentChannel[] = [];
  for (const target of BUFFER_PUBLISH_CHANNELS) {
    const row = rows.find((item) => item.channel === target);
    if (!row?.enabled) continue;
    if (String(row.connectionStatus || "").toLowerCase() === "connected") {
      ready.push(target);
      continue;
    }
    if (target === "video") {
      const instagram = rows.find((item) => item.channel === "instagram");
      if (instagram?.enabled && String(instagram.connectionStatus || "").toLowerCase() === "connected") ready.push("video");
    }
  }
  return ready;
};

type LibraryAsset = { key: string; item: ContentItem; channel: ContentChannel; status: ContentStatus; url: string; kind: "image" | "video"; title: string };
type LibraryGroup = { channel: ContentChannel; assets: LibraryAsset[]; pending: number };

function assetKind(value: unknown, url: string, channel: ContentChannel): "image" | "video" {
  const media = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const type = String(media.mimeType || media.type || media.kind || "").toLowerCase();
  return type.includes("video") || (channel === "video" && /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(url)) ? "video" : "image";
}

function libraryValues(variant: ContentVariant) {
  const body = variant.body || {};
  const socialPack = body.socialPack && typeof body.socialPack === "object" ? body.socialPack : {};
  const slides = Array.isArray(socialPack.instagramSlides) ? socialPack.instagramSlides : [];
  const storyFrames = Array.isArray(socialPack.instagramStory?.frames) ? socialPack.instagramStory.frames : [];
  return [
    ...(variant.media || []),
    body.imageThumbUrl,
    body.imagePreviewUrl,
    body.imageUrl,
    body.image_url,
    body.coverUrl,
    ...slides,
    ...storyFrames,
  ].filter(Boolean);
}

function buildLibraryGroups(items: ContentItem[], filterChannel = "all"): LibraryGroup[] {
  const groups = new Map<ContentChannel, { assets: LibraryAsset[]; pending: number }>();
  items.forEach((item) => (item.variants || []).forEach((variant) => {
    if (filterChannel !== "all" && variant.channel !== filterChannel) return;
    const values = libraryValues(variant);
    const seen = new Set<string>();
    const status = variant.scheduleStatus || variant.status || "draft";
    const assets = values.map((value, index) => {
      const url = mediaUrl(value, "thumb");
      if (!url) return null;
      const dedupeKey = url;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);
      return { key: `${item.id}:${variant.channel}:${index}`, item, channel: variant.channel, status, url, kind: assetKind(value, url, variant.channel), title: itemTitle(item) };
    }).filter((asset): asset is LibraryAsset => Boolean(asset));
    const current = groups.get(variant.channel) || { assets: [], pending: 0 };
    if (!assets.length) current.pending += 1;
    current.assets.push(...assets);
    groups.set(variant.channel, current);
  }));
  return ALL_CHANNELS.filter((channel) => groups.has(channel)).map((channel) => ({ channel, ...(groups.get(channel) || { assets: [], pending: 0 }) }));
}

function standaloneAssetStatus(asset: MediaItem) {
  return String(asset.metadata?.status || asset.metadata?.state || (asset.metadata?.brandGrounding ? "ready_for_review" : "generated"));
}

function standaloneAssetKind(asset: MediaItem) {
  const type = String(asset.metadata?.mimeType || asset.metadata?.contentType || asset.contentType || asset.kind || "").toLowerCase();
  return type.includes("video") ? "video" : "image";
}

function standaloneMatches(asset: MediaItem, filterChannel: string, filterStatus: string, filterQuery: string) {
  const metadata = asset.metadata || {};
  const grounding = metadata.brandGrounding && typeof metadata.brandGrounding === "object" ? metadata.brandGrounding : {};
  const kind = String(metadata.kind || asset.kind || "").toLowerCase();
  const assetType = String(metadata.assetType || grounding.assetType || "").toLowerCase();
  const declaredChannels = [metadata.channel, metadata.channels, grounding.channel, grounding.channels].flatMap((value) => Array.isArray(value) ? value : [value]).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const channels = new Set(declaredChannels);
  const channelMatch = filterChannel === "all"
    || channels.has(filterChannel)
    || (filterChannel === "blog" && (kind === "post" || assetType === "blog_cover"))
    || (filterChannel === "instagram" && (assetType === "social_image" || (kind === "social" && !channels.size && assetType !== "instagram_story")))
    || (filterChannel === "instagram_story" && assetType === "instagram_story")
    || (filterChannel === "video" && ["video", "reel", "instagram_reel"].includes(assetType));
  const status = standaloneAssetStatus(asset);
  const statusMatch = filterStatus === "all" || (filterStatus === "needs_review" ? ["needs_review", "ready_for_review", "pending_review"].includes(status) : status === filterStatus);
  const query = filterQuery.trim().toLowerCase();
  const text = [asset.filename, asset.id, asset.alt, metadata.filename, metadata.alt, kind, assetType].filter(Boolean).join(" ").toLowerCase();
  return channelMatch && statusMatch && (!query || text.includes(query));
}

function assetFilename(asset: MediaItem) {
  return asset.filename || String(asset.metadata?.filename || asset.metadata?.fileName || asset.id || "Asset");
}

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("No se pudo leer el archivo."));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

type AssetEditChanges = { filename?: string; alt?: string; usage?: string };
type ContentAssetLibraryProps = {
  groups: LibraryGroup[];
  standaloneAssets: MediaItem[];
  filterChannel: string;
  channelOptions: ContentChannel[];
  onChannelChange: (channel: string) => void;
  t: (key: string, fallback?: string) => string;
  onOpen: (item: ContentItem) => void;
  onDeleteMany: (assets: MediaItem[]) => Promise<boolean>;
  onEditMany: (assets: MediaItem[], changes: AssetEditChanges) => Promise<boolean>;
  onUpload: (files: File[]) => Promise<boolean>;
};

function ContentAssetLibrary({ groups, standaloneAssets, filterChannel, channelOptions, onChannelChange, t, onOpen, onDeleteMany, onEditMany, onUpload }: ContentAssetLibraryProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteSelection, setDeleteSelection] = useState<MediaItem[]>([]);
  const [editSelection, setEditSelection] = useState<MediaItem[]>([]);
  const [editForm, setEditForm] = useState<AssetEditChanges>({ filename: "", alt: "", usage: "" });
  const [uploading, setUploading] = useState(false);
  const selectableIds = standaloneAssets.filter((asset) => asset.id && asset.deletable !== false).map((asset) => String(asset.id));
  const selectedAssets = standaloneAssets.filter((asset) => asset.id && selectedIds.includes(String(asset.id)));
  const allVisibleSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));
  const protectedAssets = standaloneAssets.filter((asset) => asset.deletable === false);
  const visibleGroups = filterChannel === "all" ? groups : groups.filter((group) => group.channel === filterChannel);
  const libraryAssets = visibleGroups.flatMap((group) => group.assets);
  const visibleLibraryAssets = libraryAssets.slice(0, 60);
  const tabChannels = [...channelOptions, ...groups.map((group) => group.channel)];
  const channelTabs = [{ id: "all", label: t("contentLibrary.allChannels", "Todos") }, ...tabChannels.map((channel) => ({ id: channel, label: channelLabel(channel) }))].filter((tab, index, all) => all.findIndex((candidate) => candidate.id === tab.id) === index);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => standaloneAssets.some((asset) => String(asset.id || "") === id)));
  }, [standaloneAssets]);

  const toggleSelected = (asset: MediaItem) => {
    if (!asset.id) return;
    const id = String(asset.id);
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const openEdit = (assets: MediaItem[]) => {
    setEditForm({ filename: "", alt: "", usage: "" });
    setEditSelection(assets);
  };
  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    const changes = Object.fromEntries(Object.entries(editForm).filter(([, value]) => String(value || "").trim())) as AssetEditChanges;
    if (!Object.keys(changes).length) return;
    if (await onEditMany(editSelection, changes)) {
      setEditSelection([]);
      setSelectedIds([]);
    }
  };
  const submitDelete = async () => {
    if (await onDeleteMany(deleteSelection)) {
      setDeleteSelection([]);
      setSelectedIds([]);
    }
  };
  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try { await onUpload(files); } finally { setUploading(false); }
  };
  const uploadAction = <label className="ui-button ui-button-secondary ui-button-sm ui-file-upload-button">{uploading ? t("contentLibrary.uploading", "Subiendo…") : t("contentLibrary.upload", "Subir imágenes")}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden disabled={uploading} onChange={(event) => { void uploadFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} /></label>;
  const total = visibleGroups.reduce((sum, group) => sum + group.assets.length, 0);
  const published = visibleGroups.reduce((sum, group) => sum + group.assets.filter((asset) => asset.status === "published").length, 0);
  const generated = visibleGroups.reduce((sum, group) => sum + group.assets.filter((asset) => asset.url && ["generated", "approved", "scheduled", "syncing"].includes(asset.status)).length, 0);
  const pending = visibleGroups.reduce((sum, group) => sum + group.pending, 0) + total - published - generated;
  return <Stack gap="md" className="ui-content-library">
    <Card className="ui-content-library-switcher">
      <div className="ui-card-head"><div><span className="ui-eyebrow">{t("contentLibrary.viewEyebrow", "VISTA")}</span><h2>{t("contentLibrary.viewByChannel", "Ver por canal")}</h2></div><span className="ui-muted">{groups.reduce((sum, group) => sum + group.assets.length, 0)} {t("contentLibrary.assets", "activos")}</span></div>
      <Tabs items={channelTabs} value={filterChannel as "all" | ContentChannel} onChange={onChannelChange} idPrefix="content-library-channel-tabs" panelIdPrefix="content-library-panel" ariaLabel={t("contentLibrary.channelViews", "Vistas por canal")} />
    </Card>
    <Inline gap="sm" className="ui-content-library-summary"><span className="ui-muted">{t("contentLibrary.visibleCampaignAssets", "Activos de las campañas visibles")}</span><Badge tone="success">{generated} {t("contentLibrary.generated", "generados")}</Badge><Badge tone="published">{published} {t("contentLibrary.published", "publicados")}</Badge><Badge tone="warning">{pending} {t("contentLibrary.pending", "pendientes")}</Badge><Badge tone="info">{standaloneAssets.length} {t("contentLibrary.unassigned", "sin campaña")}</Badge></Inline>
    <div id={`content-library-panel-${encodeURIComponent(filterChannel)}`} role="tabpanel" aria-labelledby={`content-library-channel-tabs-${encodeURIComponent(filterChannel)}`} tabIndex={0}>
    {visibleLibraryAssets.length > 0 ? <Card className="ui-content-library-channel ui-content-library-unified">
      <div className="ui-card-head"><div><span className="ui-eyebrow">{t("contentLibrary.channelApp", "Canal / app")}</span><h2>{filterChannel === "all" ? t("contentLibrary.allAssets", "Todos los activos") : channelLabel(filterChannel)}</h2></div>{filterChannel === "all" ? <Badge tone="info">{libraryAssets.length}</Badge> : <ChannelBadge channel={filterChannel} />}</div>
      <Inline gap="sm" className="ui-content-library-counts"><Badge tone="success">{generated} {t("contentLibrary.generated", "generados")}</Badge><Badge tone="published">{published} {t("contentLibrary.published", "publicados")}</Badge><Badge tone="warning">{pending} {t("contentLibrary.pending", "pendientes")}</Badge></Inline>
      <div className="ui-content-library-assets">
        {visibleLibraryAssets.map((asset) => <article className="ui-content-library-asset" key={asset.key}>
          {asset.kind === "video" ? <video className="ui-content-library-visual" src={asset.url} controls preload="metadata" aria-label={asset.title} /> : <img className="ui-content-library-visual" src={asset.url} alt={asset.title} loading="lazy" decoding="async" />}
          <div className="ui-content-library-asset-meta">{filterChannel === "all" && <ChannelBadge channel={asset.channel} />}<strong title={asset.title}>{asset.title}</strong><StatusBadge status={asset.status} label={statusLabel(asset.status)} /></div>
          <Button variant="ghost" size="sm" onClick={() => onOpen(asset.item)}>{t("contentLibrary.openContent", "Abrir contenido")}</Button>
        </article>)}
      </div>
      {libraryAssets.length > visibleLibraryAssets.length && <p className="ui-field-hint">{t("contentLibrary.limitHint", "Se muestran 60 activos. Usa los filtros para acotar la biblioteca.")}</p>}
    </Card> : null}
    {!visibleGroups.length && <EmptyState title={t("contentLibrary.noChannelAssets", "No hay activos para este canal")} description={t("contentLibrary.noChannelAssetsHelp", "Prueba otro canal o cambia los filtros de estado y búsqueda.")} />}
    </div>
    <Card className="ui-content-library-standalone">
      <div className="ui-card-head"><div><span className="ui-eyebrow">{t("contentLibrary.globalEyebrow", "Biblioteca global")}</span><h2>{t("contentLibrary.unassignedTitle", "Assets sin campaña")}</h2></div><Inline gap="sm"><Badge tone="info">{standaloneAssets.length}</Badge>{uploadAction}</Inline></div>
      <p className="ui-muted">{t("contentLibrary.unassignedHelp", "Archivos generados o subidos por una micro app que todavía no están asociados a una campaña.")}</p>
      {standaloneAssets.length > 0 ? <>
        <Inline gap="sm" className="ui-content-library-batch-toolbar"><Checkbox label={t("contentLibrary.selectDeletable", "Seleccionar editables") } checked={allVisibleSelected} onChange={() => setSelectedIds(allVisibleSelected ? [] : selectableIds)} /><Button size="sm" variant="ghost" disabled={!selectableIds.length} onClick={() => setSelectedIds(selectableIds)}>{t("contentLibrary.selectVisible", "Seleccionar visibles")}</Button><Button size="sm" variant="ghost" disabled={!selectedAssets.length} onClick={() => setSelectedIds([])}>{t("contentLibrary.clearSelection", "Limpiar")}</Button>{selectedAssets.length > 0 && <><Badge tone="info">{selectedAssets.length} {t("contentLibrary.selected", "seleccionados")}</Badge><Button size="sm" variant="secondary" onClick={() => openEdit(selectedAssets)}>{t("contentLibrary.bulkEdit", "Editar en lote")}</Button><Button size="sm" variant="danger" onClick={() => setDeleteSelection(selectedAssets)}>{t("contentLibrary.bulkDelete", "Eliminar en lote")}</Button></>}</Inline>
        {protectedAssets.length > 0 && <p className="ui-content-library-protected"><strong>{protectedAssets.length} {t("contentLibrary.protectedAssets", "assets protegidos")}</strong> {t("contentLibrary.protectedHelp", "Los archivos publicados o vinculados no se pueden eliminar. Para ocultar una pieza completa, archívala desde Campañas; las publicaciones externas no se modifican.")}</p>}
        <div className="ui-content-library-assets">
        {standaloneAssets.map((asset) => {
          const url = mediaUrl(asset, "preview");
          const status = standaloneAssetStatus(asset);
          const id = String(asset.id || "");
          const selected = Boolean(id && selectedIds.includes(id));
          return <article className="ui-content-library-asset" key={asset.id || asset.path || asset.url}>
            {url ? standaloneAssetKind(asset) === "video" ? <video className="ui-content-library-visual" src={url} controls preload="metadata" aria-label={assetFilename(asset)} /> : <img className="ui-content-library-visual" src={url} alt={asset.alt || assetFilename(asset)} loading="lazy" decoding="async" /> : <div className="ui-content-library-visual ui-content-library-placeholder" role="img" aria-label={t("contentLibrary.noPreview", "Asset sin vista previa")}><span>{t("contentLibrary.noPreview", "Sin vista previa")}</span></div>}
            <div className="ui-content-library-asset-meta"><Checkbox label={t("contentLibrary.select", "Seleccionar")} checked={selected} disabled={asset.deletable === false || !id} onChange={() => toggleSelected(asset)} /><strong title={assetFilename(asset)}>{assetFilename(asset)}</strong><StatusBadge status={status} label={statusLabel(status)} /><span className="ui-muted">{String(asset.metadata?.kind || asset.kind || t("contentLibrary.production", "producción"))}</span></div>
            <Inline gap="sm">
              {url && <a className="ui-button ui-button-ghost ui-button-sm" href={url} target="_blank" rel="noreferrer">{t("contentLibrary.openFile", "Abrir archivo")}</a>}
              {asset.id && <Button variant="ghost" size="sm" onClick={() => openEdit([asset])}>{t("contentLibrary.edit", "Editar")}</Button>}
              {asset.deletable !== false && asset.id && <Button variant="ghost" size="sm" onClick={() => setDeleteSelection([asset])}>{t("contentLibrary.delete", "Eliminar")}</Button>}
              {asset.deletable === false && <span className="ui-field-hint">{t("contentLibrary.protected", "Protegido")}</span>}
            </Inline>
          </article>;
        })}
        </div>
      </> : <EmptyState title={t("contentLibrary.noUnassigned", "No hay assets sin campaña con estos filtros")} description={t("contentLibrary.noUnassignedHelp", "Sube un archivo o cambia el canal, estado o búsqueda para ver otros assets.")} action={uploadAction} />}
    </Card>
    <Modal open={Boolean(deleteSelection.length)} title={deleteSelection.length > 1 ? t("contentLibrary.deleteAssets", "Eliminar assets") : t("contentLibrary.deleteAsset", "Eliminar asset")} onClose={() => setDeleteSelection([])}><Stack gap="md"><p>{t("contentLibrary.deleteConfirm", `Se eliminarán ${deleteSelection.length} asset${deleteSelection.length === 1 ? "" : "s"} del repositorio canónico. Los archivos publicados o vinculados se conservarán.`)}</p><Inline gap="md"><Button variant="ghost" onClick={() => setDeleteSelection([])}>{t("common.cancel", "Cancelar")}</Button><Button variant="danger" onClick={() => void submitDelete()}>{t("contentLibrary.deleteForever", "Eliminar definitivamente")}</Button></Inline></Stack></Modal>
    <Modal open={Boolean(editSelection.length)} title={editSelection.length > 1 ? t("contentLibrary.editAssets", "Editar assets en lote") : t("contentLibrary.editAsset", "Editar asset")} onClose={() => setEditSelection([])}><form className="ui-stack ui-stack-md" onSubmit={(event) => void submitEdit(event)}><p className="ui-field-hint">{t("contentLibrary.emptyFieldsHint", "Los campos vacíos no cambian el valor actual.")}</p><Field label={t("contentLibrary.filename", "Nombre del archivo")}><TextField value={editForm.filename} onChange={(event) => setEditForm((current) => ({ ...current, filename: event.target.value }))} placeholder="Ejemplo: plato-del-dia.webp" /></Field><Field label={t("contentLibrary.alt", "Texto alternativo")}><Textarea value={editForm.alt} onChange={(event) => setEditForm((current) => ({ ...current, alt: event.target.value }))} rows={3} placeholder={t("contentLibrary.altPlaceholder", "Describe la imagen para accesibilidad y contexto.")} /></Field><Field label={t("contentLibrary.usage", "Uso")}><TextField value={editForm.usage} onChange={(event) => setEditForm((current) => ({ ...current, usage: event.target.value }))} placeholder="Ejemplo: blog, social, reel" /></Field><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setEditSelection([])}>{t("common.cancel", "Cancelar")}</Button><Button type="submit" disabled={!Object.values(editForm).some((value) => String(value || "").trim())}>{t("common.save", "Guardar cambios")}</Button></Inline></form></Modal>
  </Stack>;
}

type Props = { site: string; brandId?: string; previewItemId?: string; creationEnabled?: boolean; activeChannels?: Array<{ channel: string; enabled: boolean; connectionStatus?: string }>; t: (key: string, fallback?: string) => string; onNotify?: (message: string, kind?: "success" | "error" | "info") => void };
type Dialog = { type: "edit" | "schedule" | "blog-edit"; item: ContentItem } | { type: "details"; item: ContentItem } | null;

function ContentRunReviewRail({ item, busy, t, onApprove, onOpenChannels, onArchive }: { item: ContentItem; busy: boolean; t: (key: string, fallback?: string) => string; onApprove: () => void; onOpenChannels: () => void; onArchive: () => void }) {
  const status = aggregateStatus(item);
  const findings = Array.isArray(item.metadata?.brandOs?.findings) ? item.metadata.brandOs.findings : [];
  const blockers = findings.filter((finding: any) => finding?.severity === "blocker");
  const brandContext = item.metadata?.brandOs?.brandContext;
  const variants = item.variants || [];
  const hasPublished = variants.some((variant) => (variant.scheduleStatus || variant.status) === "published");
  const archived = Boolean(item.metadata?.archivedAt);
  const actionRequired = status === "action_required" || status === "failed" || blockers.length > 0;
  return <aside className="ui-content-run-review" aria-label={t("contentRun.reviewLabel", "Revisión del contenido")}>
    <Card className="ui-content-run-review-card">
      <div className="ui-card-head"><div><span className="ui-eyebrow">{t("contentRun.reviewEyebrow", "REVISIÓN")}</span><h2>{actionRequired ? t("contentRun.needsAttention", "Hay algo que revisar") : t("contentRun.nextStep", "Siguiente paso")}</h2></div><StatusBadge status={status} label={statusLabel(status)} /></div>
      <div className="ui-content-run-checklist" role="list">
        <div className="ui-content-run-check" role="listitem"><span aria-hidden="true">{blockers.length ? "!" : "✓"}</span><div><strong>{t("contentRun.brandCopy", "Marca y copy")}</strong><small>{blockers.length ? `${blockers.length} ${t(blockers.length === 1 ? "contentRun.blocker" : "contentRun.blockers", blockers.length === 1 ? "bloqueo detectado" : "bloqueos detectados")}` : t("contentRun.noBlockers", "Sin bloqueos de marca")}</small></div></div>
        <div className="ui-content-run-check" role="listitem"><span aria-hidden="true">✓</span><div><strong>{t("contentRun.variants", "Variantes")}</strong><small>{variants.length} {t(variants.length === 1 ? "contentRun.channelReady" : "contentRun.channelsReady", variants.length === 1 ? "canal preparado" : "canales preparados")}</small></div></div>
      </div>
      {findings.length > 0 && <Stack gap="sm" className="ui-content-run-findings">{findings.slice(0, 3).map((finding: any, index: number) => <p className={finding?.severity === "blocker" ? "ui-field-error" : "ui-field-hint"} key={`${finding?.code || "finding"}-${index}`}>{finding?.message || t("contentRun.findingFallback", "Revisa esta pieza antes de continuar.")}</p>)}</Stack>}
      <div className="ui-content-run-provenance"><span className="ui-eyebrow">{t("contentRun.provenance", "PROCEDENCIA")}</span><p>{brandContext?.identity?.name || t("brand.active", "Marca activa")}</p><small>{brandContext?.brandKitVersionId ? `Brand Kit ${brandContext.brandKitVersion ?? t("brand.active", "activo")}` : t("contentRun.activeBrandKit", "Brand Kit activo")} · {item.planTitle || t("contentRun.content", "Contenido")}</small></div>
      <div className="ui-content-run-channels"><span className="ui-eyebrow">{t("contentRun.channels", "CANALES")}</span><div className="ui-channel-list">{variants.map((variant) => <ChannelBadge key={variant.id} channel={variant.channel} />)}</div></div>
      <Stack gap="sm" className="ui-content-run-actions">
        {canApproveStatus(status) && <Button disabled={busy} loading={busy} onClick={onApprove}>{t("contentRun.approve", "Aprobar contenido")}</Button>}
        <Button variant="secondary" disabled={busy} onClick={onOpenChannels}>{hasPublished ? t("contentRun.viewPublication", "Ver publicación") : t("contentRun.channelsAndPublication", "Canales y publicación")}</Button>
        <Button variant="ghost" disabled={busy} onClick={onArchive}>{archived ? t("contentRun.restore", "Restaurar contenido") : t("contentRun.archive", "Archivar contenido")}</Button>
      </Stack>
    </Card>
  </aside>;
}

export function ContentBatches({ site, brandId, previewItemId, creationEnabled = false, activeChannels, t, onNotify }: Props) {
  const [plans, setPlans] = useState<ContentPlanSummary[]>([]);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [standaloneAssets, setStandaloneAssets] = useState<MediaItem[]>([]);
  const [previewFallback, setPreviewFallback] = useState<ContentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [modalValue, setModalValue] = useState("");
  const [blogForm, setBlogForm] = useState({ title: "", excerpt: "", content: "", usesHtml: false });
  const [scheduleChannels, setScheduleChannels] = useState<ContentChannel[]>([]);
  const notifyError = (message: string) => onNotify ? onNotify(message, "error") : setError(message);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dates, setDates] = useState<Record<string, string>>({});
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [topics, setTopics] = useState("");
  const [campaignStep, setCampaignStep] = useState(0);
  const [campaignBrief, setCampaignBrief] = useState({ objective: "", audience: "", cta: "" });
  const loadSequence = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const createIdempotencyKey = useRef<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const previewBatchId = searchParams.get("batchId") || "";
  const filterQuery = searchParams.get("q") || "";
  const filterPlan = searchParams.get("plan") || "all";
  const filterStatus = searchParams.get("status") || "all";
  const filterChannel = searchParams.get("channel") || "all";
  const filterDate = searchParams.get("date") || "all";
  const filterArchive = ["active", "archived", "all"].includes(searchParams.get("archive") || "") ? searchParams.get("archive") as "active" | "archived" | "all" : "active";
  const view = searchParams.get("view") === "library" ? "library" : "campaigns";
  const sortOrder = ["date", "status", "title"].includes(searchParams.get("sort") || "") ? searchParams.get("sort") as "date" | "status" | "title" : "date";
  const updateSearchParam = (key: string, value: string, defaultValue = "all") => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    ["q", "plan", "status", "channel", "date", "archive"].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };
  const channels = (activeChannels?.filter((channel) => channel.enabled).map((channel) => channel.channel).filter((channel): channel is ContentChannel => ALL_CHANNELS.includes(channel as ContentChannel)) || ALL_CHANNELS).slice(0, 7);
  const publishChannels = useMemo(() => bufferPublishableChannels(activeChannels || []), [activeChannels]);
  const connectionsPath = brandId ? `/brands/${encodeURIComponent(brandId)}/connections` : "/connections";
  const previewItem = previewItemId ? items.find((item) => item.id === previewItemId) || (previewFallback?.id === previewItemId ? previewFallback : null) : null;
  const detailItem = dialog?.type === "details" ? dialog.item : null;
  const bufferReady = publishChannels.length > 0;

  const load = async () => {
    const sequence = ++loadSequence.current;
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    setLoading(true); setError(""); setSetupRequired(false);
    try {
      const [planResponse, reviewResponse, assetResponse, managedAssetResponse] = await Promise.all([
        api.contentPlans(site, controller.signal),
        api.reviewItems(site, controller.signal, filterArchive),
        api.productionAssets(site).catch(() => ({ assets: [] })),
        api.managedProductionAssets(site).catch(() => ({ assets: [] })),
      ]);
      if (sequence !== loadSequence.current || controller.signal.aborted) return;
      setPlans((planResponse.plans || []) as ContentPlanSummary[]);
      setStandaloneAssets(((managedAssetResponse.assets?.length ? managedAssetResponse.assets : assetResponse.assets) || []) as MediaItem[]);
      const nextItems = (reviewResponse.items || []).map(normalizeItem);
      let fallback: ContentItem | null = null;
      if (previewItemId && previewBatchId && !nextItems.some((entry) => entry.id === previewItemId)) {
        const batch = await api.contentBatch(previewBatchId, site);
        const preview = batch.items?.find((entry) => entry.id === previewItemId);
        if (preview) fallback = normalizeItem(preview);
      }
      if (sequence !== loadSequence.current || controller.signal.aborted) return;
      setItems(nextItems);
      setPreviewFallback(fallback);
      setDialog((current) => {
        if (!current) return current;
        const refreshed = nextItems.find((entry) => entry.id === current.item.id);
        return refreshed ? { ...current, item: refreshed } : current;
      });
      return true;
    } catch (err: any) {
      if (controller.signal.aborted || sequence !== loadSequence.current) return;
      if (err?.status === 404 || /workspace|sitio|marca/i.test(err?.message || "")) setSetupRequired(true);
      else {
        const message = err?.message || "No se pudo cargar el contenido.";
        setError(message);
        onNotify?.(message, "error");
      }
      return false;
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  };
  useEffect(() => {
    if (previewItemId) return;
    void load();
    return () => { loadAbort.current?.abort(); };
  }, [site, filterArchive]);
  useEffect(() => {
    if (!previewItemId) return;
    void load();
    return () => { loadAbort.current?.abort(); };
  }, [site, previewItemId, previewBatchId, filterArchive]);
  useEffect(() => { if (previewItemId) setDialog(null); }, [previewItemId]);
  const visibleItems = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    return items.filter((item) => {
      const itemStatus = aggregateStatus(item);
      const datesForItem = (item.variants || []).filter((variant) => !["published", "canceled"].includes(variant.scheduleStatus || variant.status)).map((variant) => variant.publicationDate).filter(Boolean).map((value) => new Date(value as string)).filter((date) => !Number.isNaN(date.getTime()));
      const hasDate = datesForItem.length > 0;
      const dateMatch = filterDate === "all" || (filterDate === "no_date" && !hasDate) || (filterDate === "overdue" && datesForItem.some((date) => date < new Date())) || (filterDate === "today" && datesForItem.some((date) => date >= today && date < tomorrow)) || (filterDate === "upcoming" && datesForItem.some((date) => date >= tomorrow));
      const variantText = (item.variants || []).flatMap((variant) => [variant.body?.title, variant.body?.excerpt, variant.body?.text, variant.body?.caption]).filter(Boolean).join(" ");
      const text = (item.topic + " " + (item.planTitle || "") + " " + (item.metadata?.contentTitle || "") + " " + variantText).toLowerCase();
      return (!query || text.includes(query)) && (filterPlan === "all" || String(item.batchId) === filterPlan) && (filterStatus === "all" || itemStatus === filterStatus || item.status === filterStatus) && (view === "library" || filterChannel === "all" || (item.variants || []).some((variant) => variant.channel === filterChannel)) && dateMatch;
    }).sort((left, right) => {
      if (sortOrder === "title") return itemTitle(left).localeCompare(itemTitle(right), "es", { sensitivity: "base" });
      if (sortOrder === "status") {
        const priority = (statusPriority[aggregateStatus(left)] ?? 10) - (statusPriority[aggregateStatus(right)] ?? 10);
        if (priority) return priority;
      }
      return publicationSortTime(left) - publicationSortTime(right) || itemTitle(left).localeCompare(itemTitle(right), "es", { sensitivity: "base" });
    });
  }, [items, filterQuery, filterPlan, filterStatus, filterChannel, filterDate, sortOrder, view]);
  useEffect(() => { setSelectedItemIds((current) => current.filter((id) => visibleItems.some((item) => item.id === id))); }, [visibleItems]);
  const libraryGroups = useMemo(() => buildLibraryGroups(visibleItems, "all"), [visibleItems]);
  const visibleStandaloneAssets = useMemo(() => standaloneAssets.filter((asset) => standaloneMatches(asset, filterChannel, filterStatus, filterQuery)), [standaloneAssets, filterChannel, filterStatus, filterQuery]);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true); setError(""); let failure = "";
    try {
      try { await action(); } catch (err: any) { failure = err?.message || "No se pudo completar la operación."; }
      const reloaded = await load();
      if (reloaded === false && !failure) failure = "No se pudo recargar el contenido.";
      if (failure) notifyError(failure);
      return !failure;
    } finally { setBusy(false); }
  };
  const deleteStandaloneAssets = (assets: MediaItem[]) => {
    const assetIds = assets.map((asset) => String(asset.id || "")).filter(Boolean);
    if (!assetIds.length) return Promise.resolve(false);
    return run(async () => {
      const result = await api.deleteProductionAssets({ site, assetIds });
      const blocked = result.blocked?.length || 0;
      if (blocked) onNotify?.(t("contentLibrary.deletePartial", `${result.count || assetIds.length - blocked} eliminado${(result.count || assetIds.length - blocked) === 1 ? "" : "s"}. ${blocked} protegido${blocked === 1 ? "" : "s"} por contenido publicado o vinculado.`), "info");
      else onNotify?.(t("contentLibrary.deleteSuccess", `${assetIds.length} asset${assetIds.length === 1 ? "" : "s"} eliminado${assetIds.length === 1 ? "" : "s"}.`), "success");
    });
  };
  const archiveContent = (item: ContentItem) => run(async () => {
    const archived = Boolean(item.metadata?.archivedAt);
    await (archived ? api.restoreArchivedContent(item.id, site) : api.archiveContent(item.id, site));
    onNotify?.(archived ? t("content.archiveRestored", "Contenido restaurado.") : t("content.archiveSuccess", "Contenido archivado. Las publicaciones externas no se modificaron."), "success");
    setDialog(null);
  });
  const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
  const allVisibleItemsSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedItemIds.includes(item.id));
  const toggleItemSelection = (item: ContentItem) => setSelectedItemIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]);
  const archiveSelectedItems = () => run(async () => {
    await Promise.all(selectedItems.map((item) => (item.metadata?.archivedAt ? api.restoreArchivedContent(item.id, site) : api.archiveContent(item.id, site))));
    setSelectedItemIds([]);
    onNotify?.(t("content.archiveBatchSuccess", `${selectedItems.length} piezas actualizadas.`), "success");
  });
  const editStandaloneAssets = (assets: MediaItem[], changes: AssetEditChanges) => {
    const assetIds = assets.map((asset) => String(asset.id || "")).filter(Boolean);
    if (!assetIds.length) return Promise.resolve(false);
    return run(async () => {
      await api.updateProductionAssets({ site, assetIds, ...changes });
      onNotify?.(`${assetIds.length} asset${assetIds.length === 1 ? "" : "s"} actualizado${assetIds.length === 1 ? "" : "s"}.`, "success");
    });
  };
  const uploadStandaloneAssets = (files: File[]) => run(async () => {
    for (const file of files) {
      if (!file.type.startsWith("image/")) throw new Error("La biblioteca global solo admite imágenes.");
      if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} supera el límite de 12 MB.`);
      await api.uploadProductionAsset({ site, filename: file.name, contentBase64: await fileAsDataUrl(file), alt: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") });
    }
    onNotify?.(`${files.length} asset${files.length === 1 ? "" : "s"} subido${files.length === 1 ? "" : "s"}.`, "success");
  });
  const create = async (event: FormEvent) => { event.preventDefault(); const cleanTopics = topics.split(/\r?\n|,/).map((topic) => topic.trim()).filter(Boolean); if (!cleanTopics.length) { notifyError("Añade al menos un tema."); return; } const idempotencyKey = createIdempotencyKey.current || (createIdempotencyKey.current = crypto.randomUUID()); const ok = await run(async () => { await api.createContentBatch({ site, title: title.trim() || "Campaña " + new Date().toLocaleDateString(), topics: cleanTopics, channels, brief: campaignBrief, idempotencyKey }); setTitle(""); setTopics(""); setCampaignBrief({ objective: "", audience: "", cta: "" }); setCampaignStep(0); setCreateOpen(false); }); if (ok) createIdempotencyKey.current = null; };
  const approve = (id: string) => run(() => api.approveContent(id, site));
  const variantStatus = (variant: ContentVariant) => variant.scheduleStatus || variant.status;
  const ensureApproved = (item: ContentItem) => (item.variants || []).some((variant) => canApproveStatus(variantStatus(variant))) ? api.approveContent(item.id, site) : Promise.resolve();
  const update = (id: string, topic: string) => run(() => api.updateContentItem(id, { site, topic }));
  const schedule = (id: string, value: string, channelsToSchedule: ContentChannel[]) => run(() => api.scheduleContent(id, value, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", site, channelsToSchedule));
  const saveChannelDate = (item: ContentItem, variant: ContentVariant) => {
    const key = dateKey(item.id, variant.channel); const when = dates[key] ? new Date(dates[key]) : null;
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) { notifyError("La fecha tiene que ser futura."); return; }
    const timezone = variant.scheduleTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const call = variant.status === "approved" ? api.scheduleContent(item.id, when.toISOString(), timezone, site, [variant.channel]) : api.rescheduleContent(item.id, when.toISOString(), timezone, site, [variant.channel]);
    return run(async () => { await call; setDates((current) => { const next = { ...current }; delete next[key]; return next; }); });
  };
  const publishBuffer = (item: ContentItem, channel: ContentChannel, copy?: string) => { if (channel === "blog") { notifyError("El Blog se publica mediante el webhook de Coolify configurado en Administración."); return; } return run(async () => { await ensureApproved(item); await api.publishContentViaBuffer(item.id, [channel], site, copy); }); };
  const publishBufferAll = (item: ContentItem) => { const targetChannels = (item.variants || []).filter((variant) => { const status = variantStatus(variant); return (status === "approved" || canApproveStatus(status)) && publishChannels.includes(variant.channel); }).map((variant) => variant.channel).filter((channel): channel is ContentChannel => ["instagram", "instagram_story", "linkedin", "x", "video"].includes(channel)); if (!targetChannels.length) { notifyError("Este contenido no tiene canales aprobados conectados a Buffer."); return; } return run(async () => { await ensureApproved(item); await api.publishContentViaBuffer(item.id, targetChannels, site); }); };
  const syncRemoteStatuses = () => run(async () => {
    const result = await api.syncContentRemoteStatus(site);
    onNotify?.(`Sincronización con proveedores encolada (${result.queued} tareas).`, "info");
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
  });
  const publishBlog = (item: ContentItem, variant: ContentVariant) => run(async () => {
    const status = variantStatus(variant);
    if (canApproveStatus(status)) await api.approveContent(item.id, site);
    const publicationDate = new Date().toISOString();
    const schedule = status === "approved" || canApproveStatus(status);
    await (schedule ? api.scheduleContent : api.rescheduleContent)(item.id, publicationDate, "UTC", site, ["blog"], { publishNow: true });
  });
  const reopenBlog = (item: ContentItem) => run(async () => { await api.reopenUnsentChannel(item.id, "blog", site); onNotify?.("Blog reabierto. Ya puedes publicarlo de nuevo."); });
  const skipChannel = (item: ContentItem, channel: ContentChannel) => run(() => api.cancelContentChannel(item.id, channel, site));
  const openPreview = (item: ContentItem, autoRecord = false) => {
    const params = new URLSearchParams(location.search);
    if (autoRecord) params.set("record", "1");
    navigate(contentPreviewPath(item, params.toString()), { state: { returnToContentList: true } });
  };
  const closePreview = () => {
    const openedFromList = (location.state as { returnToContentList?: boolean } | null)?.returnToContentList;
    if (openedFromList && typeof window.history.state?.idx === "number" && window.history.state.idx > 0) {
      navigate(-1);
      return;
    }
    if (previewFallback) setItems((current) => current.some((item) => item.id === previewFallback.id) ? current : [...current, previewFallback]);
    const next = new URLSearchParams(location.search);
    next.delete("record");
    next.delete("batchId");
    const search = next.toString();
    navigate(`/plans${search ? `?${search}` : ""}`, { replace: true });
  };
  const openBlogEditor = (item: ContentItem) => { setBlogForm(blogEditorValues(item)); setDialog({ type: "blog-edit", item }); };
  const savePublishedBlog = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.type !== "blog-edit") return;
    const blog = dialog.item.variants.find((variant) => variant.channel === "blog");
    if (!blog || !blogForm.title.trim() || !blogForm.content.trim()) return;
    const nextBody = { ...blog.body, title: blogForm.title.trim(), excerpt: blogForm.excerpt.trim(), ...(blogForm.usesHtml ? { bodyHtml: blogForm.content } : { body: blogForm.content }) };
    const saved = await run(() => api.updateContentItem(dialog.item.id, { site, channel: "blog", contentTitle: blogForm.title.trim(), body: nextBody, keepPublished: true }));
    if (saved) { onNotify?.("Cambios guardados. El Blog se está actualizando."); setDialog(null); }
  };
  const openSchedule = (item: ContentItem) => { setDialog({ type: "schedule", item }); setModalValue(""); setScheduleChannels((item.variants || []).filter((variant) => (variant.scheduleStatus || variant.status) === "approved").map((variant) => variant.channel)); };
  const dateSummary = (item: ContentItem) => { const values = [...new Set((item.variants || []).map((variant) => variant.publicationDate).filter(Boolean))].sort(); if (!values.length) return "Sin fecha de publicación"; if (values.length === 1) return formatDate(values[0]); return formatDate(values[0]) + " · " + formatDate(values[values.length - 1]); };
  const hasActiveFilters = Boolean(filterQuery || filterPlan !== "all" || filterStatus !== "all" || filterChannel !== "all" || filterDate !== "all" || filterArchive !== "active");
  const chooseSingleFilter = (values: string[]) => values.at(-1) === "all" ? "all" : values.filter((value) => value !== "all").at(-1) || "all";
  const statusFilterOptions = ["all", "draft", "generated", "needs_review", "approved", "scheduled", "published", "action_required", "failed", "canceled"].map((id) => ({ id, label: id === "all" ? t("contentFilters.allStatuses", "Todos") : statusLabel(id) }));
  const archiveFilterOptions = [{ id: "active", label: t("contentFilters.active", "Activos") }, { id: "archived", label: t("contentFilters.archived", "Archivados") }, { id: "all", label: t("contentFilters.allContent", "Todos") }];
  const dateFilterOptions = [
    { id: "all", label: t("contentFilters.allDates", "Todas") },
    { id: "today", label: t("contentFilters.today", "Hoy") },
    { id: "upcoming", label: t("contentFilters.upcoming", "Próximas") },
    { id: "no_date", label: t("contentFilters.noDate", "Sin fecha") },
    { id: "overdue", label: t("contentFilters.overdue", "Vencidas") },
  ];
  const activeFilterCount = [filterQuery, filterPlan !== "all", filterStatus !== "all", filterChannel !== "all", filterDate !== "all", filterArchive !== "active"].filter(Boolean).length;

  return <main className="ui-page ui-plans-page">
    {previewItemId ? <section className="ui-plan-preview-screen">
      <PageHeader eyebrow={t("contentRun.resultEyebrow", "RESULTADO")} title={previewItem ? itemTitle(previewItem) : t("contentRun.previewTitle", "Vista previa")} description={t("contentRun.previewDescription", "Revisa la pieza, sus variantes y el siguiente paso antes de publicar.")} back={<Button variant="ghost" onClick={closePreview}>← {t("contentRun.backToContent", "Volver al contenido")}</Button>} />
      {loading ? <Stack gap="md"><Card><Progress value={35} /><p className="ui-muted">Cargando contenido…</p></Card></Stack> : previewItem ? <Stack gap="md">
        <div className="ui-content-run-layout">
          <div className="ui-content-run-artifacts"><ContentPackPreview site={site} item={previewItem} autoRecord={searchParams.get("record") === "1"} bufferReady={bufferReady} publishChannels={publishChannels} busy={busy} onVideoUploaded={(replacedPrevious) => { onNotify?.(replacedPrevious ? "Vídeo guardado. Se reemplazó el anterior del mismo formato." : "Vídeo guardado."); void load(); }} onNotify={onNotify} onClose={closePreview} onEditBlog={() => openBlogEditor(previewItem)} onPublish={(channel, copy) => void publishBuffer(previewItem, channel, copy)} onPublishAll={() => void publishBufferAll(previewItem)} /></div>
          <ContentRunReviewRail item={previewItem} busy={busy} t={t} onApprove={() => void approve(previewItem.id)} onOpenChannels={() => setDialog({ type: "details", item: previewItem })} onArchive={() => void archiveContent(previewItem)} />
        </div>
      </Stack> : <EmptyState title={error ? "No se pudo abrir la vista previa" : "No se encontró este contenido"} description={error || "Puede que se haya eliminado o que ya no tengas acceso."} action={<Button variant="secondary" onClick={closePreview}>Volver al contenido</Button>} />}
    </section> : <>
      <PageHeader eyebrow="Espacio editorial" title="Contenido" description={bufferReady ? "Revisa piezas en «Pendiente de revisión» antes de aprobar. Buffer listo para redes; blog sale por Coolify/webhook al publicar." : "Revisa piezas en «Pendiente de revisión» antes de aprobar. Conecta Buffer (redes) y Coolify/webhook (blog) en Ajustes → Conexiones antes de publicar."} actions={<Inline gap="sm"><Button variant="ghost" disabled={busy || loading} onClick={() => void syncRemoteStatuses()}>Sincronizar estados</Button><Button variant="secondary" onClick={() => navigate("/calendar")}>Calendario editorial</Button>{creationEnabled && <Button onClick={() => { setCampaignStep(0); setCreateOpen(true); }}>Nueva campaña</Button>}</Inline>} />
      {error && !items.length && <EmptyState title="No se pudo cargar el contenido" description={error} action={<Button variant="ghost" size="sm" onClick={() => void load()}>Reintentar</Button>} />}
      {!loading && setupRequired && <EmptyState title="Configura tu marca para comenzar" description="Un administrador debe inicializar el espacio y asignarte una marca antes de mostrar publicaciones." />}
      {!loading && !setupRequired && view !== "library" && !items.length && !standaloneAssets.length && !error && <EmptyState title="Todavía no hay contenido" description="Crea una campaña aquí o desde ChatGPT. Cuando esté lista, aparecerá en esta bandeja." />}
      {loading ? <Stack gap="md"><Card><Progress value={35} /><p className="ui-muted">Cargando contenido…</p></Card></Stack> : !setupRequired && (view === "library" || items.length > 0 || plans.length > 0 || standaloneAssets.length > 0) && <div className="ui-plans-workspace">
        <Tabs items={[{ id: "campaigns", label: "Campañas" }, { id: "library", label: "Biblioteca de activos" }]} value={view} onChange={(next) => updateSearchParam("view", next, "campaigns")} idPrefix="content-view-tabs" panelIdPrefix="content-view-panel" ariaLabel="Vista del contenido" />
        <div className="ui-content-filterbar">
          <div className="ui-content-filter-top">
            <Field label={t("contentFilters.search", "Buscar")}><TextField value={filterQuery} onChange={(event) => updateSearchParam("q", event.target.value, "")} placeholder={t("contentFilters.searchPlaceholder", "Título, brief o campaña")} /></Field>
            <details className="ui-content-filter-drawer"><summary><span>{t("contentFilters.more", "Filtros")}</span>{activeFilterCount > 0 && <Badge tone="info">{activeFilterCount}</Badge>}</summary><div className="ui-content-filter-drawer-body">
              <div className="ui-content-filter-group"><span className="ui-field-label">{t("contentFilters.archive", "Archivo")}</span><MultiSelectPills options={archiveFilterOptions} value={[filterArchive]} onChange={(values) => updateSearchParam("archive", chooseSingleFilter(values), "active")} ariaLabel={t("contentFilters.archive", "Archivo")} /></div>
              {view !== "library" && <div className="ui-content-filter-group"><span className="ui-field-label">{t("contentFilters.channel", "Canal")}</span><MultiSelectPills options={[{ id: "all", label: t("contentFilters.allChannels", "Todos") }, ...channels.map((channel) => ({ id: channel, label: channelLabel(channel) }))]} value={[filterChannel]} onChange={(values) => updateSearchParam("channel", chooseSingleFilter(values))} ariaLabel={t("contentFilters.channel", "Canal")} /></div>}
              <div className="ui-content-filter-group"><span className="ui-field-label">{t("contentFilters.status", "Estado")}</span><MultiSelectPills options={statusFilterOptions} value={[filterStatus]} onChange={(values) => updateSearchParam("status", chooseSingleFilter(values))} ariaLabel={t("contentFilters.status", "Estado")} /></div>
              <div className="ui-content-filter-group"><span className="ui-field-label">{t("contentFilters.date", "Fecha")}</span><MultiSelectPills options={dateFilterOptions} value={[filterDate]} onChange={(values) => updateSearchParam("date", chooseSingleFilter(values))} ariaLabel={t("contentFilters.date", "Fecha")} /></div>
              <div className="ui-content-filter-more-grid"><Field label={t("contentFilters.campaign", "Campaña")}><Select value={filterPlan} onChange={(event) => updateSearchParam("plan", event.target.value)}><option value="all">{t("contentFilters.allCampaigns", "Todas las campañas")}</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</Select></Field><Field label={t("contentFilters.sort", "Ordenar por")}><Select value={sortOrder} onChange={(event) => updateSearchParam("sort", event.target.value, "date")}><option value="date">{t("contentFilters.sortDate", "Próxima fecha")}</option><option value="status">{t("contentFilters.sortStatus", "Estado")}</option><option value="title">{t("contentFilters.sortTitle", "Título A-Z")}</option></Select></Field></div>
            </div></details>
            <div className="ui-filter-summary"><span>{visibleItems.length} {t("contentFilters.results", "resultados")}</span>{hasActiveFilters && <Button size="sm" variant="ghost" onClick={clearFilters}>{t("contentFilters.clear", "Limpiar filtros")}</Button>}</div>
          </div>
        </div>
        {view !== "library" && visibleItems.length > 0 && <Inline gap="sm" className="ui-content-batch-toolbar"><Checkbox label={t("contentFilters.selectVisible", "Seleccionar visibles")} checked={allVisibleItemsSelected} onChange={() => setSelectedItemIds(allVisibleItemsSelected ? [] : visibleItems.map((item) => item.id))} /><Button size="sm" variant="ghost" disabled={!selectedItemIds.length} onClick={() => setSelectedItemIds([])}>{t("contentFilters.clearSelection", "Limpiar")}</Button>{selectedItemIds.length > 0 && <><Badge tone="info">{selectedItemIds.length} {t("contentFilters.selected", "seleccionadas")}</Badge><Button size="sm" variant="secondary" disabled={busy} onClick={() => void archiveSelectedItems()}>{filterArchive === "archived" ? t("contentRun.restore", "Restaurar") : t("contentRun.archive", "Archivar")}</Button></>}</Inline>}
        {view === "library" ? <div id="content-view-panel-library" role="tabpanel" aria-labelledby="content-view-tabs-library" tabIndex={0}><ContentAssetLibrary groups={libraryGroups} standaloneAssets={visibleStandaloneAssets} filterChannel={filterChannel} channelOptions={channels} onChannelChange={(channel) => updateSearchParam("channel", channel)} t={t} onOpen={openPreview} onDeleteMany={deleteStandaloneAssets} onEditMany={editStandaloneAssets} onUpload={uploadStandaloneAssets} /></div> : <div id="content-view-panel-campaigns" role="tabpanel" aria-labelledby="content-view-tabs-campaigns" tabIndex={0}>{visibleItems.length ? <Stack gap="sm">{visibleItems.map((item) => {
          const status = aggregateStatus(item); const titleText = itemTitle(item); const cover = itemCover(item); const excerpt = itemExcerpt(item);
          return <Card className="ui-review-item" key={item.id}><div className="ui-card-head"><div className="ui-review-item-title"><Checkbox label="" aria-label={`${item.metadata?.archivedAt ? t("contentRun.restore", "Restaurar") : t("contentRun.archive", "Archivar")}: ${titleText}`} checked={selectedItemIds.includes(item.id)} onChange={() => toggleItemSelection(item)} />{cover ? <img className="ui-review-thumb" src={cover} alt="" loading="lazy" decoding="async" /> : <span className="ui-review-thumb" aria-hidden="true" />}<div><span className="ui-eyebrow">{item.planTitle || "Contenido"}</span><h3>{titleText}</h3>{excerpt && <p className="ui-review-excerpt">{excerpt}</p>}<p className="ui-muted">{dateSummary(item)}</p></div></div><StatusBadge status={status} label={statusLabel(status)} /></div><div className="ui-channel-list">{(item.variants || []).map((variant) => <ChannelBadge key={variant.id} channel={variant.channel} />)}</div>{item.error && <p className="ui-field-error">{item.error}</p>}<div className="ui-card-actions"><Button variant="secondary" size="sm" disabled={busy} onClick={() => setDialog({ type: "details", item })}>Canales y publicación</Button><Link className="ui-button ui-button-ghost ui-button-sm" to={contentPreviewPath(item, location.search)} state={{ returnToContentList: true }}>Vista previa</Link><Button variant="ghost" size="sm" disabled={busy} onClick={() => void archiveContent(item)}>{item.metadata?.archivedAt ? t("contentRun.restore", "Restaurar") : t("contentRun.archive", "Archivar")}</Button></div></Card>;
        })}</Stack> : <EmptyState title="No hay publicaciones con estos filtros" description="Prueba otra combinación de búsqueda, estado, canal o fecha." action={hasActiveFilters ? <Button variant="secondary" onClick={clearFilters}>Limpiar filtros</Button> : undefined} />}</div>}
      </div>}
    </>}
    <Drawer open={Boolean(detailItem)} title={detailItem ? itemTitle(detailItem) : "Canales y publicación"} onClose={() => setDialog(null)}>
      {detailItem && <Stack gap="md">
        <p className="ui-muted">{detailItem.planTitle || "Contenido"} · {dateSummary(detailItem)}</p>
        {itemExcerpt(detailItem) && <p>{itemExcerpt(detailItem)}</p>}
        {detailItem.variants.map((variant) => {
          const key = dateKey(detailItem.id, variant.channel);
          const currentStatus = variant.scheduleStatus || variant.status;
          const serverDate = localDateInput(variant.publicationDate);
          const draftDate = dates[key] ?? serverDate;
          const editableDate = ["approved", "scheduled", "failed", "action_required"].includes(currentStatus);
          const canSkip = !["published", "canceled", "syncing"].includes(currentStatus);
          const canPublishSocial = variant.channel !== "blog" && (currentStatus === "approved" || canApproveStatus(currentStatus)) && publishChannels.includes(variant.channel);
          const missingConnection = variant.channel !== "blog" && (currentStatus === "approved" || canApproveStatus(currentStatus)) && !publishChannels.includes(variant.channel);
          return <Card key={variant.id} className="ui-channel-detail">
            <Inline gap="sm"><ChannelBadge channel={variant.channel} /><StatusBadge status={currentStatus} label={statusLabel(currentStatus)} /></Inline>
            <p className="ui-muted">{variant.publicationDate ? formatDate(variant.publicationDate) : "Sin fecha de publicación"}</p>
            {editableDate && <Inline gap="sm"><TextField type="datetime-local" aria-label={"Fecha de " + channelLabel(variant.channel)} value={draftDate} onChange={(event) => setDates((current) => ({ ...current, [key]: event.target.value }))} /><Button size="sm" disabled={busy || !draftDate || draftDate === serverDate} onClick={() => void saveChannelDate(detailItem, variant)}>Guardar fecha</Button></Inline>}
            {variant.lastError && <p className="ui-field-error">{variant.lastError}</p>}
            {currentStatus === "published" && <p className="ui-field-hint">Este canal ya fue publicado. No se volverá a enviar.</p>}
            {variant.channel === "blog" && currentStatus === "syncing" && <p className="ui-field-hint">Coolify está desplegando el artículo. Se marcará como publicado cuando la URL esté visible.</p>}
            {currentStatus === "canceled" && <p className="ui-field-hint">Este canal quedó marcado como “No publicar”.</p>}
            {variant.channel === "blog" && (canApproveStatus(currentStatus) || ["approved", "scheduled", "failed", "action_required"].includes(currentStatus)) && <Button size="sm" disabled={busy} onClick={() => void publishBlog(detailItem, variant)}>Publicar Blog ahora</Button>}
            {variant.channel === "blog" && currentStatus === "published" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => openBlogEditor(detailItem)}>Editar publicación</Button>}
            {variant.channel === "blog" && variant.status === "published" && ["published", "action_required"].includes(currentStatus) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reopenBlog(detailItem)}>No aparece en el Blog</Button>}
            {canPublishSocial && variant.channel === "video" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => openPreview(detailItem, true)}>Grabar o subir vídeo</Button>}
            {canPublishSocial && <Button size="sm" disabled={busy} onClick={() => void publishBuffer(detailItem, variant.channel)}>{variant.channel === "video" ? "Publicar Reel en Buffer" : "Publicar ahora"}</Button>}
            {missingConnection && variant.channel === "video" && <p className="ui-field-hint">Asigna la cuenta de Reel en Buffer (campo «Vídeo / Reel» o Instagram) en <Link className="text-link" to={connectionsPath}>Conexiones</Link> y vuelve aquí para publicar.</p>}
            {missingConnection && variant.channel !== "video" && <p className="ui-field-hint">Este canal no tiene una conexión activa. Configúralo en <Link className="text-link" to={connectionsPath}>Conexiones</Link> o márcalo como «No publicar».</p>}
            {canSkip && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void skipChannel(detailItem, variant.channel)}>No publicar</Button>}
          </Card>;
        })}
        {detailItem.variants.some((variant) => (variant.scheduleStatus || variant.status) === "approved") && <Button variant="secondary" size="sm" disabled={busy} onClick={() => openSchedule(detailItem)}>Agendar canales pendientes</Button>}
        <Card>
          <h3>Opciones del contenido completo</h3>
          <p className="ui-field-hint">Estas acciones afectan todos los canales que todavía no se publicaron.</p>
          <Inline gap="sm">
            {detailItem.variants.some((variant) => canApproveStatus(variant.scheduleStatus || variant.status)) && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void approve(detailItem.id)}>Aprobar canales pendientes</Button>}
            {!detailItem.variants.every((variant) => ["published", "canceled"].includes(variant.scheduleStatus || variant.status)) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDialog({ type: "edit", item: detailItem }); setModalValue(detailItem.topic); }}>Editar brief original</Button>}
          </Inline>
        </Card>
      </Stack>}
    </Drawer>
    <Modal open={dialog?.type === "edit" || dialog?.type === "schedule"} title={dialog?.type === "edit" ? "Editar brief original" : "Agendar publicación"} onClose={() => setDialog(null)}>{dialog?.type === "edit" && <form className="ui-stack ui-stack-md" onSubmit={(event) => { event.preventDefault(); if (modalValue.trim()) void update(dialog.item.id, modalValue.trim()).then(() => setDialog(null)); }}><Field label="Brief original" hint="Cambia la consigna editorial del item. No modifica automáticamente los textos ya generados para cada canal." required><Textarea value={modalValue} onChange={(event) => setModalValue(event.target.value)} rows={6} autoFocus required /></Field><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" loading={busy}>Guardar brief</Button></Inline></form>}{dialog?.type === "schedule" && <form className="ui-stack ui-stack-md" onSubmit={(event) => { event.preventDefault(); if (!modalValue || !scheduleChannels.length) { notifyError("Selecciona al menos un canal para agendar."); return; } void schedule(dialog.item.id, new Date(modalValue).toISOString(), scheduleChannels).then(() => setDialog(null)); }}><Field label="Fecha y hora" hint="Se usará tu zona horaria local." required><TextField type="datetime-local" value={modalValue} onChange={(event) => setModalValue(event.target.value)} autoFocus required /></Field><fieldset className="ui-field"><legend className="ui-field-label">Canales a agendar</legend><div className="ui-channel-select" role="group" aria-label="Canales a agendar">{dialog.item.variants.filter((variant) => (variant.scheduleStatus || variant.status) === "approved").map((variant) => <Checkbox key={variant.id} label={channelLabel(variant.channel)} checked={scheduleChannels.includes(variant.channel)} onChange={(event) => setScheduleChannels((current) => event.target.checked ? [...new Set([...current, variant.channel])] : current.filter((channel) => channel !== variant.channel))} />)}</div><small className="ui-field-hint">Solo aparecen canales aprobados y todavía pendientes de publicación.</small></fieldset><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" loading={busy} disabled={!scheduleChannels.length}>Agendar canales</Button></Inline></form>}</Modal>
    <Modal open={dialog?.type === "blog-edit"} title="Editar publicación" onClose={() => setDialog(null)}>{dialog?.type === "blog-edit" && <form className="ui-stack ui-stack-md" onSubmit={(event) => void savePublishedBlog(event)}><Field label="Título" hint={`${blogForm.title.length}/${CONTENT_TITLE_MAX}. La URL actual se conservará.`} required><TextField value={blogForm.title} maxLength={CONTENT_TITLE_MAX} onChange={(event) => setBlogForm((current) => ({ ...current, title: event.target.value }))} autoFocus required /></Field><Field label="Extracto"><Textarea value={blogForm.excerpt} onChange={(event) => setBlogForm((current) => ({ ...current, excerpt: event.target.value }))} rows={4} /></Field><Field label="Contenido del artículo" hint="Al guardar se despliega una nueva versión del Blog." required><Textarea value={blogForm.content} onChange={(event) => setBlogForm((current) => ({ ...current, content: event.target.value }))} rows={18} required /></Field><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" loading={busy} disabled={!blogForm.title.trim() || !blogForm.content.trim()}>Guardar y actualizar</Button></Inline></form>}</Modal>
    <Modal open={createOpen} title="Nueva campaña" onClose={() => setCreateOpen(false)}><form className="ui-stack ui-stack-md" onSubmit={(event) => void create(event)}><div className="ui-step-list" aria-label="Pasos de la campaña"><Badge tone={campaignStep === 0 ? "info" : "success"}>1. Objetivo</Badge><Badge tone={campaignStep === 1 ? "info" : campaignStep > 1 ? "success" : "neutral"}>2. Contenido</Badge><Badge tone={campaignStep === 2 ? "info" : "neutral"}>3. Confirmar</Badge></div>{campaignStep === 0 && <Stack gap="md"><Field label="¿Qué quieres conseguir?" hint="Ayuda a la IA a elegir el enfoque y el cierre." required><Textarea value={campaignBrief.objective} onChange={(event) => setCampaignBrief((current) => ({ ...current, objective: event.target.value }))} rows={3} autoFocus required placeholder="Explicar una idea y conseguir que la audiencia pida una demo" /></Field><Field label="¿Para quién es?" hint="Describe la audiencia en una frase." required><TextField value={campaignBrief.audience} onChange={(event) => setCampaignBrief((current) => ({ ...current, audience: event.target.value }))} required placeholder="Responsables de marketing de empresas pequeñas" /></Field><Field label="Llamada a la acción" hint="Opcional. Qué quieres que haga la persona después."><TextField value={campaignBrief.cta} onChange={(event) => setCampaignBrief((current) => ({ ...current, cta: event.target.value }))} placeholder="Pide una demo" /></Field></Stack>}{campaignStep === 1 && <Stack gap="md"><Field label="Título de la campaña" hint="Puedes dejarlo vacío y se generará automáticamente."><TextField value={title} onChange={(event) => { createIdempotencyKey.current = null; setTitle(event.target.value); }} autoFocus placeholder="Campaña de septiembre" /></Field><Field label="¿Qué piezas quieres crear?" hint="Una idea por línea. La campaña las convertirá en variantes por canal." required><Textarea value={topics} onChange={(event) => { createIdempotencyKey.current = null; setTopics(event.target.value); }} rows={7} required placeholder={"La IA acelera la producción, pero el criterio se convierte en el cuello de botella\nCómo revisar UX, UI y producto antes de publicar"} /></Field></Stack>}{campaignStep === 2 && <Stack gap="md"><h3>Todo listo para preparar el borrador</h3><p className="ui-muted"><strong>{campaignBrief.objective}</strong> para {campaignBrief.audience}.</p><p>{topics.split(/\r?\n|,/).filter((topic) => topic.trim()).length} piezas · {channels.map(channelLabel).join(", ")}</p><p className="ui-field-hint">La IA guardará borradores. Una persona tendrá que revisar y aprobar cada canal antes de publicar.</p></Stack>}<Inline gap="md"><Button type="button" variant="ghost" onClick={() => campaignStep ? setCampaignStep((current) => current - 1) : setCreateOpen(false)}>Atrás</Button>{campaignStep < 2 ? <Button type="button" disabled={(campaignStep === 0 && (!campaignBrief.objective.trim() || !campaignBrief.audience.trim())) || (campaignStep === 1 && !topics.trim())} onClick={() => setCampaignStep((current) => current + 1)}>Continuar</Button> : <Button type="submit" loading={busy}>Crear borradores</Button>}</Inline></form></Modal>
  </main>;
}
