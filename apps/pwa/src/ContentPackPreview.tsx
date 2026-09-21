import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ContentChannel, ContentItem, ContentVariant } from "./types";
import { Badge, Button, Card, ChannelBadge, EmptyState, IconButton, Inline, Stack, StatusBadge } from "./ui";

const packChannels: ContentChannel[] = ["blog", "instagram", "linkedin", "x", "substack", "video"];
const label = (channel: string) => channel === "x" ? "X" : channel === "video" ? "Vídeo" : channel.charAt(0).toUpperCase() + channel.slice(1);

function bodyFor(variant?: ContentVariant) {
  const body = variant?.body || {};
  const socialPack = body.socialPack && typeof body.socialPack === "object" ? body.socialPack : {};
  return { body, socialPack };
}

function imageFor(variant?: ContentVariant) {
  const { body } = bodyFor(variant);
  return String(body.imageUrl || body.image_url || body.coverUrl || variant?.media?.[0]?.url || variant?.media?.[0]?.path || "").trim();
}

function cleanImageUrl(value: unknown) {
  const url = String(value || "").trim();
  return url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "";
}

function copyValue(value: string) {
  return navigator.clipboard ? navigator.clipboard.writeText(value).catch(() => undefined) : Promise.resolve();
}

function textFor(variant?: ContentVariant) {
  const { body, socialPack } = bodyFor(variant);
  if (!variant) return "";
  if (variant.channel === "instagram") return String(socialPack.instagramCaption || socialPack.caption || body.caption || body.text || body.body || body.topic || "").trim();
  return String(body.body || body.bodyHtml || body.text || body.caption || body.summary || body.topic || "").replace(/<[^>]*>/g, "").trim();
}

function slidesFor(variant?: ContentVariant) {
  const { socialPack } = bodyFor(variant);
  if (!Array.isArray(socialPack.instagramSlides)) return [];
  return socialPack.instagramSlides.map((slide: any, index: number) => ({
    ...slide,
    imageUrl: slide?.imageUrl || slide?.url || slide?.image || variant?.media?.[index]?.url || variant?.media?.[index]?.path || ""
  }));
}

function titleFor(variant?: ContentVariant, fallback = "") {
  const { body } = bodyFor(variant);
  return String(body.title || body.headline || fallback);
}

