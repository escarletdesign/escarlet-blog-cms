import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "./api";
import type { MediaItem } from "./types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Inline,
  PageHeader,
  Skeleton,
  Stack,
  StatusBadge,
  TextField,
  Textarea,
} from "./ui";

type FoodToReelStatus = "idle" | "loading" | "queued" | "review" | "error";

export type FoodToReelProps = {
  site: string;
  t: (key: string, fallback?: string) => string;
};

function imageSource(media: MediaItem) {
  return media.previewUrl || media.thumbUrl || media.url || media.path || "";
}

function looksLikeImage(media: MediaItem) {
  const contentType = String(media.metadata?.contentType || media.metadata?.mimeType || "").toLowerCase();
  if (contentType.startsWith("image/")) return true;
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(String(media.filename || media.url || media.path || ""));
}

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("No se pudo leer la imagen."));
    };
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

const MAX_DEVICE_IMAGE_BYTES = 12 * 1024 * 1024;
const DEVICE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function FoodToReel({ site, t }: FoodToReelProps) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState("");
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState("");
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<FoodToReelStatus>("idle");
  const [error, setError] = useState("");
  const [job, setJob] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let active = true;
    setMediaLoading(true);
    setMediaError("");
    setSelectedMediaId("");
    setUploadFile(null);
    setJob(null);
    setStatus("idle");
    void api.productionAssets(site)
      .then((result) => {
        if (!active) return;
        setMedia(result.assets || []);
      })
      .catch((loadError) => {
        if (!active) return;
        setMediaError(errorText(loadError, t("foodReel.mediaError", "No se pudo cargar la biblioteca de imágenes.")));
      })
      .finally(() => {
        if (active) setMediaLoading(false);
      });
    return () => {
      active = false;
    };
  }, [site]);

  useEffect(() => {
    if (!uploadFile) {
      setUploadPreview("");
      return undefined;
    }
    const nextUrl = URL.createObjectURL(uploadFile);
    setUploadPreview(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [uploadFile]);

  const imageMedia = useMemo(() => {
    const filtered = media.filter(looksLikeImage);
    return (filtered.length ? filtered : media).slice(0, 24);
  }, [media]);
  const selectedMedia = imageMedia.find((item) => String(item.id || "") === selectedMediaId) || null;
  const selectedSource = uploadPreview || (selectedMedia ? imageSource(selectedMedia) : "");
  const canSubmit = Boolean((selectedMediaId || uploadFile) && text.trim()) && status !== "loading";

  const selectMedia = (item: MediaItem) => {
    if (!item.id) return;
    setSelectedMediaId(String(item.id));
    setUploadFile(null);
    setError("");
    setStatus("idle");
    setJob(null);
  };

  const chooseFile = (file?: File) => {
    if (!file) return;
    if (!DEVICE_IMAGE_TYPES.has(file.type.toLowerCase())) {
      setError(t("foodReel.imageTypeError", "Usa una imagen JPG, PNG, WebP o GIF."));
      setUploadFile(null);
      setSelectedMediaId("");
      setStatus("error");
      return;
    }
    if (file.size > MAX_DEVICE_IMAGE_BYTES) {
      setError(t("foodReel.imageSizeError", "La imagen no puede superar 12 MB."));
      setUploadFile(null);
      setSelectedMediaId("");
      setStatus("error");
      return;
    }
    setUploadFile(file);
    setSelectedMediaId("");
    setError("");
    setStatus("idle");
    setJob(null);
  };

  const launch = async () => {
    if (!canSubmit || status === "loading") return;
    setStatus("loading");
    setError("");
    try {
      let sourceMediaId = selectedMediaId;
      if (uploadFile) {
        const contentBase64 = await fileAsDataUrl(uploadFile);
        const uploaded = await api.uploadProductionAsset({
          site,
          filename: uploadFile.name || "food-to-reel-image",
          contentBase64,
          alt: text.slice(0, 160),
        });
        sourceMediaId = String(uploaded.asset?.id || uploaded.media?.id || "");
      }
      if (!sourceMediaId) throw new Error(t("foodReel.imageRequired", "Selecciona o sube una imagen para continuar."));
      const result = await api.runRecipe({
        site,
        recipeId: "recipe.food-to-reel",
        sourceMediaId,
        channel: "instagram_reel",
        formatProfile: "instagram_reel",
        text: text.trim().slice(0, 500),
        createContentIfMissing: true,
        idempotencyKey: `pwa-food-to-reel:${site}:${sourceMediaId}:${text.trim()}`,
      });
      const motion = (result.motion || {}) as Record<string, unknown>;
      const createdJob = (motion.job || {}) as Record<string, unknown>;
      const videoJobId = String(result.runId || motion.runId || createdJob.id || "");
      if (result.status === "blocked") throw new Error(t("foodReel.copyBlocked", "El copy necesita ajustes antes de crear el Reel."));
      setJob(createdJob);
      if (!videoJobId) throw new Error(t("foodReel.jobIdError", "El trabajo se creó sin identificador."));
      let currentStatus = String(motion.status || result.status || "queued").toLowerCase();
      for (let attempt = 0; attempt < 15 && !["ready_for_review", "failed", "cancelled"].includes(currentStatus); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        const current = await api.getVideoJob(videoJobId, site);
        setJob(current.job || createdJob);
        currentStatus = String(current.job?.status || currentStatus).toLowerCase();
      }
      if (currentStatus === "failed") throw new Error(t("foodReel.renderError", "El motor de motion no pudo producir el Reel."));
      setStatus(currentStatus === "ready_for_review" ? "review" : "queued");
    } catch (launchError) {
      setError(errorText(launchError, t("foodReel.launchError", "No se pudo lanzar el Reel.")));
      setStatus("error");
    }
  };

  const clearUpload = () => {
    if (uploadInputRef.current) uploadInputRef.current.value = "";
    setUploadFile(null);
    setSelectedMediaId("");
    setError("");
    setStatus("idle");
    setJob(null);
  };

  const reset = () => {
    clearUpload();
    setText("");
  };

  return (
    <main className="ui-page">
      <PageHeader
        eyebrow={t("foodReel.eyebrow", "MICRO APP · PRODUCCIÓN")}
        title={t("foodReel.title", "Imagen y texto a Reel")}
        description={t("foodReel.description", "Combina una imagen de comida y su explicación para preparar un Reel de Instagram con la identidad de tu marca.")}
      />
      <div className="ui-brand-detail-grid">
        <Card>
          <Stack gap="md">
            <div>
              <span className="ui-eyebrow">{t("foodReel.imageEyebrow", "ENTRADA VISUAL")}</span>
              <h2>{t("foodReel.imageTitle", "Elige una imagen")}</h2>
              <p className="ui-muted">{t("foodReel.imageHelp", "Usa una imagen de la biblioteca o sube una nueva desde tu dispositivo.")}</p>
            </div>
            {mediaLoading ? (
              <Skeleton height="180px" />
            ) : mediaError ? (
              <div role="alert" className="ui-field-error">
                <p>{mediaError}</p>
                <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>{t("common.retry", "Reintentar")}</Button>
              </div>
            ) : imageMedia.length ? (
              <div className="ui-brand-reference-library" aria-label={t("foodReel.libraryLabel", "Biblioteca de imágenes")}>
                <div className="reference-grid ui-reference-grid ui-reference-grid-3">
                  {imageMedia.map((item) => {
                    const id = String(item.id || item.path || item.url || item.filename || "");
                    const selected = id === selectedMediaId;
                    return (
                      <article className={`reference-card ${selected ? "ui-brand-active" : ""}`} key={id}>
                        <Button
                          variant="ghost"
                          className="reference-image-button"
                          type="button"
                          aria-label={`${t("foodReel.selectImage", "Seleccionar imagen")}: ${item.filename || t("foodReel.untitledImage", "Imagen")}`}
                          aria-pressed={selected}
                          onClick={() => selectMedia(item)}
                        >
                          <img src={imageSource(item)} alt={item.alt || item.filename || t("foodReel.imageAlt", "Imagen para Reel")} loading="lazy" decoding="async" />
                        </Button>
                        <div className="reference-card-actions">
                          <strong title={item.filename}>{item.filename || t("foodReel.untitledImage", "Imagen")}</strong>
                          {selected && <Badge tone="success">{t("foodReel.selected", "Seleccionada")}</Badge>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyState title={t("foodReel.emptyTitle", "Aún no hay imágenes")} description={t("foodReel.emptyDescription", "Sube una imagen para crear el primer Reel de esta marca.")} />
            )}
            <Stack gap="sm">
              <Field label={t("foodReel.upload", "Subir imagen")} hint={t("foodReel.uploadHelp", "Elige un JPG, PNG, WebP o GIF de hasta 12 MB desde tu dispositivo.")}>
                <TextField ref={uploadInputRef} className="ui-file-input-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => chooseFile(event.target.files?.[0])} />
              </Field>
              <Button type="button" variant="secondary" onClick={() => { if (uploadInputRef.current) { uploadInputRef.current.value = ""; uploadInputRef.current.click(); } }}>
                {t("foodReel.uploadButton", "Elegir imagen del dispositivo")}
              </Button>
            </Stack>
            {uploadFile && <Inline gap="sm"><Badge tone="info">{t("foodReel.newImage", "Nueva imagen")}</Badge><span className="ui-muted">{uploadFile.name}</span><Button type="button" variant="ghost" size="sm" onClick={clearUpload}>{t("foodReel.removeImage", "Quitar")}</Button></Inline>}
            {selectedSource && <img src={selectedSource} alt={t("foodReel.previewAlt", "Vista previa de la imagen seleccionada")} loading="lazy" decoding="async" />}
          </Stack>
        </Card>
        <Card>
          <Stack gap="md">
            <div>
              <span className="ui-eyebrow">{t("foodReel.copyEyebrow", "CONTEXTO")}</span>
              <h2>{t("foodReel.copyTitle", "Explica el plato")}</h2>
              <p className="ui-muted">{t("foodReel.copyHelp", "Describe el plato, sus ingredientes o el mensaje que debe acompañar al vídeo.")}</p>
            </div>
            <Field label={t("foodReel.copyLabel", "Texto del plato")} required hint={t("foodReel.copyHint", "El texto se conservará como contexto del trabajo y quedará disponible para revisión.")}>
              <Textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} placeholder={t("foodReel.copyPlaceholder", "Ej. Paella de verduras con producto de temporada, servida al momento...")} aria-describedby="food-reel-copy-count" />
              <span id="food-reel-copy-count" className="ui-field-hint">{text.length}/4000</span>
            </Field>
            {error && <p className="ui-field-error" role="alert">{error}</p>}
            <Inline gap="sm">
              <Button variant="primary" loading={status === "loading"} disabled={!canSubmit} onClick={() => void launch()}>
                {t("foodReel.launch", "Lanzar Reel")}
              </Button>
              {(status === "review" || status === "error") && <Button variant="ghost" onClick={reset}>{t("foodReel.reset", "Crear otro")}</Button>}
            </Inline>
          </Stack>
        </Card>
      </div>
      {status === "loading" && <Card role="status" aria-live="polite"><Inline gap="sm"><StatusBadge status="syncing" label={t("foodReel.processing", "Preparando")}/><span>{t("foodReel.processingHelp", "Guardando la entrada y creando el trabajo...")}</span></Inline></Card>}
      {status === "queued" && <Card role="status" aria-live="polite"><Inline gap="sm"><StatusBadge status={String(job?.status || "queued")} label={String(job?.status || "queued") === "awaiting_provider" ? t("foodReel.awaitingProvider", "Esperando proveedor") : t("foodReel.queued", "En cola")}/><span>{String(job?.status || "queued") === "awaiting_provider" ? t("foodReel.awaitingProviderHelp", "El trabajo está listo para que un proveedor de motion lo procese.") : t("foodReel.queuedHelp", "El trabajo se ha creado y está esperando al motor de motion.")}</span></Inline></Card>}
      {status === "review" && <Card role="status" aria-live="polite"><Inline gap="sm"><StatusBadge status="needs_review" label={t("foodReel.review", "Revisión humana")}/><span>{t("foodReel.reviewHelp", "El Reel queda pendiente de revisión antes de publicar.")}</span></Inline>{job?.id && <p className="ui-field-hint">{t("foodReel.jobId", "Trabajo")}: {String(job.id)}</p>}</Card>}
      {status === "error" && !error && <Card role="alert"><p className="ui-field-error">{t("foodReel.launchError", "No se pudo lanzar el Reel.")}</p></Card>}
    </main>
  );
}
