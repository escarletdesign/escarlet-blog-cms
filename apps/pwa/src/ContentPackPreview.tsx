import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { ContentChannel, ContentItem, ContentVariant } from "./types";
import { itemTitle } from "./content-format";
import { createVideoCapture } from "./portrait-recorder";
import type { VideoCapture, VideoFormat } from "./portrait-recorder";
import { Badge, Button, Card, ChannelBadge, EmptyState, Field, IconButton, Inline, Select, Stack, StatusBadge, TeleprompterLineControls, Textarea } from "./ui";

const packChannels: ContentChannel[] = ["blog", "instagram", "instagram_story", "linkedin", "x", "video"];
const label = (channel: string) => channel === "x" ? "X" : channel === "video" ? "Vídeo" : channel === "instagram_story" ? "Instagram Story" : channel.charAt(0).toUpperCase() + channel.slice(1);

function bodyFor(variant?: ContentVariant) {
  const body = variant?.body || {};
  const socialPack = body.socialPack && typeof body.socialPack === "object" ? body.socialPack : {};
  return { body, socialPack };
}

function imageFor(variant?: ContentVariant) {
  const { body } = bodyFor(variant);
  return body.imagePreviewUrl || body.imageUrl || body.image_url || body.coverUrl || variant?.media?.[0] || "";
}

function cleanImageUrl(value: unknown, resolution: "thumb" | "preview" | "original" = "preview") {
  const media = value && typeof value === "object" ? value as any : null;
  const candidates = media ? resolution === "thumb"
    ? [media.thumbUrl, media.thumbPath, media.previewUrl, media.previewPath, media.url, media.publicUrl, media.imageUrl, media.path]
    : resolution === "preview"
      ? [media.previewUrl, media.previewPath, media.thumbUrl, media.thumbPath, media.url, media.publicUrl, media.imageUrl, media.path]
      : [media.url, media.publicUrl, media.imageUrl, media.path]
    : [value];
  const candidate = candidates.find((entry) => entry);
  const url = String(candidate || "").trim();
  return url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "";
}

const cleanMediaUrl = (value: unknown) => cleanImageUrl(value, "original");

function copyValue(value: string) {
  return navigator.clipboard ? navigator.clipboard.writeText(value).catch(() => undefined) : Promise.resolve();
}

function enterRecorderFullscreen() {
  if (!document.fullscreenElement) {
    const request = document.documentElement.requestFullscreen?.();
    if (request) void request.catch(() => undefined);
  }
}

function exitRecorderFullscreen() {
  if (document.fullscreenElement) {
    const exit = document.exitFullscreen?.();
    if (exit) void exit.catch(() => undefined);
  }
}

function textFor(variant?: ContentVariant) {
  const { body, socialPack } = bodyFor(variant);
  if (!variant) return "";
  if (variant.channel === "instagram") return String(socialPack.instagramCaption || socialPack.caption || body.caption || body.text || body.body || body.topic || "").trim();
  if (variant.channel === "instagram_story") return String(socialPack.instagramStory?.text || body.text || body.caption || body.topic || "").trim();
  return String(body.body || body.bodyHtml || body.text || body.caption || body.summary || body.topic || "").replace(/<[^>]*>/g, "").trim();
}

function slidesFor(variant?: ContentVariant) {
  const { socialPack } = bodyFor(variant);
  if (!Array.isArray(socialPack.instagramSlides)) return [];
  return socialPack.instagramSlides.map((slide: any, index: number) => ({
    ...slide,
    imageUrl: cleanImageUrl(slide?.imageUrl || slide?.url || slide?.image || variant?.media?.[index], "preview"),
    imageOriginalUrl: cleanImageUrl(slide?.imageUrl || slide?.url || slide?.image || variant?.media?.[index], "original"),
  }));
}

function titleFor(variant?: ContentVariant, fallback = "") {
  const { body } = bodyFor(variant);
  return String((body.title && body.title !== body.topic ? body.title : "") || body.headline || fallback);
}

