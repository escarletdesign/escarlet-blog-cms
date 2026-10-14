import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, api } from "./api";
import { itemTitle, statusLabel } from "./content-format";
import type { ContentItem, ContentVariant } from "./types";
import { Badge, Button, Card, ChannelBadge, EmptyState, Field, IconButton, Inline, PageHeader, Skeleton, Stack, StatusBadge, Switch, TextField } from "./ui";

type PublisherProps = { site: string; t: (key: string, fallback?: string) => string };

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function variantCanPublish(variant: ContentVariant) {
  const statuses = [variant.scheduleStatus, variant.status].filter(Boolean);
  if (statuses.some((status) => ["draft", "canceled", "scheduled", "syncing", "publishing", "published"].includes(String(status)))) return false;
  if (variant.channel === "video" && !variant.media?.length) return false;
  return Boolean(variant.body?.text || variant.body?.caption || variant.body?.body || variant.body?.bodyHtml || variant.media?.length);
}

export function Publisher({ site, t }: PublisherProps) {
  const [searchParams] = useSearchParams();
  const [posts, setPosts] = useState<ContentItem[]>([]);
  const [postId, setPostId] = useState(searchParams.get("itemId") || "");
  const [postSearch, setPostSearch] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.contentItems(site, undefined, { archive: "active" }).then((content) => {
      if (!active) return;
      const nextPosts = (content.items || []).filter((item) => item.status !== "canceled" && item.status !== "archived" && item.variants?.length);
      setPosts(nextPosts);
      setPostId((current) => nextPosts.some((item) => item.id === current) ? current : nextPosts[0]?.id || "");
    }).catch((cause) => { if (active) setError(errorText(cause, t("publisher.postsError", "No se pudieron cargar los Posts."))); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [site, t, refreshKey]);

  const syncRemoteStatus = async () => {
    setSyncBusy(true);
    setError("");
    try {
      await api.syncContentRemoteStatus(site);
      setRefreshKey((value) => value + 1);
      setResult({ status: "syncing" });
    } catch (cause) {
      setError(errorText(cause, t("publisher.syncError", "No se pudo actualizar el estado de las publicaciones.")));
    } finally {
      setSyncBusy(false);
    }
  };

  const selectedPost = posts.find((post) => post.id === postId) || null;
  const availableVariants = useMemo(() => selectedPost?.variants || [], [selectedPost]);
  const publishableVariants = useMemo(() => availableVariants.filter(variantCanPublish), [availableVariants]);
  const filteredPosts = useMemo(() => {
    const normalized = postSearch.trim().toLocaleLowerCase();
    if (!normalized) return posts;
    return posts.filter((post) => `${itemTitle(post)} ${statusLabel(post.status)} ${post.planTitle || ""}`.toLocaleLowerCase().includes(normalized));
  }, [postSearch, posts]);
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

  return <main className="ui-page ui-publication-page">
    <PageHeader eyebrow={t("publisher.eyebrow", "PUBLICACIÓN")} title={t("publisher.title", "Publicar un Post")} description={t("publisher.description", "Selecciona un Post y decide qué variantes publicar. La biblioteca de medios está separada para mantener este flujo claro.")} actions={<Inline gap="sm"><IconButton label={t("publisher.refreshStatus", "Actualizar estado")} disabled={syncBusy} aria-busy={syncBusy} onClick={() => void syncRemoteStatus()}>↻</IconButton><Link className="ui-button ui-button-secondary" to="/media">{t("publisher.openMedia", "Administrar medios")}</Link></Inline>} />
    {error && <Card><p className="ui-field-error" role="alert">{error}</p></Card>}
    {loading ? <div className="ui-publication-grid"><Skeleton height="260px" /></div> : !posts.length ? <EmptyState title={t("publisher.empty", "No hay Posts publicables")} description={t("publisher.emptyHelp", "Crea un Post desde Contenido y vuelve aquí cuando tenga una variante aprobada.")} action={<Link className="ui-button ui-button-secondary" to="/content">Abrir contenido</Link>} /> : <Card><Stack gap="md"><div><span className="ui-eyebrow">{t("publisher.postEyebrow", "POST")}</span><h2>{t("publisher.postTitle", "Selecciona el Post")}</h2></div><Field label={t("publisher.postSearch", "Buscar Posts")}><TextField value={postSearch} onChange={(event) => setPostSearch(event.target.value)} placeholder={t("publisher.postSearchPlaceholder", "Título, campaña o estado")} /></Field><div className="ui-publication-post-picker" role="listbox" aria-label={t("publisher.postSelect", "Post")}>{filteredPosts.length ? filteredPosts.map((post) => <Button key={post.id} type="button" size="sm" variant={post.id === postId ? "secondary" : "ghost"} className={`ui-publication-post-option${post.id === postId ? " active" : ""}`} aria-pressed={post.id === postId} onClick={() => setPostId(post.id)}><strong>{itemTitle(post)}</strong><span>{statusLabel(post.status)}</span></Button>) : <p className="ui-muted">{t("publisher.noPostsMatch", "No hay Posts que coincidan con la búsqueda.")}</p>}</div>{selectedPost && <><div className="ui-publication-post-summary"><div><h3>{itemTitle(selectedPost)}</h3><p className="ui-muted">{selectedPost.variants.length} {t("publisher.variants", "variantes")} · {publishableVariants.length} {t("publisher.publishable", "listas para publicar")}</p></div><StatusBadge status={selectedPost.status} label={statusLabel(selectedPost.status)} /></div><div className="ui-publication-channel-list">{availableVariants.map((variant) => { const publishable = variantCanPublish(variant); const status = variant.scheduleStatus || variant.status; return <Switch key={variant.id} label={<><ChannelBadge channel={variant.channel} /><StatusBadge status={status} label={statusLabel(status)} /></>} description={!publishable && ["scheduled", "syncing", "publishing", "published"].includes(status) ? t("publisher.alreadyHandled", "Este canal ya está programado o publicado") : undefined} checked={publishable && selectedChannels.includes(variant.channel)} disabled={!publishable || busy} onChange={() => toggleChannel(variant.channel)} />; })}</div>{!publishableVariants.length && <p className="ui-field-hint">{t("publisher.noPendingVariants", "No hay variantes pendientes. Los canales programados o publicados no se vuelven a enviar desde aquí.")}</p>}<Inline gap="sm"><Button variant="secondary" disabled={busy || !publishableVariants.length} loading={busy} onClick={() => void publish(publishableVariants.map((variant) => variant.channel))}>{t("publisher.publishPost", "Publicar pendientes")}</Button><Button disabled={busy || !selectedChannels.length} loading={busy} onClick={() => void publish(selectedChannels.filter((channel) => publishableVariants.some((variant) => variant.channel === channel)))}>{t("publisher.publishChannels", "Publicar seleccionados")}</Button></Inline><Link className="ui-button ui-button-ghost ui-button-sm" to={`/content/${encodeURIComponent(selectedPost.id)}`}>{t("publisher.openPost", "Abrir y editar Post")}</Link></>}</Stack></Card>}
    {result && <Card className="ui-publication-result"><Inline gap="sm"><StatusBadge status={String(result.status || "syncing")} /><Badge tone="success">{t("publisher.queued", "Enviado al control de publicación")}</Badge></Inline><p className="ui-muted">{t("publisher.queuedHelp", "Puedes revisar el estado real de cada variante en el Post y en Calendario.")}</p>{selectedPost && <Link className="ui-button ui-button-secondary" to={`/content/${encodeURIComponent(selectedPost.id)}`}>{t("publisher.openPost", "Abrir Post")}</Link>}</Card>}
  </main>;
}
