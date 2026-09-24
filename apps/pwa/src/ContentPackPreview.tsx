import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import type { ContentChannel, ContentItem, ContentVariant } from "./types";
import { itemTitle } from "./content-format";
import { Badge, Button, Card, ChannelBadge, EmptyState, IconButton, Inline, Stack, StatusBadge } from "./ui";

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

function copyValue(value: string) {
  return navigator.clipboard ? navigator.clipboard.writeText(value).catch(() => undefined) : Promise.resolve();
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

export function ContentPackPreview({ site, item, busy, autoRecord = false, onVideoUploaded, onClose, onPublish, onPublishAll }: { site: string; item: ContentItem; busy: boolean; autoRecord?: boolean; onVideoUploaded?: () => void; onClose: () => void; onPublish: (channel: ContentChannel) => void; onPublishAll?: () => void }) {
  const navigate = useNavigate();
  const variants = (item.variants || []).filter((variant) => packChannels.includes(variant.channel));
  const blog = variants.find((variant) => variant.channel === "blog");
  const instagram = variants.find((variant) => variant.channel === "instagram");
  const instagramStory = variants.find((variant) => variant.channel === "instagram_story");
  const video = variants.find((variant) => variant.channel === "video");
  const slides = slidesFor(instagram);
  const { socialPack } = bodyFor(instagram);
  const contentTitle = itemTitle(item);
  const videoScript = String(socialPack.videoScript || video?.body?.videoScript || video?.body?.script || video?.body?.text || [contentTitle, ...slides.map((entry: any) => [entry?.headline, entry?.body].filter(Boolean).join("\n"))].filter(Boolean).join("\n\n")).trim();
  const [activeSlide, setActiveSlide] = useState(0);
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  useEffect(() => { if (autoRecord && videoScript) setShowTeleprompter(true); }, [autoRecord, videoScript]);
  const safeSlide = slides.length ? Math.min(activeSlide, slides.length - 1) : 0;
  const slide = slides[safeSlide];
  const slideImage = cleanImageUrl(slide?.imageUrl || slide?.url || slide?.image);
  const blogImage = cleanImageUrl(imageFor(blog));
  const storyImage = cleanImageUrl(imageFor(instagramStory) || slides[0]?.imageUrl || slides[0]?.url || slides[0]?.image);
  const textVariants = variants.filter((variant) => !["blog", "instagram", "instagram_story", "video"].includes(variant.channel) && textFor(variant));

  if (!variants.length) return <EmptyState title="No hay variantes para previsualizar" description="El contenido todavía no tiene un pack de Blog o redes disponible." />;
  return <Stack gap="md">
    <div className="social-pack-toolbar ui-plan-pack-toolbar"><div><p className="ui-eyebrow">Social Pack</p><strong>{contentTitle}</strong><p className="ui-muted">{item.topic}</p></div><StatusBadge status={item.status} /></div>
    <div className="social-visual-grid ui-plan-pack-visual-grid">
      {blog && <article className="ui-card social-cover-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Blog</p><h2>{titleFor(blog, contentTitle)}</h2></div><ChannelBadge channel="blog" /></div>{blogImage ? <img src={blogImage} alt={String(blog.body?.imageAlt || contentTitle)} loading="lazy" /> : <div className="carousel-placeholder">Blog</div>}<p>{textFor(blog)}</p><Stack gap="sm"><Inline gap="sm"><Button variant="ghost" size="sm" onClick={() => void copyValue(textFor(blog))}>Copiar</Button><Badge tone="info">Webhook de Coolify</Badge></Inline><p className="ui-field-hint">El Blog se publica mediante el webhook de Coolify configurado en Administración. No se envía a Buffer.</p></Stack></article>}
      {instagram && <article className="ui-card social-carousel-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Instagram</p><h2>Carousel</h2></div><ChannelBadge channel="instagram" /></div>{slides.length ? <div className="instagram-carousel" role="region" aria-label="Carrusel de Instagram"><div className="instagram-carousel-stage"><IconButton className="carousel-nav carousel-prev" label="Slide anterior" onClick={() => setActiveSlide((safeSlide - 1 + slides.length) % slides.length)}>‹</IconButton><figure>{slideImage ? <img src={slideImage} alt={String(slide?.alt || slide?.headline || `Slide ${safeSlide + 1}`)} /> : <div className="carousel-placeholder">{safeSlide + 1}</div>}<figcaption><span>{String(slide?.headline || slide?.text || `Slide ${safeSlide + 1}`)}</span>{slideImage && <a className="chip" href={slideImage} target="_blank" rel="noreferrer">Abrir</a>}</figcaption></figure><IconButton className="carousel-nav carousel-next" label="Slide siguiente" onClick={() => setActiveSlide((safeSlide + 1) % slides.length)}>›</IconButton></div><div className="carousel-dots" role="tablist" aria-label="Slides de Instagram">{slides.map((entry: any, index: number) => <Button key={entry?.id || index} className={`carousel-dot${index === safeSlide ? " active" : ""}`} variant="ghost" size="sm" role="tab" aria-selected={index === safeSlide} aria-label={`Slide ${index + 1}`} onClick={() => setActiveSlide(index)}>{index + 1}</Button>)}</div></div> : <p className="ui-muted">No hay slides generadas todavía.</p>}<p className="ui-plan-caption">{textFor(instagram)}</p><PackActions variant={instagram} busy={busy} onCopy={() => void copyValue(textFor(instagram))} onPublish={() => onPublish("instagram")} /></article>}
      {instagramStory && <article className="ui-card social-channel-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Instagram</p><h2>Story con enlace</h2></div><ChannelBadge channel="instagram_story" /></div>{storyImage ? <img src={storyImage} alt={String(instagramStory.body?.imageAlt || contentTitle)} loading="lazy" /> : <div className="carousel-placeholder">Story</div>}<p>{textFor(instagramStory)}</p><p className="ui-field-hint">Buffer enviará una notificación para añadir el link sticker en Instagram.</p>{instagramStory.body?.socialPack?.instagramStory?.linkUrl && <a className="text-link" href={instagramStory.body.socialPack.instagramStory.linkUrl} target="_blank" rel="noreferrer">{instagramStory.body.socialPack.instagramStory.linkUrl}</a>}<PackActions variant={instagramStory} busy={busy} onCopy={() => void copyValue(textFor(instagramStory))} onPublish={() => onPublish("instagram_story")} /></article>}
    </div>
    {textVariants.length > 0 && <div className="social-pack-grid">{textVariants.map((variant) => <article className="ui-card social-channel-card" key={variant.id}><div className="social-channel-head"><h2><ChannelBadge channel={variant.channel} /> {label(variant.channel)}</h2>{["linkedin", "x"].includes(variant.channel) ? <PackActions variant={variant} busy={busy} onCopy={() => void copyValue(textFor(variant))} onPublish={() => onPublish(variant.channel)} /> : <Button variant="ghost" size="sm" onClick={() => void copyValue(textFor(variant))}>Copiar</Button>}</div><p>{textFor(variant)}</p></article>)}</div>}
    {videoScript && <section className="ui-card teleprompter-launch-card"><div><p className="ui-eyebrow">Vídeo para Reel</p><h2>Grabar con teleprompter</h2><p className="ui-muted">Usa el guion del pack, sube el vídeo y publícalo en Buffer.</p></div><Button onClick={() => setShowTeleprompter(true)}>Abrir grabador</Button></section>}
    <Inline gap="md"><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onPublishAll && <Button variant="primary" disabled={busy} onClick={onPublishAll}>Publicar canales Buffer</Button>}{(blog || instagram || instagramStory) && <Button variant="secondary" onClick={() => navigate(`/social-pack/${encodeURIComponent(contentTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))}?itemId=${encodeURIComponent(item.id)}&batchId=${encodeURIComponent(String(item.batchId || item.batch_id || ""))}`)}>Ver Social Pack</Button>}<span className="ui-field-hint">Instagram, Stories, LinkedIn, X y vídeos se envían por Buffer. El Blog usa el webhook de Coolify.</span></Inline>
    {showTeleprompter && <TeleprompterModal script={videoScript} itemId={video?.id ? item.id : ""} site={site} canPublish={Boolean(video)} busy={busy} onUploaded={onVideoUploaded} onPublish={() => onPublish("video")} onClose={() => setShowTeleprompter(false)} />}
  </Stack>;
}

function PackActions({ variant, busy, onCopy, onPublish }: { variant: ContentVariant; busy: boolean; onCopy: () => void; onPublish: () => void }) {
  return <Inline gap="sm"><Button variant="ghost" size="sm" onClick={onCopy}>Copiar</Button><Button variant="primary" size="sm" disabled={busy || variant.status !== "approved"} loading={busy} onClick={onPublish}>Publicar en Buffer</Button></Inline>;
}

function TeleprompterModal({ script, itemId, site, canPublish, busy, onUploaded, onPublish, onClose }: { script: string; itemId: string; site: string; canPublish: boolean; busy: boolean; onUploaded?: () => void; onPublish: () => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState("");
  const paragraphs = useMemo(() => script.replace(/([.!?])\s+/g, "$1\n").split(/\r?\n/).map((part) => part.trim()).filter(Boolean), [script]);
  const [currentParagraph, setCurrentParagraph] = useState(0);
  const paragraphRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  useEffect(() => {
    setCurrentParagraph(0);
    setPlaying(false);
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [script]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()); if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      const container = scrollRef.current;
      if (!container) return;
      if (container.scrollTop >= container.scrollHeight - container.clientHeight - 1) { setPlaying(false); return; }
      container.scrollBy({ top: 1, behavior: "auto" });
      const center = container.getBoundingClientRect().top + container.clientHeight / 2;
      let nearest = currentParagraph;
      let distance = Number.POSITIVE_INFINITY;
      paragraphRefs.current.forEach((paragraph, index) => {
        if (!paragraph) return;
        const rect = paragraph.getBoundingClientRect();
        const nextDistance = Math.abs(rect.top + rect.height / 2 - center);
        if (nextDistance < distance) { distance = nextDistance; nearest = index; }
      });
      if (nearest !== currentParagraph) setCurrentParagraph(nearest);
    }, 45);
    return () => window.clearInterval(timer);
  }, [currentParagraph, playing]);
  const start = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Tu navegador no permite grabar vídeo.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        setVideoBlob(blob);
        setVideoUrl(URL.createObjectURL(blob));
        setUploaded(false);
      };
      recorder.start(); recorderRef.current = recorder; setRecording(true); setCountdown(3); setPlaying(false); setError("");
      window.setTimeout(() => { setCountdown(0); setPlaying(true); }, 3000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo abrir la cámara."); }
  };
  const stop = () => { recorderRef.current?.stop(); streamRef.current?.getTracks().forEach((track) => track.stop()); setRecording(false); setCountdown(0); setPlaying(false); };
  const nextParagraph = () => {
    const next = Math.min(currentParagraph + 1, Math.max(paragraphs.length - 1, 0));
    setCurrentParagraph(next);
    const container = scrollRef.current;
    const paragraph = paragraphRefs.current[next];
    if (container && paragraph) container.scrollTo({ top: Math.max(0, paragraph.offsetTop - container.clientHeight / 2 + paragraph.offsetHeight / 2), behavior: "smooth" });
    setPlaying(true);
  };
  const upload = async () => {
    if (!videoBlob || !itemId || uploading) return;
    setUploading(true);
    setError("");
    try {
      const extension = videoBlob.type.includes("mp4") ? "mp4" : videoBlob.type.includes("quicktime") ? "mov" : "webm";
      const file = new File([videoBlob], `escarlet-reel.${extension}`, { type: videoBlob.type || "video/webm" });
      await api.uploadContentVideo(itemId, file, site);
      setUploaded(true);
      onUploaded?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo subir el vídeo.");
    } finally {
      setUploading(false);
    }
  };
  return <div className="ui-modal-backdrop" role="presentation"><section className="ui-modal teleprompter-modal" role="dialog" aria-modal="true" aria-label="Grabador con teleprompter"><div className="ui-modal-head"><div><p className="ui-eyebrow">Vídeo para Reel</p><h2>Grabador con teleprompter</h2></div><Button variant="ghost" onClick={onClose}>Cerrar</Button></div><div className="teleprompter-layout"><div className="camera-stage"><video ref={videoRef} muted playsInline /><span>{recording ? "●" : "○"}</span>{countdown > 0 && <div className="teleprompter-countdown" aria-live="assertive"><strong>{countdown}</strong><small>Prepárate</small></div>}</div><div className="teleprompter-script" ref={scrollRef}>{paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 18)}`} ref={(element) => { paragraphRefs.current[index] = element; }} className={index === currentParagraph ? "active" : ""}>{paragraph}</p>)}</div></div><div className="teleprompter-controls"><Button variant={recording ? "danger" : "primary"} onClick={recording ? stop : start}>{recording ? "Detener" : "Grabar"}</Button><Button variant="secondary" onClick={() => setPlaying((value) => !value)} disabled={countdown > 0}>{playing ? "Pausar" : "Reproducir"}</Button><Button variant="secondary" onClick={nextParagraph} disabled={!paragraphs.length || currentParagraph >= paragraphs.length - 1}>Siguiente línea</Button>{videoUrl && <a className="ui-button ui-button-secondary" href={videoUrl} download="escarlet-video.webm">Descargar vídeo</a>}{videoBlob && itemId && <Button variant="secondary" loading={uploading} disabled={uploading || uploaded} onClick={() => void upload()}>{uploaded ? "Vídeo subido" : "Subir vídeo a Buffer"}</Button>}{uploaded && canPublish && <Button variant="primary" loading={busy} disabled={busy} onClick={onPublish}>Publicar reel en Buffer</Button>}</div>{error && <p className="ui-field-error" role="alert">{error}</p>}</section></div>;
}
