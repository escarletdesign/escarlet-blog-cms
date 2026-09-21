import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import type { ContentChannel, ContentItem, ContentPlanSummary, ContentVariant } from "./types";
import { Badge, Button, BulkActionBar, Card, ChannelBadge, Checkbox, ContentPlanCard, EmptyState, Field, Inline, Modal, PageHeader, Progress, ReviewToolbar, Select, Stack, StatusBadge, Tabs, TextField, Textarea } from "./ui";

const ALL_CHANNELS: ContentChannel[] = ["blog", "instagram", "linkedin", "x", "video", "substack"];
const PREVIEW_CHANNELS: ContentChannel[] = ["blog", "instagram"];
const channelLabel = (channel: string) => channel === "x" ? "X" : channel.charAt(0).toUpperCase() + channel.slice(1);
type Props = { site: string; creationEnabled?: boolean; activeChannels?: Array<{ channel: string; enabled: boolean }> };
type Dialog = { type: "edit" | "reject" | "schedule"; item: ContentItem } | { type: "preview"; item: ContentItem } | null;

function bodyFor(variant: ContentVariant) {
  const body = variant.body || {};
  const socialPack = body.socialPack && typeof body.socialPack === "object" ? body.socialPack : {};
  return { body, socialPack };
}

function previewText(variant: ContentVariant) {
  const { body, socialPack } = bodyFor(variant);
  const value = variant.channel === "instagram"
    ? body.caption || body.text || socialPack.instagramCaption || socialPack.caption || body.body
    : body.body || body.bodyHtml || body.summary || body.excerpt || body.text;
  return String(value || "Sin contenido generado todavía.").replace(/<[^>]*>/g, "").trim();
}

function previewTitle(variant: ContentVariant, fallback: string) {
  const { body } = bodyFor(variant);
  return String(body.title || body.headline || fallback);
}