export function ContentPackPreview({ item, busy, onClose, onPublish }: { item: ContentItem; busy: boolean; onClose: () => void; onPublish: (channel: ContentChannel) => void }) {
  const navigate = useNavigate();
  const variants = (item.variants || []).filter((variant) => packChannels.includes(variant.channel));
  const blog = variants.find((variant) => variant.channel === "blog");
  const instagram = variants.find((variant) => variant.channel === "instagram");
  const slides = slidesFor(instagram);
  const { socialPack } = bodyFor(instagram);
  const videoScript = String(socialPack.videoScript || variants.find((variant) => variant.channel === "video")?.body?.text || [item.topic, ...slides.map((entry: any) => [entry?.headline, entry?.body].filter(Boolean).join("\n"))].filter(Boolean).join("\n\n")).trim();
  const [activeSlide, setActiveSlide] = useState(0);
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const safeSlide = slides.length ? Math.min(activeSlide, slides.length - 1) : 0;
  const slide = slides[safeSlide];
  const slideImage = cleanImageUrl(slide?.imageUrl || slide?.url || slide?.image);
  const blogImage = cleanImageUrl(imageFor(blog));
  const textVariants = variants.filter((variant) => !["blog", "instagram", "video"].includes(variant.channel) && textFor(variant));

  if (!variants.length) return <EmptyState title="No hay variantes para previsualizar" description="El contenido todavía no tiene un pack de Blog o redes disponible." />;
  return <Stack gap="md">
    <div className="social-pack-toolbar ui-plan-pack-toolbar"><div><p className="ui-eyebrow">Social Pack</p><strong>{item.topic}</strong></div><StatusBadge status={item.status} /></div>
    <div className="social-visual-grid ui-plan-pack-visual-grid">
      {blog && <article className="ui-card social-cover-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Blog</p><h2>{titleFor(blog, item.topic)}</h2></div><ChannelBadge channel="blog" /></div>{blogImage ? <img src={blogImage} alt={String(blog.body?.imageAlt || item.topic)} loading="lazy" /> : <div className="carousel-placeholder">Blog</div>}<p>{textFor(blog)}</p><Stack gap="sm"><Inline gap="sm"><Button variant="ghost" size="sm" onClick={() => void copyValue(textFor(blog))}>Copiar</Button><Badge tone="info">Webhook de Coolify</Badge></Inline><p className="ui-field-hint">El Blog se publica mediante el webhook de Coolify configurado en Administración. No se envía a Buffer.</p></Stack></article>}
      {instagram && <article className="ui-card social-carousel-card"><div className="social-channel-head"><div><p className="ui-eyebrow">Instagram</p><h2>Carousel</h2></div><ChannelBadge channel="instagram" /></div>{slides.length ? <div className="instagram-carousel" role="region" aria-label="Carrusel de Instagram"><div className="instagram-carousel-stage"><IconButton className="carousel-nav carousel-prev" label="Slide anterior" onClick={() => setActiveSlide((safeSlide - 1 + slides.length) % slides.length)}>‹</IconButton><figure>{slideImage ? <img src={slideImage} alt={String(slide?.alt || slide?.headline || `Slide ${safeSlide + 1}`)} /> : <div className="carousel-placeholder">{safeSlide + 1}</div>}<figcaption><span>{String(slide?.headline || slide?.text || `Slide ${safeSlide + 1}`)}</span>{slideImage && <a className="chip" href={slideImage} target="_blank" rel="noreferrer">Abrir</a>}</figcaption></figure><IconButton className="carousel-nav carousel-next" label="Slide siguiente" onClick={() => setActiveSlide((safeSlide + 1) % slides.length)}>›</IconButton></div><div className="carousel-dots" role="tablist" aria-label="Slides de Instagram">{slides.map((entry: any, index: number) => <Button key={entry?.id || index} className={`carousel-dot${index === safeSlide ? " active" : ""}`} variant="ghost" size="sm" role="tab" aria-selected={index === safeSlide} aria-label={`Slide ${index + 1}`} onClick={() => setActiveSlide(index)}>{index + 1}</Button>)}</div></div> : <p className="ui-muted">No hay slides generadas todavía.</p>}<p className="ui-plan-caption">{textFor(instagram)}</p><PackActions variant={instagram} busy={busy} onCopy={() => void copyValue(textFor(instagram))} onPublish={() => onPublish("instagram")} /></article>}
    </div>
    {textVariants.length > 0 && <div className="social-pack-grid">{textVariants.map((variant) => <article className="ui-card social-channel-card" key={variant.id}><div className="social-channel-head"><h2><ChannelBadge channel={variant.channel} /> {label(variant.channel)}</h2><Button variant="ghost" size="sm" onClick={() => void copyValue(textFor(variant))}>Copiar</Button></div><p>{textFor(variant)}</p></article>)}</div>}
    {videoScript && <section className="ui-card teleprompter-launch-card"><div><p className="ui-eyebrow">Vídeo</p><h2>Grabar con teleprompter</h2><p className="ui-muted">Usa el guion del pack para grabar desde el navegador.</p></div><Button onClick={() => setShowTeleprompter(true)}>Abrir grabador</Button></section>}
    <Inline gap="md"><Button variant="ghost" onClick={onClose}>Cerrar</Button>{(blog || instagram) && <Button variant="secondary" onClick={() => navigate(`/social-pack/${encodeURIComponent(String(item.topic || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))}?itemId=${encodeURIComponent(item.id)}&batchId=${encodeURIComponent(String(item.batchId || item.batch_id || ""))}`)}>Ver Social Pack</Button>}<span className="ui-field-hint">Instagram se publica en Buffer. El Blog usa el webhook de Coolify configurado en Administración.</span></Inline>
    {showTeleprompter && <TeleprompterModal script={videoScript} onClose={() => setShowTeleprompter(false)} />}
  </Stack>;
}

function PackActions({ variant, busy, onCopy, onPublish }: { variant: ContentVariant; busy: boolean; onCopy: () => void; onPublish: () => void }) {
  return <Inline gap="sm"><Button variant="ghost" size="sm" onClick={onCopy}>Copiar</Button><Button variant="primary" size="sm" disabled={busy || variant.status !== "approved"} loading={busy} onClick={onPublish}>Publicar en Buffer</Button></Inline>;
}

function TeleprompterModal({ script, onClose }: { script: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");
  const paragraphs = useMemo(() => script.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean), [script]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()); if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => { if (!playing) return undefined; const timer = window.setInterval(() => scrollRef.current?.scrollBy({ top: 1, behavior: "auto" }), 45); return () => window.clearInterval(timer); }, [playing]);
  const start = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Tu navegador no permite grabar vídeo.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => setVideoUrl(URL.createObjectURL(new Blob(chunksRef.current, { type: "video/webm" })));
      recorder.start(); recorderRef.current = recorder; setRecording(true); setCountdown(3); setPlaying(false); setError("");
      window.setTimeout(() => { setCountdown(0); setPlaying(true); }, 3000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo abrir la cámara."); }
  };
  const stop = () => { recorderRef.current?.stop(); streamRef.current?.getTracks().forEach((track) => track.stop()); setRecording(false); setCountdown(0); setPlaying(false); };
  return <div className="ui-modal-backdrop" role="presentation"><section className="ui-modal teleprompter-modal" role="dialog" aria-modal="true" aria-label="Grabador con teleprompter"><div className="ui-modal-head"><div><p className="ui-eyebrow">Vídeo</p><h2>Grabador con teleprompter</h2></div><Button variant="ghost" onClick={onClose}>Cerrar</Button></div><div className="teleprompter-layout"><div className="camera-stage"><video ref={videoRef} muted playsInline /><span>{recording ? "●" : "○"}</span>{countdown > 0 && <div className="teleprompter-countdown" aria-live="assertive"><strong>{countdown}</strong><small>Prepárate</small></div>}</div><div className="teleprompter-script" ref={scrollRef}>{paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 18)}`}>{paragraph}</p>)}</div></div><div className="teleprompter-controls"><Button variant={recording ? "danger" : "primary"} onClick={recording ? stop : start}>{recording ? "Detener" : "Grabar"}</Button><Button variant="secondary" onClick={() => setPlaying((value) => !value)} disabled={countdown > 0}>{playing ? "Pausar" : "Reproducir"}</Button>{videoUrl && <a className="ui-button ui-button-secondary" href={videoUrl} download="escarlet-video.webm">Descargar vídeo</a>}</div>{error && <p className="ui-field-error" role="alert">{error}</p>}</section></div>;
}
