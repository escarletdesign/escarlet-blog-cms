import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";
import type { MediaItem } from "./types";
import { Badge, Button, Card, EmptyState, Field, Inline, PageHeader, Select, Skeleton, Stack, StatusBadge, Textarea } from "./ui";
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
export function Publisher({ site, t }: PublisherProps) {
  const [searchParams] = useSearchParams();
  const requestedChannel = searchParams.get("channel");
  const initialChannel = channels.some(([value]) => value === requestedChannel) ? requestedChannel || "instagram_reel" : "instagram_reel";
  const [assets, setAssets] = useState<MediaItem[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [channel, setChannel] = useState(initialChannel);
  const [assetId, setAssetId] = useState("");
  const [provider, setProvider] = useState("");
  const [copy, setCopy] = useState("");
  const [destinations, setDestinations] = useState<Array<Record<string, any>>>([]);
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      const response = await api.publicationOperation({ site, operation: "destination.list", channel, assetIds: assetId ? [assetId] : [] });
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
    if (!provider || !assetId) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.publicationOperation({ site, operation: "prepare", channel, provider, assetIds: [assetId], text: copy.trim() });
      setResult(response);
    } catch (prepareError) {
      setError(errorText(prepareError, t("publisher.prepareError", "No se pudo preparar el bundle.")));
    } finally {
      setBusy(false);
    }
  };

  const assetOptions = useMemo(() => assets.slice(0, 100), [assets]);
  const isBlog = channel === "wordpress_post";
  return <main className="ui-page">
    <PageHeader eyebrow={t("publisher.eyebrow", "MICRO APP · PUBLISHER")} title={isBlog ? t("publisher.blogTitle", "Publicar blog") : t("publisher.title", "Elige dónde publicar")} description={isBlog ? t("publisher.blogDescription", "Prepara una entrada para WordPress con su asset y copy. El envío queda pendiente de revisión humana.") : t("publisher.description", "Selecciona el canal, el proveedor y el asset. El Publisher prepara el envío, pero mantiene la revisión humana antes de contactar una plataforma.")} />
    <div className="ui-brand-detail-grid">
      <Card><Stack gap="md">
        <div><span className="ui-eyebrow">{t("publisher.destinationEyebrow", "DESTINO")}</span><h2>{t("publisher.destinationTitle", "Canal y herramienta")}</h2></div>
        <Field label={t("publisher.channel", "Canal")}><Select value={channel} onChange={(event) => { setChannel(event.target.value); setDestinations([]); setProvider(""); }}><option value="">{t("publisher.chooseChannel", "Elige un canal")}</option>{channels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        <Field label={t("publisher.asset", "Asset")} hint={t("publisher.assetHelp", "La publicación siempre referencia un asset registrado en la marca.")}>
          {assetsLoading ? <Skeleton height="42px" /> : assetOptions.length ? <Select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">{t("publisher.chooseAsset", "Elige un asset")}</option>{assetOptions.map((asset) => <option key={String(asset.id)} value={String(asset.id)}>{asset.filename || asset.id}</option>)}</Select> : <EmptyState title={t("publisher.assetsEmpty", "No hay assets disponibles")} description={t("publisher.assetsEmptyHelp", "Genera o sube una pieza desde una micro app de producción.")} />}
        </Field>
        <Field label={t("publisher.copy", "Copy")} hint={t("publisher.copyHelp", "Opcional. Se valida con las reglas de la marca antes de preparar el bundle.")}><Textarea rows={5} value={copy} onChange={(event) => setCopy(event.target.value)} placeholder={t("publisher.copyPlaceholder", "Escribe el texto que acompañará al asset.")} /></Field>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
        <Inline gap="sm"><Button variant="secondary" disabled={!channel || !assetId || busy} loading={busy && !destinations.length} onClick={() => void loadDestinations()}>{t("publisher.find", "Buscar destinos")}</Button>{destinations.length > 0 && <Badge tone="success">{destinations.length} {t("publisher.available", "disponibles")}</Badge>}</Inline>
      </Stack></Card>
      <Card><Stack gap="md">
        <div><span className="ui-eyebrow">{t("publisher.providerEyebrow", "ADAPTADOR")}</span><h2>{t("publisher.providerTitle", "Revisión antes de enviar")}</h2></div>
        {destinations.length ? <><Field label={t("publisher.provider", "Proveedor")}><Select value={provider} onChange={(event) => setProvider(event.target.value)}>{destinations.map((destination) => <option key={destination.id} value={destination.providerId}>{destination.providerLabel || destination.providerId}</option>)}</Select></Field><Stack gap="sm"><Inline gap="sm"><Badge tone="info">{destinations.find((entry) => entry.providerId === provider)?.channelLabel || channel}</Badge><Badge tone="neutral">{destinations.find((entry) => entry.providerId === provider)?.providerLabel || provider}</Badge></Inline><Button disabled={!provider || !assetId || busy} loading={busy && Boolean(destinations.length)} onClick={() => void prepare()}>{t("publisher.prepare", "Preparar para revisión")}</Button></Stack></> : <EmptyState title={t("publisher.noDestinations", "Busca un destino conectado")} description={t("publisher.noDestinationsHelp", "El Publisher solo muestra adaptadores compatibles y conectados para esta marca.")} />}
        {result && <Card><Stack gap="sm"><Inline gap="sm"><StatusBadge status={String(result.state || "ready_for_review")} /><Badge tone="success">{t("publisher.prepared", "Bundle preparado")}</Badge></Inline><p className="ui-muted">{t("publisher.reviewNext", "El siguiente paso es la revisión humana. Ningún proveedor externo ha recibido todavía este contenido.")}</p><small>{String(result.publicationId || result.runId || "")}</small></Stack></Card>}
      </Stack></Card>
    </div>
  </main>;
}