function scriptParagraphs(script: string) {
  const paragraphs = script.replace(/([.!?])\s+/g, "$1\n").split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
  return paragraphs.filter((paragraph, index) => index === 0 || paragraph.replace(/\s+/g, " ").toLocaleLowerCase() !== paragraphs[index - 1].replace(/\s+/g, " ").toLocaleLowerCase());
}

export function ContentPackPreview({ site, item, busy, autoRecord = false, bufferReady = true, publishChannels = ["video"], onVideoUploaded, onNotify, onClose, onEditBlog, onPublish, onPublishAll }: { site: string; item: ContentItem; busy: boolean; autoRecord?: boolean; bufferReady?: boolean; publishChannels?: ContentChannel[]; onVideoUploaded?: (replacedPrevious: boolean) => void; onNotify?: (message: string, kind?: "success" | "error" | "info") => void; onClose: () => void; onEditBlog?: () => void; onPublish: (channel: ContentChannel, copy?: string) => void; onPublishAll?: () => void }) {
  const variants = (item.variants || []).filter((variant) => packChannels.includes(variant.channel));
  const blog = variants.find((variant) => variant.channel === "blog");
  const instagram = variants.find((variant) => variant.channel === "instagram");
  const instagramStory = variants.find((variant) => variant.channel === "instagram_story");
  const video = variants.find((variant) => variant.channel === "video");
  const availablePublishChannels = publishChannels.filter((channel) => variants.some((variant) => variant.channel === channel));
  const pendingPublishChannels = availablePublishChannels.filter((channel) => variants.some((variant) => variant.channel === channel && (variant.scheduleStatus || variant.status) === "approved"));
  const slides = slidesFor(instagram);
  const { socialPack } = bodyFor(instagram);
  const contentTitle = itemTitle(item);
  const videoScript = String(socialPack.videoScript || video?.body?.videoScript || video?.body?.script || video?.body?.text || slides.map((entry: any) => [entry?.headline, entry?.body].filter(Boolean).join("\n")).filter(Boolean).join("\n\n")).trim();
  const initialVideoCopy = String(video?.body?.publishCopy || socialPack.videoCaption || socialPack.videoCopy || video?.body?.caption || videoScript).trim();
  const [activeSlide, setActiveSlide] = useState(0);
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const [siteDomain, setSiteDomain] = useState("");
  const [videoCopy, setVideoCopy] = useState(initialVideoCopy);
  const [videoPublishChannel, setVideoPublishChannel] = useState<ContentChannel>("video");
  const [videoJob, setVideoJob] = useState<Record<string, any> | null>(null);
  const [videoJobBusy, setVideoJobBusy] = useState(false);
  const loadVideoJob = async () => {
    try {
      const result = await api.getVideoJobForContentItem(item.id, site);
      setVideoJob(result.job || null);
    } catch {
      setVideoJob(null);
    }
  };
  const openRecorder = () => { enterRecorderFullscreen(); setShowTeleprompter(true); };
  const closeRecorder = () => { exitRecorderFullscreen(); setShowTeleprompter(false); };
  useEffect(() => { setVideoCopy(initialVideoCopy); }, [initialVideoCopy]);
  useEffect(() => {
    if (pendingPublishChannels.length && !pendingPublishChannels.includes(videoPublishChannel)) setVideoPublishChannel(pendingPublishChannels[0]);
  }, [pendingPublishChannels, videoPublishChannel]);
  useEffect(() => {
    let active = true;
    api.onboarding(site).then((result) => {
      if (active) setSiteDomain(String((result as any)?.site?.domain || "").replace(/\/$/, ""));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [site]);
  useEffect(() => { if (autoRecord && videoScript) { enterRecorderFullscreen(); setShowTeleprompter(true); } }, [autoRecord, videoScript]);
  useEffect(() => { void loadVideoJob(); }, [item.id, site]);
  const chatGptPrompt = useMemo(() => {
    if (!videoJob) return "";
    return [
      "Edita este vídeo en Descript (u otra herramienta) y vuelve a subir el export final al CMS Escarlet.",
      `Video job: ${videoJob.videoJobId || ""}`,
      `Marca: ${videoJob.brand || site}`,
      `Speaker: ${videoJob.speaker || "sin definir"}`,
      `Canal/formato: ${videoJob.channel || "instagram"} / ${videoJob.format || "reel"}`,
      `URL del RAW: ${videoJob.sourceUrl || ""}`,
      "Cuando termines, usa video_import_external_media con la URL HTTPS pública del export final.",
    ].join("\n");
  }, [videoJob, site]);
  const editWithChatGpt = async () => {
    if (!chatGptPrompt.trim()) {
      onNotify?.("Guarda un vídeo antes de abrir ChatGPT.", "info");
      return;
    }
    await copyValue(chatGptPrompt);
    window.open("https://chatgpt.com", "_blank", "noopener,noreferrer");
    onNotify?.("Prompt copiado. Pega el contexto en ChatGPT para editar el vídeo.", "success");
  };
  const publishWithoutEdit = async () => {
    const jobId = String(videoJob?.videoJobId || "");
    if (!jobId) {
      onNotify?.("No hay un job de vídeo asociado todavía.", "error");
      return;
    }
    setVideoJobBusy(true);
    try {
      await api.updateVideoJob(jobId, { skipEdit: true, caption: videoCopy.trim() }, site);
      await loadVideoJob();
      onNotify?.("Vídeo listo para revisión sin edición externa.", "success");
    } catch (cause) {
      onNotify?.(cause instanceof Error ? cause.message : "No se pudo preparar el vídeo.", "error");
    } finally {
      setVideoJobBusy(false);
    }
  };
  const safeSlide = slides.length ? Math.min(activeSlide, slides.length - 1) : 0;
  const slide = slides[safeSlide];
  const slideImage = cleanImageUrl(slide?.imageUrl || slide?.url || slide?.image, "preview");
  const slideOriginalImage = slide?.imageOriginalUrl || cleanImageUrl(slide?.imageUrl || slide?.url || slide?.image, "original") || slideImage;
  const blogImage = cleanImageUrl(imageFor(blog));
  const storyImage = cleanImageUrl(imageFor(instagramStory) || slides[0]?.imageUrl || slides[0]?.url || slides[0]?.image);
  const savedVideos = (video?.media || []).map((media) => ({
    url: cleanMediaUrl(media),
    format: media.metadata?.format === "landscape" ? "landscape" : "portrait",
  })).filter((media) => media.url).filter((media, index, all) => all.findIndex((entry) => entry.format === media.format) === index);
  const hasSavedVideo = savedVideos.length > 0;
  const blogSlug = String(item.metadata?.slug || blog?.body?.slug || "").trim();
  const blogUrl = String(item.metadata?.articleUrl || blog?.body?.articleUrl || "").trim() || (blogSlug ? `${siteDomain || window.location.origin}/blog/${encodeURIComponent(blogSlug)}` : "");
  const textVariants = variants.filter((variant) => !["blog", "instagram", "instagram_story", "video"].includes(variant.channel) && textFor(variant));

  if (!variants.length) return <EmptyState title="No hay variantes para previsualizar" description="El contenido todavía no tiene un pack de Blog o redes disponible." />;
  return <Stack gap="md">
    <div className="social-pack-toolbar ui-plan-pack-toolbar"><div><p className="ui-eyebrow">Vista social</p><strong>{contentTitle}</strong><p className="ui-muted">{item.topic}</p></div><StatusBadge status={item.status} /></div>
    {videoScript && <section className="ui-card teleprompter-launch-card"><div><p className="ui-eyebrow">Vídeo para Reel</p><h2>{hasSavedVideo ? "Vídeos guardados" : "Grabar con teleprompter"}</h2><p className="ui-muted">{hasSavedVideo ? "Puedes conservar una versión vertical y otra horizontal del mismo contenido." : "Usa el guion del pack, sube el vídeo y publícalo en Buffer."}</p>{videoJob?.status && <p className="ui-field-hint">Job de vídeo: <StatusBadge status={String(videoJob.status)} /></p>}{!bufferReady && <p className="ui-field-hint">Conecta al menos un canal de Buffer en Administración para publicar este vídeo.</p>}</div>{hasSavedVideo && <div className="saved-content-videos">{savedVideos.map((savedVideo) => <figure className="saved-content-video-item" key={savedVideo.format}><video className={`saved-content-video saved-content-video-${savedVideo.format}`} src={savedVideo.url} controls playsInline /><figcaption>{savedVideo.format === "portrait" ? "Vertical 9:16" : "Horizontal 16:9"}</figcaption></figure>)}</div>}{videoJob?.finalUrl && videoJob?.sourceUrl && videoJob.finalUrl !== videoJob.sourceUrl && <Card><p className="ui-eyebrow">Revisión de edición</p><div className="saved-content-videos"><figure className="saved-content-video-item"><video className="saved-content-video saved-content-video-portrait" src={String(videoJob.sourceUrl)} controls playsInline /><figcaption>Original</figcaption></figure><figure className="saved-content-video-item"><video className="saved-content-video saved-content-video-portrait" src={String(videoJob.finalUrl)} controls playsInline /><figcaption>Editado</figcaption></figure></div></Card>}{hasSavedVideo && pendingPublishChannels.length > 0 && <div className="saved-video-publish"><Field label="Canal para publicar"><Select value={videoPublishChannel} onChange={(event) => setVideoPublishChannel(event.target.value as ContentChannel)} disabled={busy}>{pendingPublishChannels.map((channel) => <option key={channel} value={channel}>{channel === "video" ? "Instagram Reel" : label(channel)}</option>)}</Select></Field><Field label="Copy para publicar"><Textarea value={videoCopy} onChange={(event) => setVideoCopy(event.target.value)} rows={4} disabled={busy} /></Field><Button variant="primary" disabled={busy || !videoCopy.trim()} onClick={() => onPublish(videoPublishChannel, videoCopy.trim())}>Publicar</Button></div>}<Inline className="teleprompter-launch-actions" gap="sm"><Button onClick={openRecorder}>{hasSavedVideo ? "Volver a grabar" : "Abrir grabador"}</Button>{hasSavedVideo && <Button variant="secondary" disabled={videoJobBusy || busy} onClick={() => void editWithChatGpt()}>Editar con ChatGPT</Button>}{hasSavedVideo && <Button variant="ghost" disabled={videoJobBusy || busy} onClick={() => void publishWithoutEdit()}>Publicar sin editar</Button>}</Inline></section>}
    <div className="social-visual-grid ui-plan-pack-visual-grid">
      {blog && <article className="ui-card social-cover-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Blog</p><h2>{titleFor(blog, contentTitle)}</h2></div><ChannelBadge channel="blog" /></div>{blogImage ? <img src={blogImage} alt={String(blog.body?.imageAlt || contentTitle)} loading="lazy" decoding="async" /> : <div className="carousel-placeholder">Blog</div>}<Textarea className="social-blog-text" aria-label="Texto del blog" value={textFor(blog)} readOnly rows={8} /><Stack gap="sm"><Inline gap="sm">{onEditBlog && (blog.scheduleStatus || blog.status) === "published" && <Button variant="secondary" size="sm" onClick={onEditBlog}>Editar publicación</Button>}<Button variant="ghost" size="sm" onClick={() => void copyValue(textFor(blog))}>Copiar texto</Button>{blogUrl && <Button variant="ghost" size="sm" onClick={() => void copyValue(blogUrl)}>Copiar link</Button>}<Badge tone="info">Webhook de Coolify</Badge></Inline></Stack></article>}
      {instagram && <article className="ui-card social-carousel-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Instagram</p><h2>Carousel</h2></div><ChannelBadge channel="instagram" /></div>{slides.length ? <div className="instagram-carousel" role="region" aria-label="Carrusel de Instagram"><div className="instagram-carousel-stage"><IconButton className="carousel-nav carousel-prev" label="Slide anterior" onClick={() => setActiveSlide((safeSlide - 1 + slides.length) % slides.length)}>‹</IconButton><figure>{slideImage ? <img src={slideImage} alt={String(slide?.alt || slide?.headline || `Slide ${safeSlide + 1}`)} loading="lazy" decoding="async" /> : <div className="carousel-placeholder">{safeSlide + 1}</div>}<figcaption><span>{String(slide?.headline || slide?.text || `Slide ${safeSlide + 1}`)}</span>{slideImage && <a className="chip" href={slideOriginalImage} target="_blank" rel="noreferrer">Abrir</a>}</figcaption></figure><IconButton className="carousel-nav carousel-next" label="Slide siguiente" onClick={() => setActiveSlide((safeSlide + 1) % slides.length)}>›</IconButton></div><div className="carousel-dots" role="tablist" aria-label="Slides de Instagram">{slides.map((entry: any, index: number) => <Button key={entry?.id || index} className={`carousel-dot${index === safeSlide ? " active" : ""}`} variant="ghost" size="sm" role="tab" aria-selected={index === safeSlide} aria-label={`Slide ${index + 1}`} onClick={() => setActiveSlide(index)}>{index + 1}</Button>)}</div></div> : <p className="ui-muted">No hay slides generadas todavía.</p>}<p className="ui-plan-caption">{textFor(instagram)}</p><PackActions variant={instagram} busy={busy} onCopy={() => void copyValue(textFor(instagram))} onPublish={() => onPublish("instagram")} /></article>}
      {instagramStory && <article className="ui-card social-channel-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Instagram</p><h2>Story con enlace</h2></div><ChannelBadge channel="instagram_story" /></div>{storyImage ? <img src={storyImage} alt={String(instagramStory.body?.imageAlt || contentTitle)} loading="lazy" decoding="async" /> : <div className="carousel-placeholder">Story</div>}<p>{textFor(instagramStory)}</p><p className="ui-field-hint">Buffer enviará una notificación para añadir el link sticker en Instagram.</p>{instagramStory.body?.socialPack?.instagramStory?.linkUrl && <a className="text-link" href={instagramStory.body.socialPack.instagramStory.linkUrl} target="_blank" rel="noreferrer">{instagramStory.body.socialPack.instagramStory.linkUrl}</a>}<PackActions variant={instagramStory} busy={busy} onCopy={() => void copyValue(textFor(instagramStory))} onPublish={() => onPublish("instagram_story")} /></article>}
    </div>
    {textVariants.length > 0 && <div className="social-pack-grid">{textVariants.map((variant) => <article className="ui-card social-channel-card" key={variant.id}><div className="social-channel-head"><h2><ChannelBadge channel={variant.channel} /> {label(variant.channel)}</h2>{["linkedin", "x"].includes(variant.channel) ? <PackActions variant={variant} busy={busy} onCopy={() => void copyValue(textFor(variant))} onPublish={() => onPublish(variant.channel)} /> : <Button variant="ghost" size="sm" onClick={() => void copyValue(textFor(variant))}>Copiar</Button>}</div><p>{textFor(variant)}</p></article>)}</div>}
    <Inline gap="md"><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onPublishAll && <Button variant="primary" disabled={busy || !pendingPublishChannels.length} onClick={onPublishAll}>Publicar pendientes en Buffer</Button>}{onPublishAll && !pendingPublishChannels.length && <span className="ui-field-hint">No hay canales aprobados pendientes de enviar a Buffer.</span>}</Inline>
    {showTeleprompter && <TeleprompterModal script={videoScript} itemId={item.id} site={site} canPublish={Boolean(pendingPublishChannels.length)} publishChannels={pendingPublishChannels} busy={busy} onUploaded={(replaced) => { onVideoUploaded?.(replaced); void loadVideoJob(); }} onNotify={onNotify} onPublish={onPublish} onClose={closeRecorder} />}
  </Stack>;
}

function PackActions({ variant, busy, onCopy, onPublish }: { variant: ContentVariant; busy: boolean; onCopy: () => void; onPublish: () => void }) {
  return <Inline gap="sm"><Button variant="ghost" size="sm" onClick={onCopy}>Copiar</Button><Button variant="primary" size="sm" disabled={busy || variant.status !== "approved"} loading={busy} onClick={onPublish}>Publicar en Buffer</Button></Inline>;
}

function TeleprompterModal({ script, itemId, site, canPublish, publishChannels, busy, onUploaded, onNotify, onPublish, onClose }: { script: string; itemId: string; site: string; canPublish: boolean; publishChannels: ContentChannel[]; busy: boolean; onUploaded?: (replacedPrevious: boolean) => void; onNotify?: (message: string, kind?: "success" | "error" | "info") => void; onPublish: (channel: ContentChannel, copy?: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const portraitCaptureRef = useRef<VideoCapture | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [showCamera, setShowCamera] = useState(true);
  const [countdown, setCountdown] = useState(0);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [format, setFormat] = useState<VideoFormat>("portrait");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const countdownTimerRef = useRef<number | null>(null);
  const paragraphs = useMemo(() => scriptParagraphs(script), [script]);
  const [currentParagraph, setCurrentParagraph] = useState(0);
  const paragraphRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  useEffect(() => { setCurrentParagraph(0); scrollRef.current?.scrollTo({ top: 0, behavior: "auto" }); }, [script]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  useEffect(() => () => { if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current); portraitCaptureRef.current?.stop(); portraitCaptureRef.current = null; streamRef.current?.getTracks().forEach((track) => track.stop()); if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => {
    if (!showCamera || videoUrl || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [showCamera, videoUrl]);
  const start = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Tu navegador no permite grabar vídeo.");
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(""); setVideoBlob(null); setUploaded(false);
      const videoConstraints = format === "portrait"
        ? { width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 }, facingMode: "user" }
        : { width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 }, facingMode: "user" };
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      chunksRef.current = [];
      portraitCaptureRef.current = videoRef.current ? createVideoCapture(videoRef.current, stream, format) : null;
      const recorder = new MediaRecorder(portraitCaptureRef.current?.stream || stream);
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        setVideoBlob(blob);
        setVideoUrl(URL.createObjectURL(blob));
        setUploaded(false);
      };
      recorder.start(); recorderRef.current = recorder; setRecording(true);
      let remaining = 3;
      setCountdown(remaining);
      if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
          setCountdown(0);
        } else setCountdown(remaining);
      }, 1000);
    } catch (cause) { portraitCaptureRef.current?.stop(); portraitCaptureRef.current = null; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; onNotify?.(cause instanceof Error ? cause.message : "No se pudo abrir la cámara.", "error"); }
  };
  const stop = () => { if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; recorderRef.current?.stop(); recorderRef.current = null; portraitCaptureRef.current?.stop(); portraitCaptureRef.current = null; streamRef.current?.getTracks().forEach((track) => track.stop()); setRecording(false); setCountdown(0); };
  const moveParagraph = (direction: -1 | 1) => {
    const next = Math.max(0, Math.min(currentParagraph + direction, paragraphs.length - 1));
    if (next === currentParagraph) return;
    setCurrentParagraph(next);
    const container = scrollRef.current;
    const paragraph = paragraphRefs.current[next];
    if (container && paragraph) container.scrollTo({ top: Math.max(0, paragraph.offsetTop - container.clientHeight / 2 + paragraph.offsetHeight / 2), behavior: "smooth" });
  };
  const upload = async () => {
    if (!videoBlob || !itemId || uploading) return;
    setUploading(true);
    try {
      const extension = videoBlob.type.includes("mp4") ? "mp4" : videoBlob.type.includes("quicktime") ? "mov" : "webm";
      const file = new File([videoBlob], `escarlet-reel-${format}.${extension}`, { type: videoBlob.type || "video/webm" });
      const result = await api.uploadContentVideo(itemId, file, site, format);
      setUploaded(true);
      onUploaded?.(result.replacedPrevious);
    } catch (cause) {
      onNotify?.(cause instanceof Error ? cause.message : "No se pudo subir el vídeo.", "error");
    } finally {
      setUploading(false);
    }
  };
  const publishLabel = (channel: ContentChannel) => channel === "video" ? "Instagram Reel" : channel === "instagram" ? "Instagram" : channel === "linkedin" ? "LinkedIn" : channel === "x" ? "X" : label(channel);
  const controlHint = videoBlob && itemId && !uploaded
    ? "Se reemplaza solo el vídeo del formato elegido."
    : uploaded && !canPublish
      ? "Conecta y activa un canal de Buffer en Administración para publicar."
      : "";
  return <div className="ui-modal-backdrop teleprompter-backdrop" role="presentation">
    <section className="ui-modal teleprompter-modal" role="dialog" aria-modal="true" aria-label="Grabador con teleprompter">
      <div className="teleprompter-layout">
        <div className="teleprompter-script-wrap">
          <div className="teleprompter-script" ref={scrollRef}>{paragraphs.map((paragraph, index) => (index < currentParagraph || index > currentParagraph + 1 ? null : <p key={`${index}-${paragraph.slice(0, 18)}`} ref={(element) => { paragraphRefs.current[index] = element; }} className={index === currentParagraph ? "active" : ""}>{paragraph}</p>))}</div>
        </div>
        {showCamera && <div className={`camera-stage camera-stage-${format}`}>{videoUrl ? <video src={videoUrl} controls playsInline /> : <video ref={videoRef} muted playsInline />}<span>{recording ? "●" : "○"}</span>{countdown > 0 && <div className="teleprompter-countdown" aria-live="assertive"><strong>{countdown}</strong><small>Prepárate</small></div>}</div>}
      </div>
      <TeleprompterLineControls onPrevious={() => moveParagraph(-1)} onNext={() => moveParagraph(1)} previousDisabled={!paragraphs.length || currentParagraph === 0} nextDisabled={!paragraphs.length || currentParagraph >= paragraphs.length - 1} />
      {controlHint && <p className="ui-field-hint teleprompter-control-hint">{controlHint}</p>}
      <div className="teleprompter-controls">
        <div className="teleprompter-format-picker" role="group" aria-label="Formato del vídeo"><Button size="sm" variant={format === "portrait" ? "secondary" : "ghost"} disabled={recording} onClick={() => setFormat("portrait")}>Vertical 9:16</Button><Button size="sm" variant={format === "landscape" ? "secondary" : "ghost"} disabled={recording} onClick={() => setFormat("landscape")}>Horizontal 16:9</Button></div>
        <Button variant={recording ? "danger" : "primary"} onClick={recording ? stop : start}>{recording ? "Detener" : "Grabar"}</Button>
        <Button variant="ghost" onClick={() => setShowCamera((value) => !value)}>{showCamera ? "Ocultar cámara" : "Mostrar cámara"}</Button>
        {videoUrl && <a className="ui-button ui-button-secondary" href={videoUrl} download={`escarlet-video-${format}.webm`}>Descargar vídeo</a>}
        {videoBlob && itemId && <Button variant="secondary" loading={uploading} disabled={uploading || uploaded} onClick={() => void upload()}>{uploaded ? "Vídeo guardado" : "Guardar vídeo"}</Button>}
        {uploaded && (canPublish ? publishChannels.map((channel) => <Button key={channel} variant={channel === "video" ? "primary" : "secondary"} loading={busy} disabled={busy} onClick={() => onPublish(channel)}>Publicar en {publishLabel(channel)}</Button>) : <Button variant="secondary" disabled>Publicar en Buffer</Button>)}
        <Button className="teleprompter-close" variant="ghost" onClick={onClose}>Cerrar</Button>
      </div>
    </section>
  </div>;
}
