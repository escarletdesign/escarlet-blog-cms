import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "./api";
import { itemTitle, statusLabel } from "./content-format";
import type { ContentItem, ContentVariant, MediaItem } from "./types";
import { Badge, Button, Card, ChannelBadge, EmptyState, Field, Inline, PageHeader, Skeleton, Stack, StatusBadge, Switch, TextField } from "./ui";

type PublisherProps = { site: string; t: (key: string, fallback?: string) => string };

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function assetLabel(asset: MediaItem) {
  return asset.filename || asset.alt || asset.id || "Asset sin nombre";
}

function assetUrl(asset: MediaItem) {
  return asset.thumbUrl || asset.previewUrl || asset.url || asset.publicUrl || asset.path || "";
}

function assetIsVideo(asset: MediaItem) {
  return String(asset.contentType || asset.kind || asset.metadata?.mimeType || "").toLowerCase().includes("video") || /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(assetUrl(asset));
}

function assetGroupKey(asset: MediaItem) {
  const metadata = asset.metadata || {};
  const grounding = metadata.brandGrounding || metadata.brand_grounding || {};
  const verified = metadata.generationRunId || metadata.generation_run_id || metadata.preparationId || metadata.preparation_id || metadata.generationReceiptId || metadata.generation_receipt_id || grounding.generationRunId || grounding.preparationId;
  return verified ? `generation:${String(verified)}` : `asset:${String(asset.id || asset.path || asset.filename || asset.alt || "unidentified")}`;
}

type OrphanGroup = { key: string; assets: MediaItem[]; title: string; grouped: boolean };

function variantCanPublish(variant: ContentVariant) {
  const statuses = [variant.scheduleStatus, variant.status].filter(Boolean);
  if (statuses.some((status) => ["draft", "canceled", "scheduled", "syncing", "publishing", "published"].includes(String(status)))) return false;
  if (variant.channel === "video" && !variant.media?.length) return false;
  return Boolean(variant.body?.text || variant.body?.caption || variant.body?.body || variant.body?.bodyHtml || variant.media?.length);
}

