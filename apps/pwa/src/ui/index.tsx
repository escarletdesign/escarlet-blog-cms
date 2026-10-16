import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode, RefObject, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "review" | "published";

export function Button({ variant = "primary", size = "md", loading = false, children, disabled, className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean }) {
  return <button type={type} className={`ui-button ui-button-${variant} ui-button-${size} ${className}`.trim()} disabled={disabled || loading} {...props}>{loading && <span className="ui-spinner" aria-hidden="true" />}{children}</button>;
}

export function IconButton({ label, title, children, className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type={type} className={`ui-icon-button ${className}`.trim()} aria-label={label} title={title || label} {...props}>{children}</button>;
}

const TELEPROMPTER_CONTROLS_POSITION = "escarlet_teleprompter_controls_position";

export function TeleprompterLineControls({ onPrevious, onNext, previousDisabled, nextDisabled }: { onPrevious: () => void; onNext: () => void; previousDisabled?: boolean; nextDisabled?: boolean }) {
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const positionRef = useRef({ x: 12, y: 12 });
  const [position, setPosition] = useState(() => {
    if (typeof window === "undefined") return positionRef.current;
    try {
      const saved = JSON.parse(window.localStorage.getItem(TELEPROMPTER_CONTROLS_POSITION) || "null");
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return { x: saved.x, y: saved.y };
    } catch { /* Ignore an invalid local preference. */ }
    return { x: Math.max(12, window.innerWidth - 76), y: Math.max(12, Math.round(window.innerHeight / 2) - 80) };
  });
  positionRef.current = position;
  const save = (next: { x: number; y: number }) => {
    try { window.localStorage.setItem(TELEPROMPTER_CONTROLS_POSITION, JSON.stringify(next)); } catch { /* Local preferences are optional. */ }
  };
  const clamp = (x: number, y: number) => {
    const rect = controlsRef.current?.getBoundingClientRect();
    const width = rect?.width || 64;
    const height = rect?.height || 168;
    return {
      x: Math.max(12, Math.min(x, window.innerWidth - width - 12)),
      y: Math.max(12, Math.min(y, window.innerHeight - height - 12)),
    };
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clamp(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    positionRef.current = next;
    setPosition(next);
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    save(positionRef.current);
  };
  const nudge = (x: number, y: number) => {
    const next = clamp(positionRef.current.x + x, positionRef.current.y + y);
    positionRef.current = next;
    setPosition(next);
    save(next);
  };
  useEffect(() => {
    const keepVisible = () => {
      const next = clamp(positionRef.current.x, positionRef.current.y);
      positionRef.current = next;
      setPosition(next);
      save(next);
    };
    keepVisible();
    window.addEventListener("resize", keepVisible);
    return () => window.removeEventListener("resize", keepVisible);
  }, []);
  return <div ref={controlsRef} className="teleprompter-line-controls" role="group" aria-label="Cambiar de línea" style={{ left: position.x, top: position.y }}>
    <button className="teleprompter-drag-handle" type="button" aria-label="Mover controles de línea" onPointerDown={(event) => { const rect = controlsRef.current?.getBoundingClientRect(); dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - (rect?.left || 0), offsetY: event.clientY - (rect?.top || 0) }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onKeyDown={(event) => { const distance = event.shiftKey ? 30 : 10; if (event.key === "ArrowLeft") { event.preventDefault(); nudge(-distance, 0); } if (event.key === "ArrowRight") { event.preventDefault(); nudge(distance, 0); } if (event.key === "ArrowUp") { event.preventDefault(); nudge(0, -distance); } if (event.key === "ArrowDown") { event.preventDefault(); nudge(0, distance); } }}>⠿</button>
    <IconButton className="teleprompter-line-button" label="Línea anterior" onClick={onPrevious} disabled={previousDisabled}>↑</IconButton>
    <IconButton className="teleprompter-line-button" label="Línea siguiente" onClick={onNext} disabled={nextDisabled}>↓</IconButton>
  </div>;
}

export function Field({ label, hint, error, children, required = false }: { label?: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return <label className="ui-field">{label && <span className="ui-field-label">{label}{required && <span aria-hidden="true"> *</span>}</span>}{children}{hint && !error && <span className="ui-field-hint">{hint}</span>}{error && <span className="ui-field-error" role="alert">{error}</span>}</label>;
}

export function FileDropzone({ accept = "image/jpeg,image/png,image/webp,image/gif", multiple = true, disabled = false, label, hint, className = "", onFiles }: { accept?: string; multiple?: boolean; disabled?: boolean; label: string; hint?: string; className?: string; onFiles: (files: File[]) => void | Promise<void> }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const handleFiles = (files: FileList | File[]) => {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length) void onFiles(multiple ? images : images.slice(0, 1));
  };
  return <div className={`ui-file-dropzone${dragging ? " is-dragging" : ""} ${className}`.trim()} onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled) handleFiles(event.dataTransfer.files); }} aria-disabled={disabled || undefined}>
    <input ref={inputRef} type="file" accept={accept} multiple={multiple} hidden disabled={disabled} onChange={(event) => { handleFiles(event.currentTarget.files || []); event.currentTarget.value = ""; }} />
    <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>{label}</Button>
    {hint && <span className="ui-field-hint">{hint}</span>}
  </div>;
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextField({ className = "", ...props }, ref) { return <input ref={ref} className={`ui-input ${className}`.trim()} {...props} />; });
export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={`ui-input ui-textarea ${className}`.trim()} {...props} />; }
export function Select({ children, className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select className={`ui-input ui-select ${className}`.trim()} {...props}>{children}</select>; }
export function Checkbox({ label, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) { return <label className="ui-checkbox"><input type="checkbox" className={className} {...props} /><span>{label}</span></label>; }
export function Switch({ label, description, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; description?: ReactNode }) { return <label className={`ui-switch ${className}`.trim()}><span className="ui-switch-copy">{label && <span>{label}</span>}{description && <small>{description}</small>}</span><input type="checkbox" role="switch" {...props} /><span className="ui-switch-track" aria-hidden="true"><span className="ui-switch-thumb" /></span></label>; }

const CONTENT_BLOCK_TAGS = /<\/(?:p|h[1-6]|li|blockquote|ul|ol)>/gi;
const CONTENT_HTML_TAGS = /<[^>]*>/g;
const CONTENT_SAFE_TAGS = new Set(["P", "BR", "STRONG", "EM", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "A", "IMG"]);

export function contentHtmlToPlainText(value: string) {
  const source = String(value || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(CONTENT_BLOCK_TAGS, "\n").replace(CONTENT_HTML_TAGS, "");
  if (typeof DOMParser === "undefined") return source.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\n{3,}/g, "\n\n").trim();
  const doc = new DOMParser().parseFromString(`<div>${source}</div>`, "text/html");
  return (doc.body.textContent || "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function contentPlainTextToHtml(value: string) {
  const source = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "";
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  return source.split(/\n{2,}/).map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, "<br />")}</p>`).join("");
}

function safeContentUrl(value: string, image = false) {
  return image ? /^(?:https?:|\/|data:image\/)/i.test(value) : /^(?:https?:|mailto:|\/|#)/i.test(value);
}

export function sanitizeContentHtml(value: string) {
  if (typeof DOMParser === "undefined") return contentPlainTextToHtml(value);
  const doc = new DOMParser().parseFromString(String(value || ""), "text/html");
  doc.body.querySelectorAll("*").forEach((element) => {
    if (!CONTENT_SAFE_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    Array.from(element.attributes).forEach((attribute) => {
      const allowed = element.tagName === "A" && attribute.name === "href"
        ? safeContentUrl(attribute.value)
        : element.tagName === "IMG" && ["src", "alt"].includes(attribute.name)
          ? attribute.name === "alt" || safeContentUrl(attribute.value, true)
          : false;
      if (!allowed) element.removeAttribute(attribute.name);
    });
  });
  return doc.body.innerHTML;
}

export type ContentEditorMode = "preview" | "plain" | "html";
export type ContentEditorLabels = { preview: string; plain: string; html: string; tabs: string; empty: string };

export function ContentEditor({ value, onChange, labels = { preview: "Vista previa", plain: "Texto plano", html: "HTML", tabs: "Formato del contenido", empty: "Sin contenido todavía." }, placeholder, rows = 16, disabled = false, className = "" }: { value: string; onChange: (value: string) => void; labels?: ContentEditorLabels; placeholder?: string; rows?: number; disabled?: boolean; className?: string }) {
  const editorId = useId().replace(/:/g, "");
  const [mode, setMode] = useState<ContentEditorMode>(() => /<[a-z][^>]*>/i.test(value) ? "preview" : "plain");
  const items = [{ id: "preview" as const, label: labels.preview }, { id: "plain" as const, label: labels.plain }, { id: "html" as const, label: labels.html }];
  const hasContent = contentHtmlToPlainText(value).length > 0;
  const previewHtml = /<[a-z][^>]*>/i.test(value) ? sanitizeContentHtml(value) : contentPlainTextToHtml(value);
  const tabId = `content-editor-tabs-${editorId}`;
  const panelId = `content-editor-panel-${editorId}`;
  return <div className={`ui-content-editor ${className}`.trim()}>
    <Tabs items={items} value={mode} onChange={setMode} idPrefix={tabId} panelIdPrefix={panelId} ariaLabel={labels.tabs} />
    <div id={`${panelId}-${mode}`} role="tabpanel" aria-labelledby={`${tabId}-${mode}`} className="ui-content-editor-panel">
      {mode === "preview" ? <article className="ui-content-editor-preview">{hasContent ? <div dangerouslySetInnerHTML={{ __html: previewHtml }} /> : <p className="ui-muted">{labels.empty}</p>}</article> : <Textarea className={mode === "html" ? "ui-content-editor-source" : "ui-content-editor-plain"} value={mode === "html" ? value : contentHtmlToPlainText(value)} onChange={(event) => onChange(mode === "html" ? event.target.value : contentPlainTextToHtml(event.target.value))} placeholder={placeholder} rows={rows} disabled={disabled} />}
    </div>
  </div>;
}

export function MultiSelectPills({ options, value, onChange, ariaLabel }: { options: Array<{ id: string; label: string }>; value: string[]; onChange: (value: string[]) => void; ariaLabel: string }) {
  return <div className="ui-multi-select-pills" role="group" aria-label={ariaLabel}>{options.map((option) => { const selected = value.includes(option.id); return <button key={option.id} type="button" className={`ui-multi-select-pill${selected ? " active" : ""}`} aria-pressed={selected} onClick={() => onChange(selected ? value.filter((id) => id !== option.id) : [...value, option.id])}>{option.label}</button>; })}</div>;
}

export function Card({ children, className = "", ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) { return <section className={`ui-card ${className}`.trim()} {...props}>{children}</section>; }
export function Stack({ children, gap = "md", className = "" }: { children: ReactNode; gap?: "sm" | "md" | "lg"; className?: string }) { return <div className={`ui-stack ui-stack-${gap} ${className}`}>{children}</div>; }
export function Inline({ children, gap = "sm", className = "" }: { children: ReactNode; gap?: "sm" | "md" | "lg"; className?: string }) { return <div className={`ui-inline ui-inline-${gap} ${className}`}>{children}</div>; }
export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: Tone; title?: string }) { const tooltip = title || (typeof children === "string" || typeof children === "number" ? String(children) : undefined); return <span className={`ui-badge ui-badge-${tone}`} title={tooltip}><span className="ui-badge-label">{children}</span></span>; }
export function StatusBadge({ status, label }: { status?: string; label?: ReactNode }) { const tone: Tone = status === "published" ? "published" : status === "connected" || status === "approved" || status === "scheduled" ? "success" : status === "failed" || status === "canceled" || status === "disabled" ? "danger" : status === "needs_review" || status === "action_required" ? "review" : status === "syncing" ? "info" : "neutral"; return <Badge tone={tone}>{label || String(status || "draft").replace(/_/g, " ")}</Badge>; }
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="ui-empty"><div className="ui-empty-icon">✦</div><h2>{title}</h2>{description && <p>{description}</p>}{action}</div>; }
export function Skeleton({ width = "100%", height = "1rem" }: { width?: string; height?: string }) { return <span className="ui-skeleton" style={{ width, height }} aria-hidden="true" />; }
export function Progress({ value, max = 100 }: { value: number; max?: number }) { const safe = Math.max(0, Math.min(max, value)); return <div className="ui-progress" role="progressbar" aria-valuenow={safe} aria-valuemin={0} aria-valuemax={max}><span style={{ width: `${max ? safe / max * 100 : 0}%` }} /></div>; }
export function PageHeader({ eyebrow, title, description, actions, back }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode; back?: ReactNode }) { return <header className="ui-page-header"><div className="ui-page-heading">{back && <div className="ui-page-back">{back}</div>}{eyebrow && <span className="ui-eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="ui-page-actions">{actions}</div>}</header>; }
export function ChannelBadge({ channel }: { channel: string }) { const labels: Record<string, string> = { blog: "Blog", instagram: "Instagram", instagram_story: "Instagram Story", linkedin: "LinkedIn", x: "X", video: "Vídeo", substack: "Substack" }; const label = labels[channel] || channel; return <span className={`ui-badge ui-channel-badge ui-channel-${channel}`} title={label}><span className="ui-badge-label">{label}</span></span>; }
export function ContentPlanCard({ title, total, generated, failed, status, channels, onClick }: { title: string; total: number; generated?: number; failed?: number; status?: string; channels?: string[]; onClick?: () => void }) { const content = <><div className="ui-card-head"><div><span className="ui-eyebrow">Campaña</span><h2>{title}</h2></div><StatusBadge status={status} /></div><Progress value={generated || 0} max={total || 1} /><div className="ui-card-meta"><span>{generated || 0}/{total} {total === 1 ? "publicación generada" : "publicaciones generadas"}</span>{failed ? <span className="ui-danger-text">{failed} con error</span> : null}</div>{channels?.length ? <div className="ui-channel-list">{channels.map((channel) => <ChannelBadge key={channel} channel={channel} />)}</div> : null}</>; return onClick ? <button type="button" className="ui-card ui-plan-card" onClick={onClick}>{content}</button> : <Card className="ui-plan-card">{content}</Card>; }
export function PublicationCard({ topic, status, channels, error, actions }: { topic: string; status?: string; channels?: string[]; error?: string | null; actions?: ReactNode }) { return <Card className="ui-publication-card"><div className="ui-card-head"><div><h3>{topic}</h3>{channels?.length ? <div className="ui-channel-list">{channels.map((channel) => <ChannelBadge key={channel} channel={channel} />)}</div> : null}</div><StatusBadge status={status} /></div>{error && <p className="ui-field-error">{error}</p>}{actions && <div className="ui-card-actions">{actions}</div>}</Card>; }
export function useDialogFocus(open: boolean, containerRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const focusable = () => Array.from(container?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || []).filter((element) => !element.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [open, containerRef]);
}
export function Modal({ open, title, onClose, children, closeLabel = "Cerrar", className = "" }: { open: boolean; title: string; onClose: () => void; children: ReactNode; closeLabel?: string; className?: string }) {
  const titleId = `ui-modal-title-${useId().replace(/:/g, "")}`;
  const modalRef = useRef<HTMLElement | null>(null);
  useDialogFocus(open, modalRef, onClose);
  if (!open) return null;
  return <div className="ui-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={modalRef} className={`ui-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="ui-modal-head"><h2 id={titleId}>{title}</h2><IconButton label={closeLabel} onClick={onClose}>×</IconButton></div>{children}</section></div>;
}
export function ReviewToolbar({ children }: { children: ReactNode }) { return <div className="ui-review-toolbar">{children}</div>; }
export function ConnectionCard({ provider, status, account, actions }: { provider: string; status?: string; account?: string; actions?: ReactNode }) { return <Card className="ui-connection-card"><div className="ui-card-head"><div><span className="ui-eyebrow">Conexión</span><h3>{provider}</h3>{account && <p>{account}</p>}</div><StatusBadge status={status || "draft"} label={status === "connected" ? "Conectada" : status || "Sin conectar"} /></div>{actions && <div className="ui-card-actions">{actions}</div>}</Card>; }
export function Tabs<T extends string>({ items, value, onChange, className = "", idPrefix, panelIdPrefix = "tabpanel", ariaLabel = "Secciones" }: { items: Array<{ id: T; label: string }>; value: T; onChange: (id: T) => void; className?: string; idPrefix?: string; panelIdPrefix?: string; ariaLabel?: string }) {
  const generatedId = useId().replace(/:/g, "");
  const tablistId = idPrefix || `ui-tabs-${generatedId}`;
  const focusTab = (index: number) => {
    const item = items[(index + items.length) % items.length];
    if (!item) return;
    onChange(item.id);
    document.getElementById(`${tablistId}-${encodeURIComponent(item.id)}`)?.focus();
  };
  return <div className={`ui-tabs ${className}`.trim()} id={tablistId} role="tablist" aria-label={ariaLabel}>
    {items.map((item, index) => <button key={item.id} id={`${tablistId}-${encodeURIComponent(item.id)}`} type="button" role="tab" aria-selected={value === item.id} aria-controls={`${panelIdPrefix}-${encodeURIComponent(item.id)}`} tabIndex={value === item.id ? 0 : -1} className={value === item.id ? "active" : ""} onClick={() => onChange(item.id)} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); focusTab(index + 1); } if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); focusTab(index - 1); } if (event.key === "Home") { event.preventDefault(); focusTab(0); } if (event.key === "End") { event.preventDefault(); focusTab(items.length - 1); } }}>{item.label}</button>)}
  </div>;
}
export function Drawer({ open, title, onClose, children, closeLabel = "Cerrar" }: { open: boolean; title: string; onClose: () => void; children: ReactNode; closeLabel?: string }) {
  const titleId = `ui-drawer-title-${useId().replace(/:/g, "")}`;
  const drawerRef = useRef<HTMLElement | null>(null);
  useDialogFocus(open, drawerRef, onClose);
  return open ? <div className="ui-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside ref={drawerRef} className="ui-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="ui-modal-head"><h2 id={titleId}>{title}</h2><IconButton label={closeLabel} onClick={onClose}>×</IconButton></div>{children}</aside></div> : null;
}
export function Toast({ message, tone = "info", className = "", onClose, closeLabel = "Cerrar" }: { message: string; tone?: Tone; className?: string; onClose?: () => void; closeLabel?: string }) { return <div className={`ui-toast ui-toast-${tone} ${className}`.trim()} role={tone === "danger" ? "alert" : "status"}><span className="ui-toast-message">{message}</span>{onClose && <IconButton label={closeLabel} onClick={onClose}>×</IconButton>}</div>; }
export function DataTable({ headers, rows, empty = "Sin datos" }: { headers: string[]; rows: ReactNode[][]; empty?: string }) { return rows.length ? <div className="ui-table-wrap"><table className="ui-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : <EmptyState title={empty} />; }
export function VariantPreview({ channel, body }: { channel: string; body?: Record<string, any> }) { return <Card className="ui-variant-preview"><Inline gap="sm"><ChannelBadge channel={channel} /><StatusBadge status="draft" /></Inline><p>{String(body?.text || body?.body || body?.caption || "Sin contenido generado todavía.")}</p></Card>; }
export function WorkspaceSwitcher({ name, children }: { name: string; children?: ReactNode }) { return <div className="ui-switcher"><span className="ui-eyebrow">Espacio</span><strong>{name}</strong>{children}</div>; }
export function BrandSwitcher({ name, children }: { name: string; children?: ReactNode }) { return <div className="ui-switcher"><span className="ui-eyebrow">Marca</span><strong>{name}</strong>{children}</div>; }
export function SchedulePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <TextField type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} aria-label="Fecha y hora de publicación" />; }
export function IntegrationStatus({ connected, label }: { connected: boolean; label?: string }) { return <Badge tone={connected ? "success" : "warning"}>{label || (connected ? "Conectada" : "Sin conectar")}</Badge>; }
