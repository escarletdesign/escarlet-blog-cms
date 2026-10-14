import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useApp, useI18n } from "../../app/context";
import { contentPreviewPath, itemTitle, statusLabel } from "../../content-format";
import type { CalendarEntry, ContentItem } from "../../types";
import {
  Badge,
  Button,
  Card,
  ChannelBadge,
  Drawer,
  EmptyState as UiEmptyState,
  Field,
  Inline,
  Modal,
  MultiSelectPills,
  PageHeader,
  Stack,
  StatusBadge,
  Switch,
  TextField,
} from "../../ui";

const calendarMediaUrl = (value: unknown) => {
  const media = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const candidates = media
    ? [media.thumbUrl, media.thumbPath, media.previewUrl, media.previewPath, media.url, media.publicUrl, media.imageUrl, media.path]
    : [value];
  const url = String(candidates.find((candidate) => candidate) || "").trim();
  return url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "";
};

const calendarMediaKind = (value: unknown, url: string, channel?: string) => {
  const media = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const type = String(media.mimeType || media.contentType || media.type || media.kind || "").toLowerCase();
  return type.includes("video") || (channel === "video" && /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(url)) ? "video" : "image";
};

type CalendarChannel = Pick<CalendarEntry, "channel" | "provider" | "status"> & {
  lastError: string;
  publicationDate: string;
  timezone: string;
  updatedAt: string;
};
type GroupedCalendarEntry = CalendarEntry & {
  publicationDate: string;
  itemKey: string;
  item: ContentItem | null;
  channels: CalendarChannel[];
};

