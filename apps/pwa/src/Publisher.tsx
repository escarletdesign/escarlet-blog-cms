import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "./api";
import { itemTitle, statusLabel } from "./content-format";
import type { ContentItem, ContentVariant, MediaItem } from "./types";
import { Badge, Button, Card, ChannelBadge, Checkbox, EmptyState, Inline, PageHeader, Select, Skeleton, Stack, StatusBadge } from "./ui";

type PublisherProps = { site: string; t: (key: string, fallback?: string) => string };

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function assetLabel(asset: MediaItem) {
  return asset.filename || asset.alt || asset.id || "Asset sin nombre";
}

function variantCanPublish(variant: ContentVariant) {
  const status = variant.scheduleStatus || variant.status;
  if (["draft", "canceled"].includes(status)) return false;
  if (variant.channel === "video" && !variant.media?.length) return false;
  return Boolean(variant.body?.text || variant.body?.caption || variant.body?.body || variant.body?.bodyHtml || variant.media?.length);
}

export function Publisher({ site, t }: PublisherProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [posts, setPosts] = useState<ContentItem[]>([]);
  const [assets, setAssets] = useState<MediaItem[]>([]);
  const [postId, setPostId] = useState(searchParams.get("itemId") || "");
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

  useEffect(() => {
    setSelectedChannels(availableVariants.map((variant) => variant.channel));
    setResult(null);
  }, [postId, availableVariants]);

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

  const createPostFromAsset = async (asset: MediaItem) => {
    const channel = String(asset.kind || asset.contentType || "").toLowerCase().includes("video") ? "video" : "instagram";
    setBusy(true);
    setError("");
    try {
      const created = await api.createContentBatch({ site, title: assetLabel(asset), topics: [{ title: assetLabel(asset), brief: "Post creado desde un asset sin Post asociado." }], channels: [channel], brief: { source: "publication-inbox", externalGeneration: true } });
      const itemId = created.itemIds?.[0];
      if (itemId) await api.updateContentItem(itemId, { site, channel, mediaAssetIds: asset.id ? [String(asset.id)] : [] });
      if (itemId) navigate(`/content/${encodeURIComponent(itemId)}`);
    } catch (cause) {
      setError(errorText(cause, t("publisher.orphanCreateError", "No se pudo crear el Post desde este asset.")));
    } finally {
      setBusy(false);
    }
  };

  return <main className="ui-page ui-publication-page">
    <PageHeader eyebrow={t("publisher.eyebrow", "PUBLICACIÓN")} title={t("publisher.title", "Publicar un Post")} description={t("publisher.description", "Elige un Post completo o publica solo las variantes que estén listas. Cada canal usa su destino y proveedor configurado.")} />
    {error && <Card><p className="ui-field-error" role="alert">{error}</p></Card>}
    {loading ? <div className="ui-publication-grid"><Skeleton height="260px" /><Skeleton height="260px" /></div> : !posts.length ? <EmptyState title={t("publisher.empty", "No hay Posts publicables")} description={t("publisher.emptyHelp", "Crea un Post desde Contenido o convierte un asset independiente en un Post borrador.")} action={<Link className="ui-button ui-button-secondary" to="/content">Abrir contenido</Link>} /> : <div className="ui-publication-grid">
      <Card><Stack gap="md"><div><span className="ui-eyebrow">{t("publisher.postEyebrow", "POST")}</span><h2>{t("publisher.postTitle", "Selecciona el Post")}</h2></div><Select value={postId} onChange={(event) => setPostId(event.target.value)} aria-label={t("publisher.postSelect", "Post")}>{posts.map((post) => <option key={post.id} value={post.id}>{itemTitle(post)} · {statusLabel(post.status)}</option>)}</Select>{selectedPost && <><div className="ui-publication-post-summary"><div><h3>{itemTitle(selectedPost)}</h3><p className="ui-muted">{selectedPost.variants.length} {t("publisher.variants", "variantes")}</p></div><StatusBadge status={selectedPost.status} label={statusLabel(selectedPost.status)} /></div><div className="ui-publication-channel-list">{availableVariants.map((variant) => <Checkbox key={variant.id} label={<><ChannelBadge channel={variant.channel} /> <StatusBadge status={variant.scheduleStatus || variant.status} label={statusLabel(variant.scheduleStatus || variant.status)} /></>} checked={selectedChannels.includes(variant.channel)} onChange={() => toggleChannel(variant.channel)} />)}</div><Inline gap="sm"><Button variant="secondary" disabled={busy || !availableVariants.length} loading={busy} onClick={() => void publish(availableVariants.map((variant) => variant.channel))}>{t("publisher.publishPost", "Publicar Post completo")}</Button><Button disabled={busy || !selectedChannels.length} loading={busy} onClick={() => void publish(selectedChannels)}>{t("publisher.publishChannels", "Publicar seleccionados")}</Button></Inline><Link className="ui-button ui-button-ghost ui-button-sm" to={`/content/${encodeURIComponent(selectedPost.id)}`}>{t("publisher.openPost", "Abrir y editar Post")}</Link></>}</Stack></Card>
      <Card><Stack gap="md"><div><span className="ui-eyebrow">{t("publisher.orphanEyebrow", "INBOX DE ASSETS")}</span><h2>{t("publisher.orphanTitle", "Assets sin Post")}</h2><p className="ui-muted">{t("publisher.orphanHelp", "Convierte una pieza suelta en un borrador para que nunca se publique fuera de un Post.")}</p></div>{assets.length ? <div className="ui-publication-orphans">{assets.slice(0, 12).map((asset) => <div className="ui-publication-orphan" key={asset.id || asset.path}><div><strong>{assetLabel(asset)}</strong><span className="ui-muted">{asset.kind || asset.contentType || "Asset"}</span></div><Button size="sm" variant="secondary" disabled={busy} onClick={() => void createPostFromAsset(asset)}>{t("publisher.createPost", "Crear Post")}</Button></div>)}</div> : <EmptyState title={t("publisher.noOrphans", "No hay assets independientes")} description={t("publisher.noOrphansHelp", "Los assets asociados aparecerán dentro de su Post.")} />}</Stack></Card>
    </div>}
    {result && <Card className="ui-publication-result"><Inline gap="sm"><StatusBadge status={String(result.status || "syncing")} /><Badge tone="success">{t("publisher.queued", "Enviado al control de publicación")}</Badge></Inline><p className="ui-muted">{t("publisher.queuedHelp", "Puedes revisar el estado real de cada variante en el Post y en Calendario.")}</p>{selectedPost && <Link className="ui-button ui-button-secondary" to={`/content/${encodeURIComponent(selectedPost.id)}`}>{t("publisher.openPost", "Abrir Post")}</Link>}</Card>}
  </main>;
}