function displayableUrl(value: unknown) {
  const url = String(value || "").trim();
  if (!url || url.startsWith("data:")) return "";
  if (url.startsWith("/") || /^https?:\/\//i.test(url)) return url;
  return "";
}

function previewImages(variant: ContentVariant) {
  const { body, socialPack } = bodyFor(variant);
  const slides = Array.isArray(socialPack.instagramSlides) ? socialPack.instagramSlides : [];
  const candidates = [body.imageUrl, body.image_url, body.coverUrl, socialPack.imageUrl, ...slides.map((slide: any) => slide?.imageUrl || slide?.image_url), ...(variant.media || []).map((asset) => asset.url || asset.path)];
  return [...new Set(candidates.map(displayableUrl).filter(Boolean))];
}

function previewSlides(variant: ContentVariant) {
  const { socialPack } = bodyFor(variant);
  return Array.isArray(socialPack.instagramSlides) ? socialPack.instagramSlides : [];
}

export function ContentBatches({ site, creationEnabled = false, activeChannels }: Props) {
  const [plans, setPlans] = useState<ContentPlanSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterChannel, setFilterChannel] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [previewChannel, setPreviewChannel] = useState<ContentChannel>("blog");
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [modalValue, setModalValue] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [topics, setTopics] = useState("");
  const [searchParams] = useSearchParams();
  const requestedPlanId = searchParams.get("plan") || "";
  const channels = (activeChannels?.filter((channel) => channel.enabled).map((channel) => channel.channel).filter((channel): channel is ContentChannel => ALL_CHANNELS.includes(channel as ContentChannel)) || ALL_CHANNELS).slice(0, 6);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
  const previewItem = dialog?.type === "preview" ? dialog.item : null;
  const previewVariants = (previewItem?.variants || []).filter((variant) => PREVIEW_CHANNELS.includes(variant.channel));
  const currentPreviewVariant = previewVariants.find((variant) => variant.channel === previewChannel) || previewVariants[0];

  const loadPlans = async () => { setLoading(true); setError(""); setSetupRequired(false); try { const response = await api.contentPlans(site); const next = (response.plans || []) as ContentPlanSummary[]; setPlans(next); setSelectedPlanId((current) => requestedPlanId && next.some((plan) => plan.id === requestedPlanId) ? requestedPlanId : current && next.some((plan) => plan.id === current) ? current : next[0]?.id || ""); } catch (err: any) { if (err?.status === 404 || /workspace|sitio|marca/i.test(err?.message || "")) setSetupRequired(true); else setError(err?.message || "No se pudieron cargar los planes."); } finally { setLoading(false); } };
  const loadItems = async (planId: string) => { if (!planId) { setItems([]); return; } setDetailLoading(true); setSelected([]); try { const response = await api.contentBatch(planId, site); setItems((response.items || []) as ContentItem[]); } catch (err: any) { setError(err?.message || "No se pudo cargar el plan."); setItems([]); } finally { setDetailLoading(false); } };
  useEffect(() => { void loadPlans(); }, [site]);
  useEffect(() => { void loadItems(selectedPlanId); }, [selectedPlanId, site]);
  const visibleItems = useMemo(() => items.filter((item) => (filterStatus === "all" || item.status === filterStatus) && (filterChannel === "all" || (item.variants || []).some((variant) => variant.channel === filterChannel))), [items, filterStatus, filterChannel]);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); let failure = ""; try { await action(); } catch (err: any) { failure = err?.message || "No se pudo completar la operación."; } finally { await loadPlans().catch(() => undefined); await loadItems(selectedPlanId).catch(() => undefined); if (failure) setError(failure); setBusy(false); } };
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAll = () => setSelected((current) => current.length === visibleItems.length ? [] : visibleItems.map((item) => item.id));
  const create = async (event: FormEvent) => { event.preventDefault(); const cleanTopics = topics.split(/\r?\n|,/).map((topic) => topic.trim()).filter(Boolean); if (!cleanTopics.length) { setError("Añade al menos un tema."); return; } await run(async () => { await api.createContentBatch({ site, title: title.trim() || `Plan de contenidos ${new Date().toLocaleDateString()}`, topics: cleanTopics, channels }); setTitle(""); setTopics(""); setCreateOpen(false); }); };
  const bulkApprove = () => run(async () => { const results = await Promise.allSettled(selected.map((id) => api.approveContent(id, site))); const failed = results.filter((result) => result.status === "rejected").length; if (failed) throw new Error(`${failed} publicaciones no pudieron aprobarse; el resto se actualizó.`); });
  const bulkReject = (reason: string) => run(async () => { const results = await Promise.allSettled(selected.map((id) => api.rejectContent(id, reason, site))); const failed = results.filter((result) => result.status === "rejected").length; if (failed) throw new Error(`${failed} publicaciones no pudieron rechazarse; el resto se actualizó.`); });
  const approve = (id: string) => run(() => api.approveContent(id, site));
  const cancel = (id: string) => run(() => api.cancelContent(id, site));
  const update = (id: string, topic: string) => run(() => api.updateContentItem(id, { site, topic }));
  const reject = (id: string, comment: string) => run(() => api.rejectContent(id, comment, site));
  const schedule = (id: string, value: string) => run(() => api.scheduleContent(id, value, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", site));
  const publishBuffer = (item: ContentItem, channel: ContentChannel) => run(async () => { await api.publishContentViaBuffer(item.id, [channel], site); setDialog(null); });
  const openPreview = (item: ContentItem) => { const first = (item.variants || []).find((variant) => PREVIEW_CHANNELS.includes(variant.channel)); setPreviewChannel(first?.channel || "blog"); setDialog({ type: "preview", item }); };

  return <main className="ui-page ui-plans-page">
    <PageHeader eyebrow="Planificación y revisión" title="Planes de contenido" description="Organiza cada plan, revisa sus publicaciones y envíalas al calendario desde la misma pantalla." actions={creationEnabled ? <Button onClick={() => setCreateOpen(true)}>Nuevo plan</Button> : undefined} />
    {error && <Card className="ui-alert-card"><p className="ui-field-error" role="alert">{error}</p><Button variant="ghost" size="sm" onClick={() => void loadPlans()}>Reintentar</Button></Card>}
    {!loading && setupRequired && <EmptyState title="Configura tu marca para comenzar" description="Un administrador debe inicializar el espacio y asignarte una marca antes de mostrar publicaciones." />}
    {!loading && !setupRequired && !plans.length && !error && <EmptyState title="Todavía no hay planes de contenido" description="Crea un plan aquí o desde ChatGPT. Cuando esté listo, podrás revisar y agendar sus publicaciones sin salir de esta pantalla." />}
    {loading ? <Stack gap="md"><Card><Progress value={35} /><p className="ui-muted">Cargando planes…</p></Card></Stack> : plans.length > 0 && <div className="ui-plans-layout"><Stack gap="md" className="ui-plan-list">{plans.map((plan) => <ContentPlanCard key={plan.id} title={plan.title} total={plan.totalItems ?? (plan as any).item_count ?? 0} generated={plan.generatedItems ?? (plan as any).ready_count ?? 0} failed={plan.failedItems ?? (plan as any).error_count ?? 0} status={plan.status} channels={plan.channels} onClick={() => setSelectedPlanId(plan.id)} />)}</Stack><section className="ui-plan-detail"><Card><div className="ui-card-head"><div><span className="ui-eyebrow">Contenido y revisión</span><h2>{selectedPlan?.title || "Selecciona un plan"}</h2></div>{selectedPlan && <StatusBadge status={selectedPlan.status} />}</div>{selectedPlan && <><div className="ui-plan-overview"><div><strong>{selectedPlan.totalItems ?? 0}</strong><span>publicaciones</span></div><div><strong>{selectedPlan.generatedItems ?? 0}</strong><span>listas para revisar</span></div><div><strong>{selectedPlan.failedItems ?? 0}</strong><span>con error</span></div></div><ReviewToolbar><Field label="Estado"><Select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}><option value="all">Todos los estados</option>{["draft", "generated", "needs_review", "approved", "scheduled", "failed"].map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}</Select></Field><Field label="Canal"><Select value={filterChannel} onChange={(event) => setFilterChannel(event.target.value)}><option value="all">Todos los canales</option>{channels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}</Select></Field><div className="ui-filter-summary"><span>{visibleItems.length} publicaciones</span><span>{selected.length} seleccionadas</span></div><Checkbox label="Seleccionar todas" checked={Boolean(visibleItems.length && selected.length === visibleItems.length)} onChange={toggleAll} /></ReviewToolbar></>}{detailLoading ? <p className="ui-muted">Cargando publicaciones…</p> : visibleItems.length ? <Stack gap="sm">{visibleItems.map((item) => <Card className="ui-review-item" key={item.id}><div className="ui-card-head"><div className="ui-review-item-title"><Checkbox label="" aria-label={`Seleccionar ${item.topic}`} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /><div><h3>{item.topic}</h3><Inline gap="sm">{(item.variants || []).map((variant) => <ChannelBadge key={variant.id} channel={variant.channel} />)}</Inline></div></div><StatusBadge status={item.status} /></div>{item.error && <p className="ui-field-error">{item.error}</p>}<div className="ui-card-actions"><Button variant="secondary" size="sm" disabled={busy || !(item.variants || []).length} onClick={() => openPreview(item)}>Vista previa</Button><Button variant="ghost" size="sm" disabled={busy || ["published", "canceled"].includes(item.status)} onClick={() => { setDialog({ type: "edit", item }); setModalValue(item.topic); }}>Editar</Button><Button variant="secondary" size="sm" disabled={busy || ["approved", "scheduled", "published", "canceled"].includes(item.status)} onClick={() => void approve(item.id)}>Aprobar</Button><Button variant="ghost" size="sm" disabled={busy || !["generated", "needs_review", "approved"].includes(item.status)} onClick={() => { setDialog({ type: "reject", item }); setModalValue(""); }}>Rechazar</Button><Button variant="ghost" size="sm" disabled={busy || item.status !== "approved"} onClick={() => { setDialog({ type: "schedule", item }); setModalValue(""); }}>Agendar</Button><Button variant="ghost" size="sm" disabled={busy || ["published", "canceled"].includes(item.status)} onClick={() => void cancel(item.id)}>Cancelar</Button></div></Card>)}</Stack> : <EmptyState title="No hay publicaciones con estos filtros" description="Prueba otro estado o canal." />}<BulkActionBar selected={selected.length}><Inline gap="sm"><Button size="sm" onClick={() => void bulkApprove()} disabled={busy}>Aprobar</Button><Button size="sm" variant="danger" onClick={() => { setModalValue(""); setBulkRejectOpen(true); }} disabled={busy}>Rechazar</Button></Inline></BulkActionBar></Card></section></div>}
    <Modal open={dialog?.type === "preview"} title={`Vista previa: ${previewItem?.topic || "Publicación"}`} onClose={() => setDialog(null)}>
      {previewItem && previewVariants.length ? <Stack gap="md"><Tabs items={previewVariants.map((variant) => ({ id: variant.channel, label: channelLabel(variant.channel) }))} value={currentPreviewVariant?.channel || previewVariants[0].channel} onChange={(channel) => setPreviewChannel(channel)} ariaLabel="Canales de la vista previa" />{currentPreviewVariant && <div className="ui-preview-panel" id={`tabpanel-${encodeURIComponent(currentPreviewVariant.channel)}`} role="tabpanel"><div className="ui-preview-heading"><div><ChannelBadge channel={currentPreviewVariant.channel} /><h3>{previewTitle(currentPreviewVariant, previewItem.topic)}</h3></div><StatusBadge status={currentPreviewVariant.status} /></div>{previewImages(currentPreviewVariant).length > 0 && <div className="ui-preview-images">{previewImages(currentPreviewVariant).map((url) => <img key={url} src={url} alt="Vista previa del contenido" loading="lazy" />)}</div>}<p className="ui-preview-copy">{previewText(currentPreviewVariant)}</p>{previewSlides(currentPreviewVariant).length > 0 && <div className="ui-preview-slides">{previewSlides(currentPreviewVariant).map((slide: any, index: number) => <Card key={`${slide?.headline || "slide"}-${index}`}><span className="ui-eyebrow">Slide {index + 1}</span><h4>{String(slide?.headline || "")}</h4><p>{String(slide?.body || "")}</p></Card>)}</div>}<Inline gap="md"><Button variant="ghost" onClick={() => setDialog(null)}>Cerrar</Button><Button variant="primary" disabled={busy || previewItem.status !== "approved" || !["blog", "instagram"].includes(currentPreviewVariant.channel)} loading={busy} onClick={() => void publishBuffer(previewItem, currentPreviewVariant.channel)}>Publicar en Buffer</Button></Inline>{previewItem.status !== "approved" && <p className="ui-field-hint">Aprueba la publicación antes de enviarla a Buffer.</p>}</div>}</Stack> : <EmptyState title="No hay variantes para previsualizar" description="El contenido todavía no tiene una variante de blog o Instagram." />}
    </Modal>
    <Modal open={dialog?.type === "edit" || dialog?.type === "reject" || dialog?.type === "schedule"} title={dialog?.type === "edit" ? "Editar publicación" : dialog?.type === "reject" ? "Rechazar publicación" : "Agendar publicación"} onClose={() => setDialog(null)}>{dialog?.type === "edit" && <form className="ui-stack ui-stack-md" onSubmit={(event) => { event.preventDefault(); if (modalValue.trim()) void update(dialog.item.id, modalValue.trim()).then(() => setDialog(null)); }}><Field label="Tema" hint="Puedes editar textos largos sin perder contexto." required><Textarea value={modalValue} onChange={(event) => setModalValue(event.target.value)} rows={6} autoFocus required /></Field><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" loading={busy}>Guardar</Button></Inline></form>}{dialog?.type === "reject" && <form className="ui-stack ui-stack-md" onSubmit={(event) => { event.preventDefault(); void reject(dialog.item.id, modalValue).then(() => setDialog(null)); }}><Field label="Motivo" hint="Opcional"><Textarea value={modalValue} onChange={(event) => setModalValue(event.target.value)} autoFocus placeholder="Qué debería cambiar…" /></Field><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" variant="danger" loading={busy}>Rechazar</Button></Inline></form>}{dialog?.type === "schedule" && <form className="ui-stack ui-stack-md" onSubmit={(event) => { event.preventDefault(); if (modalValue) void schedule(dialog.item.id, new Date(modalValue).toISOString()).then(() => setDialog(null)); }}><Field label="Fecha y hora" hint="Se usará tu zona horaria local." required><TextField type="datetime-local" value={modalValue} onChange={(event) => setModalValue(event.target.value)} autoFocus required /></Field><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" loading={busy}>Agendar</Button></Inline></form>}</Modal>
    <Modal open={bulkRejectOpen} title={`Rechazar ${selected.length} publicaciones`} onClose={() => setBulkRejectOpen(false)}><form className="ui-stack ui-stack-md" onSubmit={(event) => { event.preventDefault(); void bulkReject(modalValue).then(() => setBulkRejectOpen(false)); }}><Field label="Motivo" hint="Opcional"><Textarea value={modalValue} onChange={(event) => setModalValue(event.target.value)} autoFocus placeholder="Qué debería cambiar…" /></Field><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setBulkRejectOpen(false)}>Cancelar</Button><Button type="submit" variant="danger" loading={busy}>Rechazar</Button></Inline></form></Modal>
    <Modal open={createOpen} title="Nuevo plan de contenidos" onClose={() => setCreateOpen(false)}><form className="ui-stack ui-stack-md" onSubmit={(event) => void create(event)}><Field label="Título del plan"><TextField value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Plan editorial de septiembre" /></Field><Field label="Temas" hint="Un tema por línea o separados por coma. Un plan puede tener una o varias publicaciones." required><Textarea value={topics} onChange={(event) => setTopics(event.target.value)} rows={7} required placeholder="Ideas para LinkedIn\nErrores frecuentes de marca" /></Field><fieldset className="ui-field"><legend className="ui-field-label">Canales activos</legend><Inline gap="md">{channels.map((channel) => <Badge key={channel} tone="info">{channelLabel(channel)}</Badge>)}</Inline><small className="ui-field-hint">Los canales se configuran en la marca.</small></fieldset><Inline gap="md"><Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button type="submit" loading={busy}>Crear plan</Button></Inline></form></Modal>
  </main>;
}
