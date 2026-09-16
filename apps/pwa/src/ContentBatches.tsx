import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { ContentItem } from "./types";

type Props = { site: string };

export function ContentBatches({ site }: Props) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [title, setTitle] = useState("");
  const [topics, setTopics] = useState("");
  const [channels, setChannels] = useState<string[]>(["blog", "instagram", "linkedin"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => api.contentBatches(site).then((result) => setItems(result.items || [])).catch((err) => setError(err.message));
  useEffect(() => { void load(); }, [site]);

  const batches = useMemo(() => {
    const grouped = new Map<string, ContentItem[]>();
    for (const item of items) {
      const key = item.batch_id || item.batchId || "unbatched";
      grouped.set(key, [...(grouped.get(key) || []), item]);
    }
    return [...grouped.entries()];
  }, [items]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTopics = topics.split(/\r?\n|,/).map((topic) => topic.trim()).filter(Boolean);
    if (!cleanTopics.length) { setError("Añade al menos un tema."); return; }
    setBusy(true); setError("");
    try {
      await api.createContentBatch({ site, title: title.trim() || `Batch ${new Date().toLocaleDateString()}`, topics: cleanTopics, channels });
      setTitle(""); setTopics(""); await load();
    } catch (err: any) { setError(err.message || "No se pudo crear el batch."); }
    finally { setBusy(false); }
  };

  const approve = async (itemId: string) => { setBusy(true); try { await api.approveContent(itemId, site); await load(); } catch (err: any) { setError(err.message); } finally { setBusy(false); } };
  const edit = async (item: ContentItem) => {
    const value = window.prompt("Tema", item.topic);
    if (!value || value.trim() === item.topic) return;
    setBusy(true); try { await api.updateContentItem(item.id, { site, topic: value.trim() }); await load(); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const reject = async (itemId: string) => {
    const comment = window.prompt("Motivo del rechazo (opcional)") || "";
    setBusy(true); try { await api.rejectContent(itemId, comment, site); await load(); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const schedule = async (itemId: string) => {
    const value = window.prompt("Fecha y hora ISO (ej. 2026-09-20T10:00:00+02:00)");
    if (!value) return;
    setBusy(true); try { await api.scheduleContent(itemId, value, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", site); await load(); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const cancel = async (itemId: string) => { setBusy(true); try { await api.cancelContent(itemId, site); await load(); } catch (err: any) { setError(err.message); } finally { setBusy(false); } };

  return <main className="page">
    <header className="page-head"><div><span className="eyebrow">Contenido multicanal</span><h1>Campañas y batches</h1><p className="muted">Genera muchos temas, revisa cada variante y agenda solo lo aprobado.</p></div></header>
    <section className="panel">
      <form onSubmit={create} className="stack">
        <label className="field"><span>Título de campaña</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Plan editorial de septiembre" /></label>
        <label className="field"><span>Temas (uno por línea)</span><textarea value={topics} onChange={(event) => setTopics(event.target.value)} rows={5} placeholder="Cómo elegir una paleta\nErrores de marca\nIdeas para LinkedIn" /></label>
        <fieldset className="field"><legend>Canales</legend><div className="choice-pills">{["blog", "instagram", "linkedin", "x", "video", "substack"].map((channel) => <label key={channel}><input type="checkbox" checked={channels.includes(channel)} onChange={(event) => setChannels((current) => event.target.checked ? [...current, channel] : current.filter((value) => value !== channel))} /> {channel}</label>)}</div></fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "Creando…" : "Crear batch"}</button>
      </form>
    </section>
    <section className="stack">{batches.map(([batchId, batchItems]) => <article className="panel" key={batchId}><div className="panel-head"><div><span className="eyebrow">Batch</span><h2>{batchId}</h2></div><span className="status-badge">{batchItems.length} temas</span></div><div className="stack">{batchItems.map((item) => <div className="content-item-row" key={item.id}><div><strong>{item.topic}</strong><span className="muted"> · {item.status}</span><div className="muted">{(item.variants || []).map((variant) => variant.channel).join(" · ")}</div></div><div className="form-actions"><button className="ghost" disabled={busy || ["published", "canceled"].includes(item.status)} onClick={() => void edit(item)}>Editar</button><button className="secondary" disabled={busy || item.status === "approved" || item.status === "scheduled" || item.status === "published" || item.status === "canceled"} onClick={() => void approve(item.id)}>Aprobar</button><button className="ghost" disabled={busy || !["generated", "needs_review", "approved"].includes(item.status)} onClick={() => void reject(item.id)}>Rechazar</button><button className="ghost" disabled={busy || item.status !== "approved"} onClick={() => void schedule(item.id)}>Agendar</button><button className="ghost" disabled={busy || ["published", "canceled"].includes(item.status)} onClick={() => void cancel(item.id)}>Cancelar</button></div></div>)}</div></article>)}</section>
    {!batches.length && <p className="empty-state">Todavía no hay batches para este sitio.</p>}
  </main>;
}
