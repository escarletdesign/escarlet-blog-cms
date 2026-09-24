import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { ContentChannel, ContentItem, ContentVariant } from "./types";
import { itemTitle } from "./content-format";
import { createPortraitCapture } from "./portrait-recorder";
import type { PortraitCapture } from "./portrait-recorder";
import { Badge, Button, Card, ChannelBadge, EmptyState, IconButton, Inline, Stack, StatusBadge, Textarea } from "./ui";

const packChannels: ContentChannel[] = ["blog", "instagram", "instagram_story", "linkedin", "x", "video"];
const label = (channel: string) => channel === "x" ? "X" : channel === "video" ? "Vídeo" : channel === "instagram_story" ? "Instagram Story" : channel.charAt(0).toUpperCase() + channel.slice(1);

function bodyFor(variant?: ContentVariant) {
  const body = variant?.body || {};
  const socialPack = body.socialPack && typeof body.socialPack === "object" ? body.socialPack : {};
  return { body, socialPack };
}

function imageFor(variant?: ContentVariant) {
  const { body } = bodyFor(variant);
  return body.imageUrl || body.image_url || body.coverUrl || variant?.media?.[0] || "";
}

function cleanImageUrl(value: unknown) {
  const candidate = value && typeof value === "object"
    ? (value as any).url || (value as any).publicUrl || (value as any).imageUrl || (value as any).path
    : value;
  const url = String(candidate || "").trim();
  return url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "";
}

const cleanMediaUrl = cleanImageUrl;

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
    imageUrl: cleanImageUrl(slide?.imageUrl || slide?.url || slide?.image || variant?.media?.[index])
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

