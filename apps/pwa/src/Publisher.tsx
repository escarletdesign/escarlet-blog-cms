import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";
import type { MediaItem } from "./types";
import { Badge, Button, Card, EmptyState, Field, Inline, PageHeader, Select, Skeleton, Stack, StatusBadge, Textarea, TextField } from "./ui";
import { useSearchParams } from "react-router-dom";

type PublisherProps = { site: string; t: (key: string, fallback?: string) => string };

const channels = [
  ["instagram_reel", "Instagram Reel"],
  ["instagram_story", "Instagram Story"],
  ["instagram_post", "Instagram post"],
  ["linkedin_post", "LinkedIn"],
  ["x_post", "X"],
  ["wordpress_post", "WordPress"],
  ["youtube_video", "YouTube"],
] as const;

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

const assetUrl = (asset: MediaItem, resolution: "thumb" | "preview" = "thumb") => {
  const candidates = resolution === "preview"
    ? [asset.previewUrl, asset.previewPath, asset.thumbUrl, asset.thumbPath, asset.url, asset.publicUrl, asset.path]
    : [asset.thumbUrl, asset.thumbPath, asset.previewUrl, asset.previewPath, asset.url, asset.publicUrl, asset.path];
  const value = String(candidates.find(Boolean) || "").trim();
  return value.startsWith("/") || /^https?:\/\//i.test(value) ? value : "";
};

const assetLabel = (asset: MediaItem) => asset.filename || asset.alt || asset.id || "Asset sin nombre";

