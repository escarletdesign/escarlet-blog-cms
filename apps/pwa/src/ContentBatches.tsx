import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "./api";
import type { ContentChannel, ContentItem, ContentPlanSummary, ContentVariant } from "./types";
import { aggregateStatus, CONTENT_TITLE_MAX, itemTitle, statusLabel } from "./content-format";
import { ContentPackPreview } from "./ContentPackPreview";
import { Badge, Button, Card, ChannelBadge, Checkbox, Drawer, EmptyState, Field, Inline, Modal, PageHeader, Progress, ReviewToolbar, Select, Stack, StatusBadge, TextField, Textarea } from "./ui";

const ALL_CHANNELS: ContentChannel[] = ["blog", "instagram", "instagram_story", "linkedin", "x", "video"];
const channelLabel = (channel: string) => channel === "x" ? "X" : channel === "instagram_story" ? "Instagram Story" : channel === "video" ? "Vídeo / Reel" : channel.charAt(0).toUpperCase() + channel.slice(1);
const mediaUrl = (value: unknown, resolution: "thumb" | "preview" | "original" = "thumb") => {
  const media = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const candidates = media ? resolution === "thumb"
    ? [media.thumbUrl, media.thumbPath, media.previewUrl, media.previewPath, media.url, media.publicUrl, media.imageUrl, media.path]
    : resolution === "preview"
      ? [media.previewUrl, media.previewPath, media.thumbUrl, media.thumbPath, media.url, media.publicUrl, media.imageUrl, media.path]
      : [media.url, media.publicUrl, media.imageUrl, media.path]
    : [value];
  const url = String(candidates.find((candidate) => candidate) || "").trim();
  return url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "";
};
const itemCover = (item: ContentItem) => { const blog = (item.variants || []).find((variant) => variant.channel === "blog"); const candidates = [blog?.body?.imageThumbUrl, blog?.body?.imagePreviewUrl, blog?.body?.imageUrl, blog?.body?.coverUrl, blog?.media?.[0], ...(item.variants || []).flatMap((variant) => variant.media || [])]; return candidates.map((value) => mediaUrl(value, "thumb")).find(Boolean) || ""; };
const itemExcerpt = (item: ContentItem) => { const blog = (item.variants || []).find((variant) => variant.channel === "blog"); const excerpt = String(blog?.body?.excerpt || "").replace(/\s+/g, " ").trim(); const topic = String(item.topic || "").replace(/\s+/g, " ").trim(); const title = itemTitle(item); const text = excerpt || (topic && topic !== title ? topic : ""); return text.length > 180 ? text.slice(0, 177).trim() + "…" : text; };
const blogEditorValues = (item: ContentItem) => { const blog = (item.variants || []).find((variant) => variant.channel === "blog"); const body = blog?.body || {}; return { title: String(body.title || itemTitle(item)).trim(), excerpt: String(body.excerpt || body.excerptEs || "").trim(), content: String(body.bodyHtml || body.body || "").trim(), usesHtml: Boolean(body.bodyHtml) }; };
const localDateInput = (value?: string) => { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const pad = (part: number) => String(part).padStart(2, "0"); return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()); };
const dateKey = (itemId: string, channel: string) => itemId + ":" + channel;
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Sin fecha";
const publicationSortTime = (item: ContentItem) => {
  const times = (item.variants || []).map((variant) => variant.publicationDate).filter(Boolean).map((value) => new Date(value as string).getTime()).filter((value) => Number.isFinite(value));
  return times.length ? Math.min(...times) : Number.NEGATIVE_INFINITY;
};
const normalizeVariant = (raw: any): ContentVariant => ({ ...raw, channel: raw.channel, status: raw.status || "draft", body: raw.body || {}, publicationDate: raw.publicationDate || raw.publication_date || "", scheduleTimezone: raw.scheduleTimezone || raw.schedule_timezone || "", scheduleStatus: raw.scheduleStatus || raw.schedule_status || undefined, lastError: raw.lastError || raw.last_error || null });
const normalizeItem = (raw: any): ContentItem => ({ ...raw, batchId: raw.batchId || raw.batch_id, planTitle: raw.planTitle || raw.plan_title, planStatus: raw.planStatus || raw.plan_status, metadata: raw.metadata || {}, variants: Array.isArray(raw.variants) ? raw.variants.map(normalizeVariant) : [] });
const BUFFER_PUBLISH_CHANNELS: ContentChannel[] = ["instagram", "linkedin", "x", "video"];
const bufferPublishableChannels = (rows: Array<{ channel: string; enabled?: boolean; connectionStatus?: string }> = []) => {
  const ready: ContentChannel[] = [];
  for (const target of BUFFER_PUBLISH_CHANNELS) {
    const row = rows.find((item) => item.channel === target);
    if (!row?.enabled) continue;
    if (String(row.connectionStatus || "").toLowerCase() === "connected") {
      ready.push(target);
      continue;
    }
    if (target === "video") {
      const instagram = rows.find((item) => item.channel === "instagram");
      if (instagram?.enabled && String(instagram.connectionStatus || "").toLowerCase() === "connected") ready.push("video");
    }
  }
  return ready;
};