export function EditorialCalendar() {
  const { site } = useApp();
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [cursor, setCursor] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retrySelection, setRetrySelection] = useState<string[]>([]);
  const [retryDate, setRetryDate] = useState("");
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [openId, setOpenId] = useState("");
  const [openDay, setOpenDay] = useState("");
  const [query, setQuery] = useState("");
  const [channelFilters, setChannelFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [retryingChannel, setRetryingChannel] = useState("");
  const load = (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    return Promise.all([
      api.calendarV2(site),
      api.contentBatches(site).catch(() => ({ items: [] as ContentItem[] })),
    ])
      .then(([result, content]) => { setEntries(result.entries || []); setContentItems(content.items || []); if (!quiet) setRetrySelection([]); })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar el calendario."))
      .finally(() => { if (!quiet) setLoading(false); });
  };
  useEffect(() => { void load(); }, [site]);
  const contentById = useMemo(() => new Map(contentItems.map((item) => [item.id, item])), [contentItems]);
  const validEntries = useMemo(() => entries.filter((entry): entry is CalendarEntry & { publicationDate: string } => Boolean(entry.publicationDate)), [entries]);
  const groupedEntries = useMemo<GroupedCalendarEntry[]>(() => {
    const grouped = new Map<string, GroupedCalendarEntry>();
    for (const entry of validEntries) {
      const key = String(entry.itemId || entry.variantId);
      const channel = { channel: entry.channel || "blog", provider: entry.provider, status: entry.status || entry.variantStatus, lastError: entry.lastError || "", publicationDate: entry.publicationDate, timezone: entry.timezone || "UTC", updatedAt: entry.updatedAt || "" };
      const current = grouped.get(key) || { ...entry, itemKey: key, item: contentById.get(String(entry.itemId)) || null, channels: [] };
      current.channels = [...current.channels, channel];
      grouped.set(key, current);
    }
    return [...grouped.values()].map((entry) => {
      const channels = [...entry.channels].sort((a, b) => String(a.publicationDate).localeCompare(String(b.publicationDate)));
      const updatedAt = channels.map((channel) => channel.updatedAt).filter(Boolean).sort().at(-1) || entry.updatedAt;
      return { ...entry, channels, publicationDate: channels[0]?.publicationDate, updatedAt };
    }).sort((a, b) => String(a.publicationDate).localeCompare(String(b.publicationDate)));
  }, [contentById, validEntries]);
  const entryKey = (entry: GroupedCalendarEntry) => entry.itemKey;
  const listedEntries = groupedEntries;
  const calendarChannels = useMemo<string[]>(() => [...new Set(groupedEntries.flatMap((entry) => entry.channels.map((channel) => channel.channel)))].sort(), [groupedEntries]);
  const calendarStatuses = ["scheduled", "syncing", "published", "failed", "action_required"];
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return listedEntries.filter((entry) => {
      const title = String(entry.item ? itemTitle(entry.item) : entry.topic || "").toLocaleLowerCase();
      const campaign = String(entry.planTitle || "").toLocaleLowerCase();
      const queryMatches = !normalizedQuery || title.includes(normalizedQuery) || campaign.includes(normalizedQuery);
      const channelMatches = !channelFilters.length || entry.channels.some((channel) => channelFilters.includes(channel.channel));
      const statusMatches = !statusFilters.length || entry.channels.some((channel) => statusFilters.includes(channel.status));
      return queryMatches && channelMatches && statusMatches;
    });
  }, [channelFilters, listedEntries, query, statusFilters]);
  const hasCalendarFilters = Boolean(query.trim() || channelFilters.length || statusFilters.length);
  const clearCalendarFilters = () => { setQuery(""); setChannelFilters([]); setStatusFilters([]); };
  const entryItem = (entry: GroupedCalendarEntry) => entry.item;
  const topicLabel = (value: unknown) => {
    const clean = String(value || "Publicación").replace(/\s+/g, " ").trim();
    return clean.length > 118 ? `${clean.slice(0, 115).replace(/\s+\S*$/, "").trim()}…` : clean;
  };
  const entryTitle = (entry: GroupedCalendarEntry) => {
    const item = entryItem(entry);
    return item ? itemTitle(item) : topicLabel(entry.topic);
  };
  const entryVisual = (entry: GroupedCalendarEntry) => {
    const item = entryItem(entry);
    if (!item) return { url: "", kind: "image" as const };
    const variants = (item.variants || []).filter((variant) => entry.channels.some((channel) => channel.channel === variant.channel)).sort((left, right) => Number(right.channel === "video") - Number(left.channel === "video"));
    const values = variants.flatMap((variant) => {
      const body = variant.body || {};
      return [body.imageThumbUrl, body.imagePreviewUrl, body.imageUrl, body.image_url, body.coverUrl, ...(variant.media || [])].filter(Boolean).map((value) => ({ value, channel: variant.channel }));
    });
    const selected = values.map(({ value, channel }) => ({ url: calendarMediaUrl(value), kind: calendarMediaKind(value, calendarMediaUrl(value), channel) })).find((candidate) => candidate.url);
    return selected || { url: "", kind: "image" as const };
  };
  const entryOutputLabels = (entry: GroupedCalendarEntry): string[] => [...new Set<string>(entry.channels.map((channel) => {
    if (channel.channel === "video") return "Reel / vídeo";
    if (channel.channel === "blog") return "Artículo";
    if (channel.channel === "instagram_story") return "Story";
    const variant = entryItem(entry)?.variants?.find((candidate) => candidate.channel === channel.channel);
    const socialPack = variant?.body?.socialPack;
    return channel.channel === "instagram" && Array.isArray(socialPack?.instagramSlides) ? "Carrusel" : "Post";
  }))];
  const retryOne = async (entry: GroupedCalendarEntry, channel: CalendarChannel) => {
    const key = `${entry.itemId}:${channel.channel}`;
    setRetryingChannel(key);
    setError("");
    try {
      const scheduled = new Date(channel.publicationDate);
      const publicationDate = scheduled.getTime() > Date.now() + 60_000 ? scheduled : new Date(Date.now() + 2 * 60_000);
      await api.rescheduleContent(entry.itemId, publicationDate.toISOString(), channel.timezone || "UTC", site, [channel.channel]);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo reintentar el canal.");
    } finally {
      setRetryingChannel("");
    }
  };
  const moveToday = async (entry: GroupedCalendarEntry, channel: CalendarChannel) => {
    const key = `move:${entry.itemId}:${channel.channel}`;
    setRetryingChannel(key);
    setError("");
    try {
      await api.rescheduleContent(entry.itemId, new Date(Date.now() + 2 * 60_000).toISOString(), channel.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", site, [channel.channel]);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo adelantar el canal.");
    } finally {
      setRetryingChannel("");
    }
  };
  const markPublished = async (entry: GroupedCalendarEntry, channel: CalendarChannel) => {
    const key = `mark:${entry.itemId}:${channel.channel}`;
    setRetryingChannel(key);
    setError("");
    try {
      await api.markChannelPublished(entry.itemId, channel.channel, site);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo marcar el canal como publicado.");
    } finally {
      setRetryingChannel("");
    }
  };
  const retryChannels = (entry: GroupedCalendarEntry) => entry.channels.filter((channel) => ["failed", "action_required"].includes(channel.status)).map((channel) => channel.channel);
  const retryableEntries = groupedEntries.filter((entry) => retryChannels(entry).length > 0);
  const retryDateValue = () => {
    const next = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;
  };
  const openRetry = () => { setRetryDate(retryDate || retryDateValue()); setRetryOpen(true); };
  const toggleRetry = (key: string) => setRetrySelection((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  const reschedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!retryDate || !retrySelection.length) return;
    setRetryBusy(true);
    setError("");
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      for (const key of retrySelection) {
        const entry = retryableEntries.find((candidate) => entryKey(candidate) === key);
        if (!entry) continue;
        await api.rescheduleContent(entry.itemId, new Date(retryDate).toISOString(), timezone, site, retryChannels(entry));
      }
      setRetryOpen(false);
      setRetrySelection([]);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("calendar.retryError", "No se pudieron reagendar las publicaciones."));
    } finally {
      setRetryBusy(false);
    }
  };
  const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const monthDays = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = (new Date(year, month, 1).getDay() + 6) % 7;
    const total = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const number = index - first + 1;
      return { date: new Date(year, month, number), inMonth: number >= 1 && number <= total };
    });
  }, [cursor]);
  const monthLabel = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "es-ES", { month: "long", year: "numeric" }).format(cursor);
  const weekdays = language === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const formatDate = (value: string) => new Intl.DateTimeFormat(language === "en" ? "en-GB" : "es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const dateSpan = (entry: GroupedCalendarEntry) => {
    const dates = [...new Set<string>(entry.channels.map((channel) => channel.publicationDate))].sort();
    if (dates.length <= 1) return formatDate(dates[0] || entry.publicationDate);
    return `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`;
  };
  const openEntry = groupedEntries.find((entry) => entryKey(entry) === openId) || null;
  const dayEntries = openDay ? filteredEntries.filter((entry) => entry.channels.some((channel) => dayKey(new Date(channel.publicationDate)) === openDay)) : [];
  const dayLabel = openDay ? new Intl.DateTimeFormat(language === "en" ? "en-GB" : "es-ES", { dateStyle: "full" }).format(new Date(`${openDay}T12:00:00`)) : "Publicaciones del día";
  const calendarFilterToolbar = <Card className="ui-calendar-filter-panel"><div className="ui-calendar-filter-heading"><div><span className="ui-eyebrow">{t("calendar.filtersEyebrow", "VISTA MENSUAL")}</span><h2>{t("calendar.filtersTitle", "Filtrar publicaciones")}</h2></div><div className="ui-filter-summary"><span>{filteredEntries.length} {t("calendar.results", "publicaciones")}</span>{hasCalendarFilters && <Button size="sm" variant="ghost" onClick={clearCalendarFilters}>{t("calendar.clearFilters", "Limpiar filtros")}</Button>}</div></div><div className="ui-calendar-filter-grid"><Field label={t("calendar.searchLabel", "Buscar contenido o campaña")}><TextField value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("calendar.searchPlaceholder", "Título o campaña")} /></Field><Field label={t("calendar.channelFilter", "Canales")}><MultiSelectPills options={calendarChannels.map((channel) => ({ id: channel, label: channel === "video" ? "Reel / vídeo" : channel === "instagram_story" ? "Story" : channel.charAt(0).toUpperCase() + channel.slice(1) }))} value={channelFilters} onChange={setChannelFilters} ariaLabel={t("calendar.channelFilter", "Canales")} /></Field><Field label={t("calendar.statusFilter", "Estados")}><MultiSelectPills options={calendarStatuses.map((status) => ({ id: status, label: statusLabel(status) }))} value={statusFilters} onChange={setStatusFilters} ariaLabel={t("calendar.statusFilter", "Estados")} /></Field></div></Card>;
  return <main className="ui-page ui-calendar-page">
    <PageHeader eyebrow="Ejecución editorial" title="Calendario editorial" description="Campañas = qué contenido estamos preparando. Calendario = cuándo se publicará y qué está ocurriendo en cada canal. La conexión externa actualiza aquí su estado." actions={<Inline gap="sm">{retryableEntries.length > 0 && <Button variant="primary" disabled={!retrySelection.length || retryBusy} onClick={openRetry}>{t("calendar.retrySelected", "Reagendar seleccionadas")}{retrySelection.length ? ` (${retrySelection.length})` : ""}</Button>}</Inline>} />
    {error && <Card><Inline gap="md"><p className="ui-field-error">{error}</p><Button size="sm" variant="ghost" onClick={() => load()}>Reintentar</Button></Inline></Card>}
    {retryableEntries.length > 0 && <Card className="ui-calendar-retry-help"><strong>{t("calendar.retryTitle", "Publicaciones con error")}</strong><p>{t("calendar.retryHelp", "Selecciona solo los errores que quieras volver a programar. Las publicaciones programadas o publicadas no se incluyen.")}</p></Card>}
    {!loading && groupedEntries.length > 0 && calendarFilterToolbar}
    {loading ? <div className="ui-calendar-loading"><span className="ui-skeleton" style={{ height: 180 }} /><span className="ui-skeleton" style={{ height: 90 }} /></div> : !groupedEntries.length && !error ? <UiEmptyState title="Todavía no hay publicaciones programadas" description="Cuando apruebes y agendes una publicación desde Contenido, aparecerá aquí con su zona horaria y conexión." action={<NavLink className="ui-button ui-button-secondary" to="/content">Abrir contenido</NavLink>} /> : <Card className="ui-calendar-month"><div className="ui-calendar-month-head"><Button variant="ghost" size="sm" aria-label={t("calendar.previousMonth")} onClick={() => setCursor((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}>‹</Button><strong>{monthLabel}</strong><Button variant="ghost" size="sm" aria-label={t("calendar.nextMonth")} onClick={() => setCursor((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}>›</Button></div><div className="ui-calendar-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div><div className="ui-calendar-grid">{monthDays.map(({ date, inMonth }) => { const key = dayKey(date); const rows = filteredEntries.filter((entry) => entry.channels.some((channel: CalendarChannel) => dayKey(new Date(channel.publicationDate)) === key)); return <div className={`ui-calendar-day ${inMonth ? "" : "outside"} ${rows.length ? "has-items" : ""}`} key={key}><span>{date.getDate()}</span>{rows.slice(0, 3).map((entry) => { const channels = entry.channels.filter((channel: CalendarChannel) => dayKey(new Date(channel.publicationDate)) === key); const label = `${entryTitle(entry)} · ${channels.map((channel: CalendarChannel) => channel.channel).join(", ")} · ${formatDate(channels[0]?.publicationDate || entry.publicationDate)}`; const item = entryItem(entry); const retryable = retryChannels(entry).length > 0; return <div className="ui-calendar-item-row" key={entryKey(entry)}>{retryable && <Switch label="" aria-label={`${t("calendar.retrySelect", "Seleccionar para reagendar")}: ${entryTitle(entry)}`} checked={retrySelection.includes(entryKey(entry))} onChange={() => toggleRetry(entryKey(entry))} />}<Button type="button" variant="ghost" size="sm" className="ui-calendar-item" onClick={() => item ? navigate(contentPreviewPath(item)) : setOpenId(entryKey(entry))} aria-label={`Ver ${label}`} title={label}><Inline gap="sm">{channels.slice(0, 2).map((channel: CalendarChannel, index: number) => <ChannelBadge key={`${channel.channel}-${index}`} channel={channel.channel} />)}</Inline><small>{entryTitle(entry)}</small></Button></div>; })}{rows.length > 3 && <Button size="sm" variant="ghost" className="ui-calendar-more" onClick={() => setOpenDay(key)}>Ver {rows.length - 3} más</Button>}</div>; })}</div></Card>}
    <Drawer open={Boolean(openDay)} title={dayLabel} onClose={() => setOpenDay("")}>{dayEntries.length > 0 && <Stack gap="sm">{dayEntries.map((entry) => <Card key={entryKey(entry)}><div className="ui-card-head"><div><h3>{entryTitle(entry)}</h3><p className="ui-muted">{dateSpan(entry)}</p></div><Badge tone="neutral">{entryOutputLabels(entry).join(" · ")}</Badge></div><div className="ui-channel-list">{entry.channels.filter((channel: CalendarChannel) => dayKey(new Date(channel.publicationDate)) === openDay).map((channel: CalendarChannel, index: number) => <ChannelBadge key={`${channel.channel}-${index}`} channel={channel.channel} />)}</div><Button size="sm" variant="ghost" onClick={() => { setOpenDay(""); setOpenId(entryKey(entry)); }}>Ver canales</Button></Card>)}</Stack>}</Drawer>
    <Drawer open={Boolean(openEntry)} title={openEntry ? entryTitle(openEntry) : "Calendario"} onClose={() => setOpenId("")}>{openEntry && <Stack gap="md">{(() => { const visual = entryVisual(openEntry); return visual.url ? visual.kind === "video" ? <video className="ui-calendar-detail-visual" src={visual.url} controls muted preload="metadata" aria-label={entryTitle(openEntry)} /> : <img className="ui-calendar-detail-visual" src={visual.url} alt="" loading="lazy" decoding="async" /> : null; })()}<p className="ui-muted">{openEntry.planTitle || "Contenido"} · {dateSpan(openEntry)}</p><div className="ui-channel-list">{entryOutputLabels(openEntry).map((label) => <Badge key={label} tone="neutral">{label}</Badge>)}</div>{openEntry.channels.map((channel: CalendarChannel, index: number) => { const retryKey = `${openEntry.itemId}:${channel.channel}`; const canRetry = ["failed", "action_required"].includes(channel.status); const canMove = channel.status === "scheduled"; return <div className="ui-calendar-channel-row" key={`${channel.channel}-${index}`}><Inline gap="sm"><ChannelBadge channel={channel.channel} /><Badge tone="neutral">{channel.channel === "video" ? "Reel / vídeo" : channel.channel === "blog" ? "Artículo" : channel.channel === "instagram_story" ? "Story" : "Post"}</Badge>{channel.provider && <Badge tone="neutral">{channel.provider}</Badge>}<StatusBadge status={channel.status} label={statusLabel(channel.status)} /></Inline><p className="ui-muted">{channel.timezone} · {formatDate(channel.publicationDate)}</p>{channel.updatedAt && <small className="ui-calendar-sync">Actualizado {formatDate(channel.updatedAt)}</small>}{channel.lastError && <p className="ui-field-error">{channel.lastError}</p>}{canMove && <Button size="sm" variant="secondary" loading={retryingChannel === `move:${retryKey}`} onClick={() => void moveToday(openEntry, channel)}>Publicar hoy</Button>}{canRetry && <Inline gap="sm"><Button size="sm" variant="secondary" loading={retryingChannel === retryKey} onClick={() => void retryOne(openEntry, channel)}>Reintentar este canal</Button><Button size="sm" variant="ghost" loading={retryingChannel === `mark:${retryKey}`} onClick={() => void markPublished(openEntry, channel)}>Marcar como publicado</Button></Inline>}</div>; })}{entryItem(openEntry) && <NavLink className="ui-button ui-button-secondary" to={contentPreviewPath(entryItem(openEntry) as ContentItem)}>{t("calendar.openContent", "Ver contenido completo")}</NavLink>}<Button size="sm" variant="ghost" onClick={() => load(true)}>Actualizar estado</Button><p className="ui-field-hint">Publicar hoy adelanta solo ese canal a los próximos minutos y, si ya está en Buffer, mueve el mismo post. Reintentar vuelve a enviar un canal con error. Marcar como publicado cierra el error sin enviar nada.</p></Stack>}</Drawer>
    <Modal open={retryOpen} title={t("calendar.retryTitle", "Reagendar publicaciones con error")} onClose={() => setRetryOpen(false)}><form className="ui-stack ui-stack-md" onSubmit={reschedule}><Field label={t("calendar.retryDate", "Nueva fecha y hora")} hint={t("calendar.retryDateHelp", "Se usará tu zona horaria local.")} required><TextField type="datetime-local" value={retryDate} onChange={(event) => setRetryDate(event.target.value)} autoFocus required /></Field><p className="ui-field-hint">{t("calendar.retryCount", "Se reagendarán las publicaciones seleccionadas. Las ya programadas o publicadas no se modifican.")}</p><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setRetryOpen(false)}>{t("common.cancel", "Cancelar")}</Button><Button type="submit" loading={retryBusy}>{t("calendar.retryConfirm", "Reagendar")}</Button></Inline></form></Modal>
  </main>;
}