export function Publisher({ site, t }: PublisherProps) {
  const [searchParams] = useSearchParams();
  const requestedChannel = searchParams.get("channel");
  const initialChannel = channels.some(([value]) => value === requestedChannel) ? requestedChannel || "instagram_reel" : "instagram_reel";
  const [assets, setAssets] = useState<MediaItem[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [channel, setChannel] = useState(initialChannel);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [copy, setCopy] = useState("");
  const [destinations, setDestinations] = useState<Array<Record<string, any>>>([]);
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const updateSelection = (next: string[]) => {
    setAssetIds(next);
    setDestinations([]);
    setProvider("");
    setResult(null);
    setError("");
  };

  useEffect(() => {
    let active = true;
    setAssetsLoading(true);
    setError("");
    void api.productionAssets(site).then((response) => {
      if (active) setAssets(response.assets || []);
    }).catch((loadError) => {
      if (active) setError(errorText(loadError, t("publisher.assetsError", "No se pudo cargar la biblioteca de assets.")));
    }).finally(() => {
      if (active) setAssetsLoading(false);
    });
    return () => { active = false; };
  }, [site, t]);

  const loadDestinations = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await api.publicationOperation({ site, operation: "destination.list", channel, assetIds });
      const next = Array.isArray(response.destinations) ? response.destinations : [];
      setDestinations(next);
      setProvider((current) => next.some((entry) => entry.providerId === current) ? current : String(next[0]?.providerId || ""));
      setResult(null);
    } catch (loadError) {
      setError(errorText(loadError, t("publisher.destinationsError", "No se pudieron consultar los destinos.")));
    } finally {
      setBusy(false);
    }
  };

  const prepare = async () => {
    if (!provider || !assetIds.length) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.publicationOperation({ site, operation: "prepare", channel, provider, assetIds, text: copy.trim() });
      setResult(response);
    } catch (prepareError) {
      setError(errorText(prepareError, t("publisher.prepareError", "No se pudo preparar el bundle.")));
    } finally {
      setBusy(false);
    }
  };

  const assetOptions = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    return assets.filter((asset) => !query || [assetLabel(asset), asset.kind, asset.alt].some((value) => String(value || "").toLowerCase().includes(query))).slice(0, 100);
  }, [assets, assetSearch]);
  const selectedAssets = useMemo(() => assets.filter((asset) => asset.id && assetIds.includes(String(asset.id))), [assets, assetIds]);
  const isBlog = channel === "wordpress_post";
  return <main className="ui-page">
    <PageHeader eyebrow={t("publisher.eyebrow", "MICRO APP · PUBLISHER")} title={isBlog ? t("publisher.blogTitle", "Publicar blog") : t("publisher.title", "Elige dónde publicar")} description={isBlog ? t("publisher.blogDescription", "Prepara una entrada para WordPress con su asset y copy. El envío queda pendiente de revisión humana.") : t("publisher.description", "Selecciona el canal, el proveedor y el asset. El Publisher prepara el envío, pero mantiene la revisión humana antes de contactar una plataforma.")} />
    <div className="ui-brand-detail-grid">
      <Card><Stack gap="md">
        <div><span className="ui-eyebrow">{t("publisher.destinationEyebrow", "DESTINO")}</span><h2>{t("publisher.destinationTitle", "Canal y herramienta")}</h2></div>
        <Field label={t("publisher.channel", "Canal")}><Select value={channel} onChange={(event) => { setChannel(event.target.value); setDestinations([]); setProvider(""); }}><option value="">{t("publisher.chooseChannel", "Elige un canal")}</option>{channels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        <div className="ui-publisher-assets-field">
          <div className="ui-field-label-row"><span className="ui-field-label">{t("publisher.asset", "Assets")}</span><Badge tone={assetIds.length ? "success" : "neutral"}>{assetIds.length} {t("publisher.selected", "seleccionados")}</Badge></div>
          <p className="ui-field-hint">{t("publisher.assetHelp", "Selecciona una o varias piezas. La publicación siempre referencia assets registrados en la marca.")}</p>
          {assetsLoading ? <div className="ui-publisher-asset-grid">{[1, 2, 3].map((item) => <Skeleton key={item} height="190px" />)}</div> : assets.length ? <>
            <Inline gap="sm" className="ui-publisher-asset-toolbar">
              <TextField type="search" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder={t("publisher.assetSearch", "Buscar por nombre o tipo")} aria-label={t("publisher.assetSearch", "Buscar por nombre o tipo")} />
              <Button variant="ghost" size="sm" disabled={!assetOptions.length} onClick={() => updateSelection(assetOptions.map((asset) => String(asset.id)).filter(Boolean))}>{t("publisher.selectVisible", "Seleccionar visibles")}</Button>
              <Button variant="ghost" size="sm" disabled={!assetIds.length} onClick={() => updateSelection([])}>{t("publisher.clearSelection", "Limpiar")}</Button>
            </Inline>
            {assetOptions.length ? <div className="ui-publisher-asset-grid" role="group" aria-label={t("publisher.assetGrid", "Assets disponibles")}>
              {assetOptions.map((asset) => {
                const id = String(asset.id || "");
                const selected = Boolean(id && assetIds.includes(id));
                const image = assetUrl(asset);
                return <Button key={id || asset.path || asset.url} variant="ghost" size="sm" className={`ui-publisher-asset${selected ? " selected" : ""}`} aria-pressed={selected} aria-label={`${selected ? "Quitar" : "Seleccionar"} ${assetLabel(asset)}`} onClick={() => id && updateSelection(selected ? assetIds.filter((value) => value !== id) : [...assetIds, id])}>
                  <span className="ui-publisher-asset-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                  {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : <span className="ui-publisher-asset-placeholder">{t("publisher.noPreview", "Sin vista previa")}</span>}
                  <span className="ui-publisher-asset-meta"><strong title={assetLabel(asset)}>{assetLabel(asset)}</strong><small>{asset.kind || asset.contentType || t("publisher.assetFile", "Archivo")}</small></span>
                </Button>;
              })}
            </div> : <EmptyState title={t("publisher.assetSearchEmpty", "No hay coincidencias")} description={t("publisher.assetSearchEmptyHelp", "Prueba con otro nombre o tipo de asset.")} />}
          </> : <EmptyState title={t("publisher.assetsEmpty", "No hay assets disponibles")} description={t("publisher.assetsEmptyHelp", "Genera o sube una pieza desde una micro app de producción.")} />}
        </div>
        <Field label={t("publisher.copy", "Copy")} hint={t("publisher.copyHelp", "Opcional. Se valida con las reglas de la marca antes de preparar el bundle.")}><Textarea rows={5} value={copy} onChange={(event) => setCopy(event.target.value)} placeholder={t("publisher.copyPlaceholder", "Escribe el texto que acompañará al asset.")} /></Field>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
        <Inline gap="sm"><Button variant="secondary" disabled={!channel || !assetIds.length || busy} loading={busy && !destinations.length} onClick={() => void loadDestinations()}>{t("publisher.find", "Buscar destinos")}</Button>{destinations.length > 0 && <Badge tone="success">{destinations.length} {t("publisher.available", "disponibles")}</Badge>}</Inline>
      </Stack></Card>
      <Card><Stack gap="md">
        <div><span className="ui-eyebrow">{t("publisher.providerEyebrow", "ADAPTADOR")}</span><h2>{t("publisher.providerTitle", "Revisión antes de enviar")}</h2></div>
        {selectedAssets.length > 0 && <div className="ui-publisher-selection-summary"><span className="ui-eyebrow">{t("publisher.selectionEyebrow", "SELECCIÓN")}</span><strong>{selectedAssets.length} {t("publisher.assetsReady", "assets listos para este destino")}</strong><div className="ui-publisher-selection-strip">{selectedAssets.slice(0, 4).map((asset) => { const image = assetUrl(asset); return image ? <img key={String(asset.id)} src={image} alt="" /> : <span key={String(asset.id)}>{assetLabel(asset).slice(0, 1)}</span>; })}{selectedAssets.length > 4 && <small>+{selectedAssets.length - 4}</small>}</div></div>}
        {destinations.length ? <><Field label={t("publisher.provider", "Proveedor")}><Select value={provider} onChange={(event) => setProvider(event.target.value)}>{destinations.map((destination) => <option key={destination.id} value={destination.providerId}>{destination.providerLabel || destination.providerId}</option>)}</Select></Field><Stack gap="sm"><Inline gap="sm"><Badge tone="info">{destinations.find((entry) => entry.providerId === provider)?.channelLabel || channel}</Badge><Badge tone="neutral">{destinations.find((entry) => entry.providerId === provider)?.providerLabel || provider}</Badge></Inline><Button disabled={!provider || !assetIds.length || busy} loading={busy && Boolean(destinations.length)} onClick={() => void prepare()}>{t("publisher.prepare", "Preparar para revisión")}</Button></Stack></> : <EmptyState title={t("publisher.noDestinations", "Busca un destino conectado")} description={t("publisher.noDestinationsHelp", "El Publisher solo muestra adaptadores compatibles y conectados para esta marca.")} />}
        {result && <Card><Stack gap="sm"><Inline gap="sm"><StatusBadge status={String(result.state || "ready_for_review")} /><Badge tone="success">{t("publisher.prepared", "Bundle preparado")}</Badge></Inline><p className="ui-muted">{t("publisher.reviewNext", "El siguiente paso es la revisión humana. Ningún proveedor externo ha recibido todavía este contenido.")}</p><small>{String(result.publicationId || result.runId || "")}</small></Stack></Card>}
      </Stack></Card>
    </div>
  </main>;
}