type Props = { site: string; brandId?: string; creationEnabled?: boolean; activeChannels?: Array<{ channel: string; enabled: boolean; connectionStatus?: string }>; onNotify?: (message: string, kind?: "success" | "error" | "info") => void };
type Dialog = { type: "edit" | "schedule" | "blog-edit"; item: ContentItem } | { type: "preview"; item: ContentItem; autoRecord?: boolean } | { type: "details"; item: ContentItem } | null;

export function ContentBatches({ site, brandId, creationEnabled = false, activeChannels, onNotify }: Props) {
  const [plans, setPlans] = useState<ContentPlanSummary[]>([]);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterChannel, setFilterChannel] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [modalValue, setModalValue] = useState("");
  const [blogForm, setBlogForm] = useState({ title: "", excerpt: "", content: "", usesHtml: false });
  const [scheduleChannels, setScheduleChannels] = useState<ContentChannel[]>([]);
  const notifyError = (message: string) => onNotify ? onNotify(message, "error") : setError(message);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dates, setDates] = useState<Record<string, string>>({});
  const [topics, setTopics] = useState("");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [calendarCursor, setCalendarCursor] = useState(() => new Date());
  const loadSequence = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const createIdempotencyKey = useRef<string | null>(null);
  const [searchParams] = useSearchParams();
  const channels = (activeChannels?.filter((channel) => channel.enabled).map((channel) => channel.channel).filter((channel): channel is ContentChannel => ALL_CHANNELS.includes(channel as ContentChannel)) || ALL_CHANNELS).slice(0, 7);
  const publishChannels = useMemo(() => bufferPublishableChannels(activeChannels || []), [activeChannels]);
  const connectionsPath = brandId ? `/brands/${encodeURIComponent(brandId)}/connections` : "/connections";
  const previewItem = dialog?.type === "preview" ? dialog.item : null;
  const detailItem = dialog?.type === "details" ? dialog.item : null;
  const bufferReady = publishChannels.length > 0;

  const load = async () => {
    const sequence = ++loadSequence.current;
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    setLoading(true); setError(""); setSetupRequired(false);
    try {
      const [planResponse, reviewResponse] = await Promise.all([api.contentPlans(site, controller.signal), api.reviewItems(site, controller.signal)]);
      if (sequence !== loadSequence.current || controller.signal.aborted) return;
      setPlans((planResponse.plans || []) as ContentPlanSummary[]);
      const nextItems = (reviewResponse.items || []).map(normalizeItem);
      setItems(nextItems);
      setDialog((current) => {
        if (!current) return current;
        const refreshed = nextItems.find((entry) => entry.id === current.item.id);
        return refreshed ? { ...current, item: refreshed } : current;
      });
      return true;
    } catch (err: any) {
      if (controller.signal.aborted || sequence !== loadSequence.current) return;
      if (err?.status === 404 || /workspace|sitio|marca/i.test(err?.message || "")) setSetupRequired(true);
      else {
        const message = err?.message || "No se pudo cargar el contenido.";
        setError(message);
        onNotify?.(message, "error");
      }
      return false;
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  };
  useEffect(() => { void load(); return () => { loadAbort.current?.abort(); }; }, [site]);
  useEffect(() => { setFilterPlan(searchParams.get("plan") || "all"); setFilterStatus(searchParams.get("status") || "all"); }, [searchParams]);

  const visibleItems = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    return items.filter((item) => {
      const itemStatus = aggregateStatus(item);
      const datesForItem = (item.variants || []).map((variant) => variant.publicationDate).filter(Boolean).map((value) => new Date(value as string)).filter((date) => !Number.isNaN(date.getTime()));
      const hasDate = datesForItem.length > 0;
      const dateMatch = filterDate === "all" || (filterDate === "no_date" && !hasDate) || (filterDate === "overdue" && datesForItem.some((date) => date < new Date())) || (filterDate === "today" && datesForItem.some((date) => date >= today && date < tomorrow)) || (filterDate === "upcoming" && datesForItem.some((date) => date >= tomorrow));
      const text = (item.topic + " " + (item.planTitle || "") + " " + (item.metadata?.contentTitle || "")).toLowerCase();
      return (!query || text.includes(query)) && (filterPlan === "all" || String(item.batchId) === filterPlan) && (filterStatus === "all" || itemStatus === filterStatus || item.status === filterStatus) && (filterChannel === "all" || (item.variants || []).some((variant) => variant.channel === filterChannel)) && dateMatch;
    }).sort((left, right) => publicationSortTime(left) - publicationSortTime(right));
  }, [items, filterQuery, filterPlan, filterStatus, filterChannel, filterDate]);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true); setError(""); let failure = "";
    try {
      try { await action(); } catch (err: any) { failure = err?.message || "No se pudo completar la operación."; }
      const reloaded = await load();
      if (reloaded === false && !failure) failure = "No se pudo recargar el contenido.";
      if (failure) notifyError(failure);
      return !failure;
    } finally { setBusy(false); }
  };
  const create = async (event: FormEvent) => { event.preventDefault(); const cleanTopics = topics.split(/\r?\n|,/).map((topic) => topic.trim()).filter(Boolean); if (!cleanTopics.length) { notifyError("Añade al menos un tema."); return; } const idempotencyKey = createIdempotencyKey.current || (createIdempotencyKey.current = crypto.randomUUID()); const ok = await run(async () => { await api.createContentBatch({ site, title: title.trim() || "Campaña " + new Date().toLocaleDateString(), topics: cleanTopics, channels, idempotencyKey }); setTitle(""); setTopics(""); setCreateOpen(false); }); if (ok) createIdempotencyKey.current = null; };
  const approve = (id: string) => run(() => api.approveContent(id, site));
  const update = (id: string, topic: string) => run(() => api.updateContentItem(id, { site, topic }));
  const schedule = (id: string, value: string, channelsToSchedule: ContentChannel[]) => run(() => api.scheduleContent(id, value, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", site, channelsToSchedule));
  const saveChannelDate = (item: ContentItem, variant: ContentVariant) => {
    const key = dateKey(item.id, variant.channel); const when = dates[key] ? new Date(dates[key]) : null;
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) { notifyError("La fecha tiene que ser futura."); return; }
    const timezone = variant.scheduleTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const call = variant.status === "approved" ? api.scheduleContent(item.id, when.toISOString(), timezone, site, [variant.channel]) : api.rescheduleContent(item.id, when.toISOString(), timezone, site, [variant.channel]);
    return run(async () => { await call; setDates((current) => { const next = { ...current }; delete next[key]; return next; }); });
  };
  const publishBuffer = (item: ContentItem, channel: ContentChannel, copy?: string) => { if (channel === "blog") { notifyError("El Blog se publica mediante el webhook de Coolify configurado en Administración."); return; } return run(() => api.publishContentViaBuffer(item.id, [channel], site, copy)); };
  const publishBufferAll = (item: ContentItem) => { const targetChannels = (item.variants || []).filter((variant) => (variant.scheduleStatus || variant.status) === "approved" && publishChannels.includes(variant.channel)).map((variant) => variant.channel).filter((channel): channel is ContentChannel => ["instagram", "instagram_story", "linkedin", "x", "video"].includes(channel)); if (!targetChannels.length) { notifyError("Este contenido no tiene canales aprobados conectados a Buffer."); return; } return run(() => api.publishContentViaBuffer(item.id, targetChannels, site)); };
  const syncRemoteStatuses = () => run(async () => {
    const result = await api.syncContentRemoteStatus(site);
    onNotify?.(`Sincronización con proveedores encolada (${result.queued} tareas).`, "info");
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
  });
  const publishBlog = (item: ContentItem, variant: ContentVariant) => run(() => {
    const publicationDate = new Date().toISOString();
    return (variant.scheduleStatus || variant.status) === "approved"
      ? api.scheduleContent(item.id, publicationDate, "UTC", site, ["blog"], { publishNow: true })
      : api.rescheduleContent(item.id, publicationDate, "UTC", site, ["blog"], { publishNow: true });
  });
  const reopenBlog = (item: ContentItem) => run(async () => { await api.reopenUnsentChannel(item.id, "blog", site); onNotify?.("Blog reabierto. Ya puedes publicarlo de nuevo."); });
  const skipChannel = (item: ContentItem, channel: ContentChannel) => run(() => api.cancelContentChannel(item.id, channel, site));
  const openPreview = (item: ContentItem, autoRecord = false) => setDialog({ type: "preview", item, autoRecord });
  const openBlogEditor = (item: ContentItem) => { setBlogForm(blogEditorValues(item)); setDialog({ type: "blog-edit", item }); };
  const savePublishedBlog = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.type !== "blog-edit") return;
    const blog = dialog.item.variants.find((variant) => variant.channel === "blog");
    if (!blog || !blogForm.title.trim() || !blogForm.content.trim()) return;
    const nextBody = { ...blog.body, title: blogForm.title.trim(), excerpt: blogForm.excerpt.trim(), ...(blogForm.usesHtml ? { bodyHtml: blogForm.content } : { body: blogForm.content }) };
    const saved = await run(() => api.updateContentItem(dialog.item.id, { site, channel: "blog", contentTitle: blogForm.title.trim(), body: nextBody, keepPublished: true }));
    if (saved) { onNotify?.("Cambios guardados. El Blog se está actualizando."); setDialog(null); }
  };
  const openSchedule = (item: ContentItem) => { setDialog({ type: "schedule", item }); setModalValue(""); setScheduleChannels((item.variants || []).filter((variant) => (variant.scheduleStatus || variant.status) === "approved").map((variant) => variant.channel)); };
  const dateSummary = (item: ContentItem) => { const values = [...new Set((item.variants || []).map((variant) => variant.publicationDate).filter(Boolean))].sort(); if (!values.length) return "Sin fecha de publicación"; if (values.length === 1) return formatDate(values[0]); return formatDate(values[0]) + " · " + formatDate(values[values.length - 1]); };
  const scheduledItems = visibleItems.filter((item) => (item.variants || []).some((variant) => variant.publicationDate && ["scheduled", "syncing"].includes(variant.scheduleStatus || variant.status)));
  const calendarDays = useMemo(() => { const year = calendarCursor.getFullYear(); const month = calendarCursor.getMonth(); const first = (new Date(year, month, 1).getDay() + 6) % 7; const total = new Date(year, month + 1, 0).getDate(); return Array.from({ length: 42 }, (_, index) => { const number = index - first + 1; return { date: new Date(year, month, number), inMonth: number >= 1 && number <= total }; }); }, [calendarCursor]);
  const calendarDayKey = (date: Date) => date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  const calendarLabel = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(calendarCursor);
  const itemsForDay = (date: Date) => scheduledItems.filter((item) => (item.variants || []).some((variant) => variant.publicationDate && calendarDayKey(new Date(variant.publicationDate)) === calendarDayKey(date)));

  return <main className="ui-page ui-plans-page">
    <PageHeader eyebrow="Espacio editorial" title="Contenido" description="Revisa, filtra y ejecuta todos los contenidos de la marca desde una sola bandeja." actions={<Inline gap="sm"><Button variant="ghost" disabled={busy || loading} onClick={() => void syncRemoteStatuses()}>Sincronizar estados</Button><Button variant={view === "list" ? "secondary" : "ghost"} onClick={() => setView("list")}>Lista</Button><Button variant={view === "calendar" ? "secondary" : "ghost"} onClick={() => setView("calendar")}>Calendario</Button>{creationEnabled && <Button onClick={() => setCreateOpen(true)}>Nueva campaña</Button>}</Inline>} />
    {error && !items.length && <EmptyState title="No se pudo cargar el contenido" description={error} action={<Button variant="ghost" size="sm" onClick={() => void load()}>Reintentar</Button>} />}
    {!loading && setupRequired && <EmptyState title="Configura tu marca para comenzar" description="Un administrador debe inicializar el espacio y asignarte una marca antes de mostrar publicaciones." />}
    {!loading && !setupRequired && !items.length && !error && <EmptyState title="Todavía no hay contenido" description="Crea una campaña aquí o desde ChatGPT. Cuando esté lista, aparecerá en esta bandeja." />}
    {loading ? <Stack gap="md"><Card><Progress value={35} /><p className="ui-muted">Cargando contenido…</p></Card></Stack> : !setupRequired && (items.length > 0 || plans.length > 0) && <div className="ui-plans-workspace">
      <ReviewToolbar>
        <Field label="Buscar"><TextField value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} placeholder="Título, brief o campaña" /></Field>
        <Field label="Campaña"><Select value={filterPlan} onChange={(event) => setFilterPlan(event.target.value)}><option value="all">Todas las campañas</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</Select></Field>
        <Field label="Estado"><Select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}><option value="all">Todos los estados</option>{["draft", "generated", "needs_review", "approved", "scheduled", "published", "action_required", "failed", "canceled"].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</Select></Field>
        <Field label="Canal"><Select value={filterChannel} onChange={(event) => setFilterChannel(event.target.value)}><option value="all">Todos los canales</option>{channels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}</Select></Field>
        <Field label="Fecha"><Select value={filterDate} onChange={(event) => setFilterDate(event.target.value)}><option value="all">Todas las fechas</option><option value="no_date">Sin fecha</option><option value="overdue">Con fecha vencida</option><option value="today">Hoy</option><option value="upcoming">Próximas</option></Select></Field>
        <div className="ui-filter-summary"><span>{visibleItems.length} publicaciones</span></div>
      </ReviewToolbar>
      {view === "list" && (visibleItems.length ? <Stack gap="sm">{visibleItems.map((item) => {
        const status = aggregateStatus(item); const titleText = itemTitle(item); const cover = itemCover(item); const excerpt = itemExcerpt(item);
        return <Card className="ui-review-item" key={item.id}><div className="ui-card-head"><div className="ui-review-item-title">{cover ? <img className="ui-review-thumb" src={cover} alt="" loading="lazy" decoding="async" /> : <span className="ui-review-thumb" aria-hidden="true" />}<div><span className="ui-eyebrow">{item.planTitle || "Contenido"}</span><h3>{titleText}</h3>{excerpt && <p className="ui-review-excerpt">{excerpt}</p>}<p className="ui-muted">{dateSummary(item)}</p></div></div><StatusBadge status={status} label={statusLabel(status)} /></div><div className="ui-channel-list">{(item.variants || []).map((variant) => <ChannelBadge key={variant.id} channel={variant.channel} />)}</div>{item.error && <p className="ui-field-error">{item.error}</p>}<div className="ui-card-actions"><Button variant="secondary" size="sm" disabled={busy} onClick={() => setDialog({ type: "details", item })}>Canales y publicación</Button><Button variant="ghost" size="sm" disabled={busy || !(item.variants || []).length} onClick={() => openPreview(item)}>Vista previa</Button></div></Card>;
      })}</Stack> : <EmptyState title="No hay publicaciones con estos filtros" description="Prueba otra combinación de búsqueda, estado, canal o fecha." />)}
      {view === "calendar" && <Card className="ui-calendar-month"><div className="ui-calendar-month-head"><Button variant="ghost" size="sm" aria-label="Mes anterior" onClick={() => setCalendarCursor((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}>‹</Button><strong>{calendarLabel}</strong><Button variant="ghost" size="sm" aria-label="Mes siguiente" onClick={() => setCalendarCursor((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}>›</Button></div><div className="ui-calendar-weekdays">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div><div className="ui-calendar-grid">{calendarDays.map(({ date, inMonth }) => { const dayItems = itemsForDay(date); return <div className={"ui-calendar-day " + (inMonth ? "" : "outside") + (dayItems.length ? " has-items" : "")} key={calendarDayKey(date)}><span>{date.getDate()}</span>{dayItems.slice(0, 4).map((item) => <button type="button" className="ui-calendar-item" key={item.id} onClick={() => setDialog({ type: "details", item })}><Inline gap="sm">{item.variants.filter((variant) => variant.publicationDate && calendarDayKey(new Date(variant.publicationDate)) === calendarDayKey(date)).map((variant) => <ChannelBadge key={variant.id} channel={variant.channel} />)}</Inline><small>{itemTitle(item)}</small></button>)}{dayItems.length > 4 && <small>+{dayItems.length - 4}</small>}</div>; })}</div>{!scheduledItems.length && <p className="ui-muted">No hay publicaciones programadas con estos filtros.</p>}</Card>}
    </div>}
    {previewItem && <section className="ui-plan-preview-screen"><PageHeader eyebrow="Vista previa" title={itemTitle(previewItem)} description="Revisa el pack completo antes de publicar." back={<Button variant="ghost" onClick={() => setDialog(null)}>← Volver al contenido</Button>} /><ContentPackPreview site={site} item={previewItem} autoRecord={dialog?.type === "preview" && dialog.autoRecord} bufferReady={bufferReady} publishChannels={publishChannels} busy={busy} onVideoUploaded={(replacedPrevious) => { onNotify?.(replacedPrevious ? "Vídeo guardado. Se reemplazó el anterior del mismo formato." : "Vídeo guardado."); void load(); }} onNotify={onNotify} onClose={() => setDialog(null)} onEditBlog={() => openBlogEditor(previewItem)} onPublish={(channel, copy) => void publishBuffer(previewItem, channel, copy)} onPublishAll={() => void publishBufferAll(previewItem)} /></section>}
    <Drawer open={Boolean(detailItem)} title={detailItem ? itemTitle(detailItem) : "Canales y publicación"} onClose={() => setDialog(null)}>
      {detailItem && <Stack gap="md">
        <p className="ui-muted">{detailItem.planTitle || "Contenido"} · {dateSummary(detailItem)}</p>
        {itemExcerpt(detailItem) && <p>{itemExcerpt(detailItem)}</p>}
        {detailItem.variants.map((variant) => {
          const key = dateKey(detailItem.id, variant.channel);
          const currentStatus = variant.scheduleStatus || variant.status;
          const serverDate = localDateInput(variant.publicationDate);
          const draftDate = dates[key] ?? serverDate;
          const editableDate = ["approved", "scheduled", "failed", "action_required"].includes(currentStatus);
          const canSkip = !["published", "canceled", "syncing"].includes(currentStatus);
          const canPublishSocial = variant.channel !== "blog" && currentStatus === "approved" && publishChannels.includes(variant.channel);
          const missingConnection = variant.channel !== "blog" && currentStatus === "approved" && !publishChannels.includes(variant.channel);
          return <Card key={variant.id} className="ui-channel-detail">
            <Inline gap="sm"><ChannelBadge channel={variant.channel} /><StatusBadge status={currentStatus} label={statusLabel(currentStatus)} /></Inline>
            <p className="ui-muted">{variant.publicationDate ? formatDate(variant.publicationDate) : "Sin fecha de publicación"}</p>
            {editableDate && <Inline gap="sm"><TextField type="datetime-local" aria-label={"Fecha de " + channelLabel(variant.channel)} value={draftDate} onChange={(event) => setDates((current) => ({ ...current, [key]: event.target.value }))} /><Button size="sm" disabled={busy || !draftDate || draftDate === serverDate} onClick={() => void saveChannelDate(detailItem, variant)}>Guardar fecha</Button></Inline>}
            {variant.lastError && <p className="ui-field-error">{variant.lastError}</p>}
            {currentStatus === "published" && <p className="ui-field-hint">Este canal ya fue publicado. No se volverá a enviar.</p>}
            {variant.channel === "blog" && currentStatus === "syncing" && <p className="ui-field-hint">Coolify está desplegando el artículo. Se marcará como publicado cuando la URL esté visible.</p>}
            {currentStatus === "canceled" && <p className="ui-field-hint">Este canal quedó marcado como “No publicar”.</p>}
            {variant.channel === "blog" && ["approved", "scheduled", "failed", "action_required"].includes(currentStatus) && <Button size="sm" disabled={busy} onClick={() => void publishBlog(detailItem, variant)}>Publicar Blog ahora</Button>}
            {variant.channel === "blog" && currentStatus === "published" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => openBlogEditor(detailItem)}>Editar publicación</Button>}
            {variant.channel === "blog" && variant.status === "published" && ["published", "action_required"].includes(currentStatus) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reopenBlog(detailItem)}>No aparece en el Blog</Button>}
            {canPublishSocial && variant.channel === "video" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => openPreview(detailItem, true)}>Grabar o subir vídeo</Button>}
            {canPublishSocial && <Button size="sm" disabled={busy} onClick={() => void publishBuffer(detailItem, variant.channel)}>{variant.channel === "video" ? "Publicar Reel en Buffer" : "Publicar ahora"}</Button>}
            {missingConnection && variant.channel === "video" && <p className="ui-field-hint">Asigna la cuenta de Reel en Buffer (campo «Vídeo / Reel» o Instagram) en <Link className="text-link" to={connectionsPath}>Conexiones</Link> y vuelve aquí para publicar.</p>}
            {missingConnection && variant.channel !== "video" && <p className="ui-field-hint">Este canal no tiene una conexión activa. Configúralo en <Link className="text-link" to={connectionsPath}>Conexiones</Link> o márcalo como «No publicar».</p>}
            {canSkip && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void skipChannel(detailItem, variant.channel)}>No publicar</Button>}
          </Card>;
        })}
        {detailItem.variants.some((variant) => (variant.scheduleStatus || variant.status) === "approved") && <Button variant="secondary" size="sm" disabled={busy} onClick={() => openSchedule(detailItem)}>Agendar canales pendientes</Button>}
        <Card>
          <h3>Opciones del contenido completo</h3>
          <p className="ui-field-hint">Estas acciones afectan todos los canales que todavía no se publicaron.</p>
          <Inline gap="sm">
            {detailItem.variants.some((variant) => ["generated", "needs_review"].includes(variant.scheduleStatus || variant.status)) && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void approve(detailItem.id)}>Aprobar canales pendientes</Button>}
            {!detailItem.variants.every((variant) => ["published", "canceled"].includes(variant.scheduleStatus || variant.status)) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDialog({ type: "edit", item: detailItem }); setModalValue(detailItem.topic); }}>Editar brief original</Button>}
          </Inline>
        </Card>
      </Stack>}
    </Drawer>
    <Modal open={dialog?.type === "edit" || dialog?.type === "schedule"} title={dialog?.type === "edit" ? "Editar brief original" : "Agendar publicación"} onClose={() => setDialog(null)}>{dialog?.type === "edit" && <form className="ui-stack ui-stack-md" onSubmit={(event) => { event.preventDefault(); if (modalValue.trim()) void update(dialog.item.id, modalValue.trim()).then(() => setDialog(null)); }}><Field label="Brief original" hint="Cambia la consigna editorial del item. No modifica automáticamente los textos ya generados para cada canal." required><Textarea value={modalValue} onChange={(event) => setModalValue(event.target.value)} rows={6} autoFocus required /></Field><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" loading={busy}>Guardar brief</Button></Inline></form>}{dialog?.type === "schedule" && <form className="ui-stack ui-stack-md" onSubmit={(event) => { event.preventDefault(); if (!modalValue || !scheduleChannels.length) { notifyError("Selecciona al menos un canal para agendar."); return; } void schedule(dialog.item.id, new Date(modalValue).toISOString(), scheduleChannels).then(() => setDialog(null)); }}><Field label="Fecha y hora" hint="Se usará tu zona horaria local." required><TextField type="datetime-local" value={modalValue} onChange={(event) => setModalValue(event.target.value)} autoFocus required /></Field><fieldset className="ui-field"><legend className="ui-field-label">Canales a agendar</legend><div className="ui-channel-select" role="group" aria-label="Canales a agendar">{dialog.item.variants.filter((variant) => (variant.scheduleStatus || variant.status) === "approved").map((variant) => <Checkbox key={variant.id} label={channelLabel(variant.channel)} checked={scheduleChannels.includes(variant.channel)} onChange={(event) => setScheduleChannels((current) => event.target.checked ? [...new Set([...current, variant.channel])] : current.filter((channel) => channel !== variant.channel))} />)}</div><small className="ui-field-hint">Solo aparecen canales aprobados y todavía pendientes de publicación.</small></fieldset><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" loading={busy} disabled={!scheduleChannels.length}>Agendar canales</Button></Inline></form>}</Modal>
    <Modal open={dialog?.type === "blog-edit"} title="Editar publicación" onClose={() => setDialog(null)}>{dialog?.type === "blog-edit" && <form className="ui-stack ui-stack-md" onSubmit={(event) => void savePublishedBlog(event)}><Field label="Título" hint={`${blogForm.title.length}/${CONTENT_TITLE_MAX}. La URL actual se conservará.`} required><TextField value={blogForm.title} maxLength={CONTENT_TITLE_MAX} onChange={(event) => setBlogForm((current) => ({ ...current, title: event.target.value }))} autoFocus required /></Field><Field label="Extracto"><Textarea value={blogForm.excerpt} onChange={(event) => setBlogForm((current) => ({ ...current, excerpt: event.target.value }))} rows={4} /></Field><Field label="Contenido del artículo" hint="Al guardar se despliega una nueva versión del Blog." required><Textarea value={blogForm.content} onChange={(event) => setBlogForm((current) => ({ ...current, content: event.target.value }))} rows={18} required /></Field><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" loading={busy} disabled={!blogForm.title.trim() || !blogForm.content.trim()}>Guardar y actualizar</Button></Inline></form>}</Modal>
    <Modal open={createOpen} title="Nueva campaña" onClose={() => setCreateOpen(false)}><form className="ui-stack ui-stack-md" onSubmit={(event) => void create(event)}><Field label="Título de la campaña" hint="La campaña agrupa una o varias publicaciones relacionadas para revisarlas y agendarlas."><TextField value={title} onChange={(event) => { createIdempotencyKey.current = null; setTitle(event.target.value); }} placeholder="Campaña de septiembre" /></Field><Field label="Briefs de publicaciones" hint="Un brief por línea. El sistema deriva un título breve para cada publicación." required><Textarea value={topics} onChange={(event) => { createIdempotencyKey.current = null; setTopics(event.target.value); }} rows={7} required placeholder={"La IA acelera la producción, pero el criterio se convierte en el cuello de botella\nCómo revisar UX, UI y producto antes de publicar"} /></Field><fieldset className="ui-field"><legend className="ui-field-label">Canales activos</legend><Inline gap="md">{channels.map((channel) => <Badge key={channel} tone="info">{channelLabel(channel)}</Badge>)}</Inline><small className="ui-field-hint">Los canales se configuran en la marca.</small></fieldset><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button type="submit" loading={busy}>Crear campaña</Button></Inline></form></Modal>
  </main>;
}