export function Publisher({ site, t }: PublisherProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [posts, setPosts] = useState<ContentItem[]>([]);
  const [assets, setAssets] = useState<MediaItem[]>([]);
  const [postId, setPostId] = useState(searchParams.get("itemId") || "");
  const [postSearch, setPostSearch] = useState("");
  const [orphanSelection, setOrphanSelection] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      api.contentItems(site, undefined, { archive: "active" }),
      api.managedProductionAssets(site).catch(() => ({ assets: [] as MediaItem[] })),
    ]).then(([content, media]) => {
      if (!active) return;
      const nextPosts = (content.items || []).filter((item) => item.status !== "canceled" && item.status !== "archived" && item.variants?.length);
      setPosts(nextPosts);
      setAssets(media.assets || []);
      setPostId((current) => nextPosts.some((item) => item.id === current) ? current : nextPosts[0]?.id || "");
    }).catch((cause) => { if (active) setError(errorText(cause, t("publisher.postsError", "No se pudieron cargar los Posts."))); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [site, t]);

  const selectedPost = posts.find((post) => post.id === postId) || null;
  const availableVariants = useMemo(() => selectedPost?.variants || [], [selectedPost]);
  const publishableVariants = useMemo(() => availableVariants.filter(variantCanPublish), [availableVariants]);
  const filteredPosts = useMemo(() => {
    const normalized = postSearch.trim().toLocaleLowerCase();
    if (!normalized) return posts;
    return posts.filter((post) => `${itemTitle(post)} ${statusLabel(post.status)} ${post.planTitle || ""}`.toLocaleLowerCase().includes(normalized));
  }, [postSearch, posts]);
  const orphanGroups = useMemo<OrphanGroup[]>(() => {
    const groups = new Map<string, MediaItem[]>();
    for (const asset of assets) {
      const key = assetGroupKey(asset);
      groups.set(key, [...(groups.get(key) || []), asset]);
    }
    return [...groups.entries()].map(([key, group]) => ({ key, assets: group, title: assetLabel(group[0]), grouped: key.startsWith("generation:") }));
  }, [assets]);

  useEffect(() => {
    setSelectedChannels(publishableVariants.map((variant) => variant.channel));
    setResult(null);
  }, [postId, publishableVariants]);

  const toggleChannel = (channel: string) => {
    setSelectedChannels((current) => current.includes(channel) ? current.filter((value) => value !== channel) : [...current, channel]);
    setResult(null);
  };

  const publish = async (channels: string[]) => {
    if (!selectedPost || !channels.length) return;
    const variants = selectedPost.variants.filter((variant) => channels.includes(variant.channel));
    if (!variants.length || variants.some((variant) => !variantCanPublish(variant))) {
      setError(t("publisher.incompletePost", "Este Post tiene variantes incompletas. Ábrelo, retira los elementos defectuosos o completa el contenido antes de publicar."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const reviewNeeded = variants.some((variant) => ["generated", "needs_review"].includes(variant.scheduleStatus || variant.status));
      if (reviewNeeded) await api.approveContent(selectedPost.id, site);
      const response = await api.scheduleContent(selectedPost.id, new Date().toISOString(), "UTC", site, channels, { publishNow: true });
      setResult({ ...response, itemId: selectedPost.id, channels });
      setPosts((current) => current.map((item) => item.id === selectedPost.id ? { ...item, status: "syncing" } : item));
    } catch (cause) {
      setError(errorText(cause, t("publisher.publishError", "No se pudo publicar el Post.")));
    } finally {
      setBusy(false);
    }
  };

  const createPostFromAssets = async (group: OrphanGroup) => {
    const channels = [...new Set(group.assets.map((asset) => String(asset.metadata?.channel || asset.metadata?.contentChannel || "").trim()).filter(Boolean))];
    if (!channels.length) channels.push(group.assets.some(assetIsVideo) ? "video" : "instagram");
    const mediaAssetIds = group.assets.map((asset) => asset.id).filter(Boolean).map(String);
    setBusy(true);
    setError("");
    try {
      const created = await api.createContentBatch({ site, title: group.assets.length > 1 ? `${group.title} (${group.assets.length} assets)` : group.title, topics: [{ title: group.title, brief: "Post creado desde un grupo de assets sin Post asociado." }], channels, brief: { source: "publication-inbox", externalGeneration: true, orphanGroupKey: group.key } });
      const itemId = created.itemIds?.[0];
      if (itemId) for (const channel of channels) await api.updateContentItem(itemId, { site, channel, mediaAssetIds });
      setOrphanSelection((current) => current.filter((key) => key !== group.key && !group.key.startsWith("manual:")));
      if (itemId) navigate(`/content/${encodeURIComponent(itemId)}`);
    } catch (cause) {
      setError(errorText(cause, t("publisher.orphanCreateError", "No se pudo crear el Post desde este grupo de assets.")));
    } finally {
      setBusy(false);
    }
  };

  const createPostFromSelectedGroups = () => {
    const selected = orphanGroups.filter((group) => orphanSelection.includes(group.key));
    if (selected.length < 2) return;
    void createPostFromAssets({ key: `manual:${selected.map((group) => group.key).join(",")}`, assets: selected.flatMap((group) => group.assets), title: selected[0].title, grouped: true });
  };

  return <main className="ui-page ui-publication-page">
    <PageHeader eyebrow={t("publisher.eyebrow", "PUBLICACIÓN")} title={t("publisher.title", "Publicar un Post")} description={t("publisher.description", "Elige un Post completo o publica solo las variantes que estén listas. Cada canal usa su destino y proveedor configurado.")} />
    {error && <Card><p className="ui-field-error" role="alert">{error}</p></Card>}
    {loading ? <div className="ui-publication-grid"><Skeleton height="260px" /><Skeleton height="260px" /></div> : !posts.length ? <EmptyState title={t("publisher.empty", "No hay Posts publicables")} description={t("publisher.emptyHelp", "Crea un Post desde Contenido o convierte un asset independiente en un Post borrador.")} action={<Link className="ui-button ui-button-secondary" to="/content">Abrir contenido</Link>} /> : <div className="ui-publication-grid">
      <Card><Stack gap="md"><div><span className="ui-eyebrow">{t("publisher.postEyebrow", "POST")}</span><h2>{t("publisher.postTitle", "Selecciona el Post")}</h2></div><Field label={t("publisher.postSearch", "Buscar Posts")}><TextField value={postSearch} onChange={(event) => setPostSearch(event.target.value)} placeholder={t("publisher.postSearchPlaceholder", "Título, campaña o estado")} /></Field><div className="ui-publication-post-picker" role="listbox" aria-label={t("publisher.postSelect", "Post")}>{filteredPosts.length ? filteredPosts.map((post) => <Button key={post.id} type="button" size="sm" variant={post.id === postId ? "secondary" : "ghost"} className={`ui-publication-post-option${post.id === postId ? " active" : ""}`} aria-pressed={post.id === postId} onClick={() => setPostId(post.id)}><strong>{itemTitle(post)}</strong><span>{statusLabel(post.status)}</span></Button>) : <p className="ui-muted">{t("publisher.noPostsMatch", "No hay Posts que coincidan con la búsqueda.")}</p>}</div>{selectedPost && <><div className="ui-publication-post-summary"><div><h3>{itemTitle(selectedPost)}</h3><p className="ui-muted">{selectedPost.variants.length} {t("publisher.variants", "variantes")} · {publishableVariants.length} {t("publisher.publishable", "listas para publicar")}</p></div><StatusBadge status={selectedPost.status} label={statusLabel(selectedPost.status)} /></div><div className="ui-publication-channel-list">{availableVariants.map((variant) => { const publishable = variantCanPublish(variant); const status = variant.scheduleStatus || variant.status; return <Switch key={variant.id} label={<><ChannelBadge channel={variant.channel} /><StatusBadge status={status} label={statusLabel(status)} /></>} description={!publishable && ["scheduled", "syncing", "publishing", "published"].includes(status) ? t("publisher.alreadyHandled", "Este canal ya está programado o publicado") : undefined} checked={publishable && selectedChannels.includes(variant.channel)} disabled={!publishable || busy} onChange={() => toggleChannel(variant.channel)} />; })}</div>{!publishableVariants.length && <p className="ui-field-hint">{t("publisher.noPendingVariants", "No hay variantes pendientes. Los canales programados o publicados no se vuelven a enviar desde aquí.")}</p>}<Inline gap="sm"><Button variant="secondary" disabled={busy || !publishableVariants.length} loading={busy} onClick={() => void publish(publishableVariants.map((variant) => variant.channel))}>{t("publisher.publishPost", "Publicar pendientes")}</Button><Button disabled={busy || !selectedChannels.length} loading={busy} onClick={() => void publish(selectedChannels.filter((channel) => publishableVariants.some((variant) => variant.channel === channel)))}>{t("publisher.publishChannels", "Publicar seleccionados")}</Button></Inline><Link className="ui-button ui-button-ghost ui-button-sm" to={`/content/${encodeURIComponent(selectedPost.id)}`}>{t("publisher.openPost", "Abrir y editar Post")}</Link></>}</Stack></Card>
      <Card><Stack gap="md"><div><span className="ui-eyebrow">{t("publisher.orphanEyebrow", "INBOX DE ASSETS")}</span><h2>{t("publisher.orphanTitle", "Assets sin Post")}</h2><p className="ui-muted">{t("publisher.orphanHelp", "Los assets con la misma generación se agrupan para crear un único Post borrador.")}</p>{orphanSelection.length > 1 && <Button size="sm" variant="secondary" disabled={busy} onClick={createPostFromSelectedGroups}>{t("publisher.createSelectedPost", "Crear Post con selección")} ({orphanSelection.length})</Button>}</div>{orphanGroups.length ? <div className="ui-publication-orphans">{orphanGroups.map((group) => <div className="ui-publication-orphan" key={group.key}><div className="ui-publication-orphan-meta"><div className="ui-publication-orphan-preview"><Switch label="" aria-label={`${t("publisher.selectOrphan", "Seleccionar grupo")}: ${group.title}`} checked={orphanSelection.includes(group.key)} disabled={busy} onChange={() => setOrphanSelection((current) => current.includes(group.key) ? current.filter((key) => key !== group.key) : [...current, group.key])} />{group.assets.slice(0, 4).map((asset) => { const url = assetUrl(asset); return url ? assetIsVideo(asset) ? <video key={asset.id || asset.path} src={url} muted preload="metadata" aria-label={assetLabel(asset)} /> : <img key={asset.id || asset.path} src={url} alt={asset.alt || assetLabel(asset)} loading="lazy" decoding="async" /> : <span className="ui-publication-orphan-preview-more" key={asset.id || asset.path}>✦</span>; })}{group.assets.length > 4 && <span className="ui-publication-orphan-preview-more">+{group.assets.length - 4}</span>}</div><strong>{group.title}</strong><span>{group.assets.length} {group.assets.length === 1 ? t("publisher.asset", "asset") : t("publisher.assets", "assets")} · {group.grouped ? t("publisher.groupedGeneration", "misma generación") : t("publisher.standaloneAsset", "sin agrupación detectada")}</span></div><Button size="sm" variant="secondary" disabled={busy} onClick={() => void createPostFromAssets(group)}>{t("publisher.createPost", "Crear Post")}</Button></div>)}</div> : <EmptyState title={t("publisher.noOrphans", "No hay assets independientes")} description={t("publisher.noOrphansHelp", "Los assets asociados aparecerán dentro de su Post.")} />}</Stack></Card>
    </div>}
    {result && <Card className="ui-publication-result"><Inline gap="sm"><StatusBadge status={String(result.status || "syncing")} /><Badge tone="success">{t("publisher.queued", "Enviado al control de publicación")}</Badge></Inline><p className="ui-muted">{t("publisher.queuedHelp", "Puedes revisar el estado real de cada variante en el Post y en Calendario.")}</p>{selectedPost && <Link className="ui-button ui-button-secondary" to={`/content/${encodeURIComponent(selectedPost.id)}`}>{t("publisher.openPost", "Abrir Post")}</Link>}</Card>}
  </main>;
}
