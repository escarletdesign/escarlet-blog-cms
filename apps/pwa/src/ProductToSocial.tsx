import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "./api";
import type { MediaItem } from "./types";
import { Badge, Button, Card, EmptyState, Field, Inline, PageHeader, Select, Skeleton, Stack, StatusBadge, Textarea, TextField } from "./ui";
import { useNavigate } from "react-router-dom";

type ProductToSocialProps = { site: string; t: (key: string, fallback?: string) => string };

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("No se pudo leer la imagen."));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function isImage(asset: MediaItem) {
  const type = String(asset.metadata?.contentType || asset.metadata?.mimeType || "").toLowerCase();
  return type.startsWith("image/") || /\.(avif|gif|jpe?g|png|webp)$/i.test(String(asset.filename || asset.url || asset.path || ""));
}

export function ProductToSocial({ site, t }: ProductToSocialProps) {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [assets, setAssets] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [upload, setUpload] = useState<File | null>(null);
  const [formatProfile, setFormatProfile] = useState("instagram_post");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api.productionAssets(site).then((response) => {
      if (active) setAssets((response.assets || []).filter(isImage));
    }).catch((cause) => {
      if (active) setError(cause instanceof ApiError || cause instanceof Error ? cause.message : t("productSocial.loadError", "No se pudieron cargar los assets."));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [site, t]);

  const assetOptions = useMemo(() => assets.slice(0, 100), [assets]);
  const submit = async () => {
    if ((!selectedId && !upload) || !instructions.trim()) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      let sourceMediaId = selectedId;
      if (upload) {
        const uploaded = await api.uploadProductionAsset({ site, filename: upload.name, contentBase64: await fileAsDataUrl(upload), alt: instructions.slice(0, 160) });
        sourceMediaId = String(uploaded.asset?.id || uploaded.media?.id || "");
      }
      const response = await api.runRecipe({ site, recipeId: "recipe.product-to-social", sourceMediaId, text: instructions.trim(), formatProfile, channel: formatProfile });
      setResult(response);
    } catch (cause) {
      setError(cause instanceof ApiError || cause instanceof Error ? cause.message : t("productSocial.error", "No se pudo preparar el producto."));
    } finally {
      setBusy(false);
    }
  };

  return <main className="ui-page">
    <PageHeader eyebrow={t("productSocial.eyebrow", "MICRO APP · PRODUCCIÓN")} title={t("productSocial.title", "Producto a publicación social")} description={t("productSocial.description", "Adapta una imagen de producto al estilo de la marca y déjala lista para elegir canal y proveedor.")} />
    <div className="ui-brand-detail-grid">
      <Card><Stack gap="md">
        <div><span className="ui-eyebrow">{t("productSocial.inputEyebrow", "ASSET DE PRODUCTO")}</span><h2>{t("productSocial.inputTitle", "Elige una imagen")}</h2></div>
        {loading ? <Skeleton height="42px" /> : assetOptions.length ? <Field label={t("productSocial.asset", "Imagen registrada")}><Select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setUpload(null); }}><option value="">{t("productSocial.choose", "Elige una imagen")}</option>{assetOptions.map((asset) => <option key={String(asset.id)} value={String(asset.id)}>{asset.filename || asset.id}</option>)}</Select></Field> : <EmptyState title={t("productSocial.empty", "No hay imágenes registradas")} description={t("productSocial.emptyHelp", "Sube una imagen desde tu dispositivo para empezar.")} />}
        <TextField ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setUpload(file); setSelectedId(""); } event.currentTarget.value = ""; }} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>{upload?.name || t("productSocial.upload", "Subir imagen desde el dispositivo")}</Button>
        <Field label={t("productSocial.format", "Formato de salida")}><Select value={formatProfile} onChange={(event) => setFormatProfile(event.target.value)}><option value="instagram_post">Instagram post</option><option value="instagram_story">Instagram Story</option><option value="linkedin_post">LinkedIn</option></Select></Field>
        <Field label={t("productSocial.instructions", "Qué quieres comunicar")} hint={t("productSocial.instructionsHelp", "Se valida con la voz de marca antes de crear la variante.")}><Textarea rows={5} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={t("productSocial.placeholder", "Ej. Presentar este plato como novedad de temporada, sin cambiar su aspecto real.")} /></Field>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
        <Button disabled={(!selectedId && !upload) || !instructions.trim() || busy} loading={busy} onClick={() => void submit()}>{t("productSocial.prepare", "Preparar variante")}</Button>
      </Stack></Card>
      <Card><Stack gap="md"><div><span className="ui-eyebrow">{t("productSocial.resultEyebrow", "RESULTADO")}</span><h2>{t("productSocial.resultTitle", "Listo para revisar")}</h2></div>{result ? <><Inline gap="sm"><StatusBadge status={String(result.status || "ready_for_review")} /><Badge tone="info">{String(result.runId || "")}</Badge></Inline><p className="ui-muted">{t("productSocial.reviewHelp", "La variante conserva el original y queda separada de la publicación. Revisa el resultado antes de elegir destino.")}</p>{Array.isArray(result.product?.assets) && <p className="ui-muted">{result.product.assets.length} {t("productSocial.assetsCreated", "variante(s) creada(s)")}</p>}<Button variant="secondary" onClick={() => navigate("/publication/publisher")}>{t("productSocial.openPublisher", "Abrir Publisher")}</Button></> : <EmptyState title={t("productSocial.waiting", "Prepara una variante")} description={t("productSocial.waitingHelp", "El resultado aparecerá aquí con su procedencia y siguiente paso.")} />}</Stack></Card>
    </div>
  </main>;
}