export function ContentPackPreview({ site, item, busy, autoRecord = false, bufferReady = true, publishChannels = ["video"], onVideoUploaded, onNotify, onClose, onPublish, onPublishAll }: { site: string; item: ContentItem; busy: boolean; autoRecord?: boolean; bufferReady?: boolean; publishChannels?: ContentChannel[]; onVideoUploaded?: (replacedPrevious: boolean) => void; onNotify?: (message: string, kind?: "success" | "error" | "info") => void; onClose: () => void; onPublish: (channel: ContentChannel) => void; onPublishAll?: () => void }) {
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
  const [activeSlide, setActiveSlide] = useState(0);
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const [siteDomain, setSiteDomain] = useState("");
  const openRecorder = () => { enterRecorderFullscreen(); setShowTeleprompter(true); };
  const closeRecorder = () => { exitRecorderFullscreen(); setShowTeleprompter(false); };
  useEffect(() => {
    let active = true;
    api.onboarding(site).then((result) => {
      if (active) setSiteDomain(String((result as any)?.site?.domain || "").replace(/\/$/, ""));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [site]);
  useEffect(() => { if (autoRecord && videoScript) setShowTeleprompter(true); }, [autoRecord, videoScript]);
  const safeSlide = slides.length ? Math.min(activeSlide, slides.length - 1) : 0;
  const slide = slides[safeSlide];
  const slideImage = cleanImageUrl(slide?.imageUrl || slide?.url || slide?.image);
  const blogImage = cleanImageUrl(imageFor(blog));
  const storyImage = cleanImageUrl(imageFor(instagramStory) || slides[0]?.imageUrl || slides[0]?.url || slides[0]?.image);
  const savedVideoUrl = cleanMediaUrl(video?.media?.[0]);
  const blogSlug = String(item.metadata?.slug || blog?.body?.slug || "").trim();
  const fallbackBlogSlug = contentTitle.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const blogUrl = String(item.metadata?.articleUrl || blog?.body?.articleUrl || "").trim() || `${siteDomain || window.location.origin}/blog/${encodeURIComponent(blogSlug || fallbackBlogSlug)}`;
  const textVariants = variants.filter((variant) => !["blog", "instagram", "instagram_story", "video"].includes(variant.channel) && textFor(variant));

  if (!variants.length) return <EmptyState title="No hay variantes para previsualizar" description="El contenido todavía no tiene un pack de Blog o redes disponible." />;
  return <Stack gap="md">
    <div className="social-pack-toolbar ui-plan-pack-toolbar"><div><p className="ui-eyebrow">Vista social</p><strong>{contentTitle}</strong><p className="ui-muted">{item.topic}</p></div><StatusBadge status={item.status} /></div>
    {videoScript && <section className="ui-card teleprompter-launch-card"><div><p className="ui-eyebrow">Vídeo para Reel</p><h2>{savedVideoUrl ? "Vídeo guardado" : "Grabar con teleprompter"}</h2><p className="ui-muted">{savedVideoUrl ? "Este es el vídeo asociado a este contenido. Puedes volver a grabarlo cuando quieras." : "Usa el guion del pack, sube el vídeo y publícalo en Buffer."}</p>{!bufferReady && <p className="ui-field-hint">Conecta al menos un canal de Buffer en Administración para publicar este vídeo.</p>}</div><Inline gap="sm">{savedVideoUrl && <video className="saved-content-video" src={savedVideoUrl} controls playsInline />}{<Button onClick={openRecorder}>{savedVideoUrl ? "Volver a grabar" : "Abrir grabador"}</Button>}{savedVideoUrl && pendingPublishChannels.map((channel) => <Button key={channel} variant="secondary" size="sm" disabled={busy} onClick={() => onPublish(channel)}>Publicar</Button>)}</Inline></section>}
    <div className="social-visual-grid ui-plan-pack-visual-grid">
      {blog && <article className="ui-card social-cover-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Blog</p><h2>{titleFor(blog, contentTitle)}</h2></div><ChannelBadge channel="blog" /></div>{blogImage ? <img src={blogImage} alt={String(blog.body?.imageAlt || contentTitle)} loading="lazy" /> : <div className="carousel-placeholder">Blog</div>}<Textarea className="social-blog-text" aria-label="Texto del blog" value={textFor(blog)} readOnly rows={8} /><Stack gap="sm"><Inline gap="sm"><Button variant="ghost" size="sm" onClick={() => void copyValue(textFor(blog))}>Copiar texto</Button>{blogUrl && <Button variant="ghost" size="sm" onClick={() => void copyValue(blogUrl)}>Copiar link</Button>}<Badge tone="info">Webhook de Coolify</Badge></Inline></Stack></article>}
      {instagram && <article className="ui-card social-carousel-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Instagram</p><h2>Carousel</h2></div><ChannelBadge channel="instagram" /></div>{slides.length ? <div className="instagram-carousel" role="region" aria-label="Carrusel de Instagram"><div className="instagram-carousel-stage"><IconButton className="carousel-nav carousel-prev" label="Slide anterior" onClick={() => setActiveSlide((safeSlide - 1 + slides.length) % slides.length)}>‹</IconButton><figure>{slideImage ? <img src={slideImage} alt={String(slide?.alt || slide?.headline || `Slide ${safeSlide + 1}`)} /> : <div className="carousel-placeholder">{safeSlide + 1}</div>}<figcaption><span>{String(slide?.headline || slide?.text || `Slide ${safeSlide + 1}`)}</span>{slideImage && <a className="chip" href={slideImage} target="_blank" rel="noreferrer">Abrir</a>}</figcaption></figure><IconButton className="carousel-nav carousel-next" label="Slide siguiente" onClick={() => setActiveSlide((safeSlide + 1) % slides.length)}>›</IconButton></div><div className="carousel-dots" role="tablist" aria-label="Slides de Instagram">{slides.map((entry: any, index: number) => <Button key={entry?.id || index} className={`carousel-dot${index === safeSlide ? " active" : ""}`} variant="ghost" size="sm" role="tab" aria-selected={index === safeSlide} aria-label={`Slide ${index + 1}`} onClick={() => setActiveSlide(index)}>{index + 1}</Button>)}</div></div> : <p className="ui-muted">No hay slides generadas todavía.</p>}<p className="ui-plan-caption">{textFor(instagram)}</p><PackActions variant={instagram} busy={busy} onCopy={() => void copyValue(textFor(instagram))} onPublish={() => onPublish("instagram")} /></article>}
      {instagramStory && <article className="ui-card social-channel-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Instagram</p><h2>Story con enlace</h2></div><ChannelBadge channel="instagram_story" /></div>{storyImage ? <img src={storyImage} alt={String(instagramStory.body?.imageAlt || contentTitle)} loading="lazy" /> : <div className="carousel-placeholder">Story</div>}<p>{textFor(instagramStory)}</p><p className="ui-field-hint">Buffer enviará una notificación para añadir el link sticker en Instagram.</p>{instagramStory.body?.socialPack?.instagramStory?.linkUrl && <a className="text-link" href={instagramStory.body.socialPack.instagramStory.linkUrl} target="_blank" rel="noreferrer">{instagramStory.body.socialPack.instagramStory.linkUrl}</a>}<PackActions variant={instagramStory} busy={busy} onCopy={() => void copyValue(textFor(instagramStory))} onPublish={() => onPublish("instagram_story")} /></article>}
    </div>
    {textVariants.length > 0 && <div className="social-pack-grid">{textVariants.map((variant) => <article className="ui-card social-channel-card" key={variant.id}><div className="social-channel-head"><h2><ChannelBadge channel={variant.channel} /> {label(variant.channel)}</h2>{["linkedin", "x"].includes(variant.channel) ? <PackActions variant={variant} busy={busy} onCopy={() => void copyValue(textFor(variant))} onPublish={() => onPublish(variant.channel)} /> : <Button variant="ghost" size="sm" onClick={() => void copyValue(textFor(variant))}>Copiar</Button>}</div><p>{textFor(variant)}</p></article>)}</div>}
    <Inline gap="md"><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onPublishAll && <Button variant="primary" disabled={busy || !pendingPublishChannels.length} onClick={onPublishAll}>Publicar pendientes en Buffer</Button>}{onPublishAll && !pendingPublishChannels.length && <span className="ui-field-hint">No hay canales aprobados pendientes de enviar a Buffer.</span>}</Inline>
    {showTeleprompter && <TeleprompterModal script={videoScript} itemId={item.id} site={site} canPublish={Boolean(pendingPublishChannels.length)} publishChannels={pendingPublishChannels} busy={busy} onUploaded={onVideoUploaded} onNotify={onNotify} onPublish={onPublish} onClose={closeRecorder} />}
  </Stack>;
}

function PackActions({ variant, busy, onCopy, onPublish }: { variant: ContentVariant; busy: boolean; onCopy: () => void; onPublish: () => void }) {
  return <Inline gap="sm"><Button variant="ghost" size="sm" onClick={onCopy}>Copiar</Button><Button variant="primary" size="sm" disabled={busy || variant.status !== "approved"} loading={busy} onClick={onPublish}>Publicar en Buffer</Button></Inline>;
}

function TeleprompterModal({ script, itemId, site, canPublish, publishChannels, busy, onUploaded, onNotify, onPublish, onClose }: { script: string; itemId: string; site: string; canPublish: boolean; publishChannels: ContentChannel[]; busy: boolean; onUploaded?: (replacedPrevious: boolean) => void; onNotify?: (message: string, kind?: "success" | "error" | "info") => void; onPublish: (channel: ContentChannel) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const portraitCaptureRef = useRef<PortraitCapture | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [showCamera, setShowCamera] = useState(true);
  const [countdown, setCountdown] = useState(0);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 }, facingMode: "user" }, audio: true });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      chunksRef.current = [];
      portraitCaptureRef.current = videoRef.current ? createPortraitCapture(videoRef.current, stream) : null;
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
      const file = new File([videoBlob], `escarlet-reel.${extension}`, { type: videoBlob.type || "video/webm" });
      const result = await api.uploadContentVideo(itemId, file, site);
      setUploaded(true);
      onUploaded?.(result.replacedPrevious);
    } catch (cause) {
      onNotify?.(cause instanceof Error ? cause.message : "No se pudo subir el vídeo.", "error");
    } finally {
      setUploading(false);
    }
  };
  const publishLabel = (channel: ContentChannel) => channel === "video" ? "Instagram Reel" : channel === "instagram" ? "Instagram" : channel === "linkedin" ? "LinkedIn" : channel === "x" ? "X" : label(channel);
  return <div className="ui-modal-backdrop teleprompter-backdrop" role="presentation"><section className="ui-modal teleprompter-modal" role="dialog" aria-modal="true" aria-label="Grabador con teleprompter"><div className="ui-modal-head"><div><p className="ui-eyebrow">Vídeo para Reel</p><h2>Grabador con teleprompter</h2></div><Button variant="ghost" onClick={onClose}>Cerrar</Button></div><div className="teleprompter-layout"><div className="teleprompter-script-wrap"><div className="teleprompter-script" ref={scrollRef}>{paragraphs.map((paragraph, index) => (index < currentParagraph || index > currentParagraph + 1 ? null : <p key={`${index}-${paragraph.slice(0, 18)}`} ref={(element) => { paragraphRefs.current[index] = element; }} className={index === currentParagraph ? "active" : ""}>{paragraph}</p>))}</div><div className="teleprompter-line-controls" role="group" aria-label="Cambiar de línea"><IconButton className="teleprompter-line-button" label="Línea anterior" onClick={() => moveParagraph(-1)} disabled={!paragraphs.length || currentParagraph === 0}>↑</IconButton><IconButton className="teleprompter-line-button" label="Línea siguiente" onClick={() => moveParagraph(1)} disabled={!paragraphs.length || currentParagraph >= paragraphs.length - 1}>↓</IconButton></div></div>{showCamera && <div className="camera-stage">{videoUrl ? <video src={videoUrl} controls playsInline /> : <video ref={videoRef} muted playsInline /> }<span>{recording ? "●" : "○"}</span>{countdown > 0 && <div className="teleprompter-countdown" aria-live="assertive"><strong>{countdown}</strong><small>Prepárate</small></div>}</div>}</div><div className="teleprompter-controls"><Button variant={recording ? "danger" : "primary"} onClick={recording ? stop : start}>{recording ? "Detener" : "Grabar"}</Button><Button variant="ghost" onClick={() => setShowCamera((value) => !value)}>{showCamera ? "Ocultar cámara" : "Mostrar cámara"}</Button>{videoUrl && <a className="ui-button ui-button-secondary" href={videoUrl} download="escarlet-video.webm">Descargar vídeo</a>}{videoBlob && itemId && <><Button variant="secondary" loading={uploading} disabled={uploading || uploaded} onClick={() => void upload()}>{uploaded ? "Vídeo guardado" : "Guardar vídeo"}</Button>{!uploaded && <span className="ui-field-hint">Al guardar, el vídeo anterior de este contenido se elimina.</span>}</>}{uploaded && (canPublish ? publishChannels.map((channel) => <Button key={channel} variant={channel === "video" ? "primary" : "secondary"} loading={busy} disabled={busy} onClick={() => onPublish(channel)}>Publicar en {publishLabel(channel)}</Button>) : <><Button variant="secondary" disabled>Publicar en Buffer</Button><span className="ui-field-hint">Conecta y activa un canal de Buffer en Administración para publicar.</span></>)}</div></section></div>;
}
