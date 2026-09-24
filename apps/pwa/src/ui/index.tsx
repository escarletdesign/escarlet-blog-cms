import { useEffect, useId } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "review" | "published";

export function Button({ variant = "primary", size = "md", loading = false, children, disabled, className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean }) {
  return <button type={type} className={`ui-button ui-button-${variant} ui-button-${size} ${className}`.trim()} disabled={disabled || loading} {...props}>{loading && <span className="ui-spinner" aria-hidden="true" />}{children}</button>;
}

export function IconButton({ label, children, className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type={type} className={`ui-icon-button ${className}`.trim()} aria-label={label} {...props}>{children}</button>;
}

export function Field({ label, hint, error, children, required = false }: { label?: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return <label className="ui-field">{label && <span className="ui-field-label">{label}{required && <span aria-hidden="true"> *</span>}</span>}{children}{hint && !error && <span className="ui-field-hint">{hint}</span>}{error && <span className="ui-field-error" role="alert">{error}</span>}</label>;
}

export function TextField({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={`ui-input ${className}`.trim()} {...props} />; }
export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={`ui-input ui-textarea ${className}`.trim()} {...props} />; }
export function Select({ children, className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select className={`ui-input ui-select ${className}`.trim()} {...props}>{children}</select>; }
export function Checkbox({ label, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) { return <label className="ui-checkbox"><input type="checkbox" className={className} {...props} /><span>{label}</span></label>; }
export function MultiSelectPills({ options, value, onChange, ariaLabel }: { options: Array<{ id: string; label: string }>; value: string[]; onChange: (value: string[]) => void; ariaLabel: string }) {
  return <div className="ui-multi-select-pills" role="group" aria-label={ariaLabel}>{options.map((option) => { const selected = value.includes(option.id); return <button key={option.id} type="button" className={`ui-multi-select-pill${selected ? " active" : ""}`} aria-pressed={selected} onClick={() => onChange(selected ? value.filter((id) => id !== option.id) : [...value, option.id])}>{option.label}</button>; })}</div>;
}

export function Card({ children, className = "", ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) { return <section className={`ui-card ${className}`.trim()} {...props}>{children}</section>; }
export function Stack({ children, gap = "md", className = "" }: { children: ReactNode; gap?: "sm" | "md" | "lg"; className?: string }) { return <div className={`ui-stack ui-stack-${gap} ${className}`}>{children}</div>; }
export function Inline({ children, gap = "sm", className = "" }: { children: ReactNode; gap?: "sm" | "md" | "lg"; className?: string }) { return <div className={`ui-inline ui-inline-${gap} ${className}`}>{children}</div>; }
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) { return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>; }
export function StatusBadge({ status, label }: { status?: string; label?: ReactNode }) { const tone: Tone = status === "published" ? "published" : status === "connected" || status === "approved" || status === "scheduled" ? "success" : status === "failed" || status === "canceled" || status === "disabled" ? "danger" : status === "needs_review" || status === "action_required" ? "review" : status === "syncing" ? "info" : "neutral"; return <Badge tone={tone}>{label || String(status || "draft").replace(/_/g, " ")}</Badge>; }
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="ui-empty"><div className="ui-empty-icon">✦</div><h2>{title}</h2>{description && <p>{description}</p>}{action}</div>; }
export function Skeleton({ width = "100%", height = "1rem" }: { width?: string; height?: string }) { return <span className="ui-skeleton" style={{ width, height }} aria-hidden="true" />; }
export function Progress({ value, max = 100 }: { value: number; max?: number }) { const safe = Math.max(0, Math.min(max, value)); return <div className="ui-progress" role="progressbar" aria-valuenow={safe} aria-valuemin={0} aria-valuemax={max}><span style={{ width: `${max ? safe / max * 100 : 0}%` }} /></div>; }
export function PageHeader({ eyebrow, title, description, actions, back }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode; back?: ReactNode }) { return <header className="ui-page-header"><div className="ui-page-heading">{back && <div className="ui-page-back">{back}</div>}{eyebrow && <span className="ui-eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="ui-page-actions">{actions}</div>}</header>; }
export function ChannelBadge({ channel }: { channel: string }) { const labels: Record<string, string> = { blog: "Blog", instagram: "Instagram", instagram_story: "Instagram Story", linkedin: "LinkedIn", x: "X", video: "Vídeo", substack: "Substack" }; return <span className={`ui-badge ui-channel-badge ui-channel-${channel}`}>{labels[channel] || channel}</span>; }
export function ContentPlanCard({ title, total, generated, failed, status, channels, onClick }: { title: string; total: number; generated?: number; failed?: number; status?: string; channels?: string[]; onClick?: () => void }) { const content = <><div className="ui-card-head"><div><span className="ui-eyebrow">Campaña</span><h2>{title}</h2></div><StatusBadge status={status} /></div><Progress value={generated || 0} max={total || 1} /><div className="ui-card-meta"><span>{generated || 0}/{total} {total === 1 ? "publicación generada" : "publicaciones generadas"}</span>{failed ? <span className="ui-danger-text">{failed} con error</span> : null}</div>{channels?.length ? <div className="ui-channel-list">{channels.map((channel) => <ChannelBadge key={channel} channel={channel} />)}</div> : null}</>; return onClick ? <button type="button" className="ui-card ui-plan-card" onClick={onClick}>{content}</button> : <Card className="ui-plan-card">{content}</Card>; }
export function PublicationCard({ topic, status, channels, error, actions }: { topic: string; status?: string; channels?: string[]; error?: string | null; actions?: ReactNode }) { return <Card className="ui-publication-card"><div className="ui-card-head"><div><h3>{topic}</h3>{channels?.length ? <div className="ui-channel-list">{channels.map((channel) => <ChannelBadge key={channel} channel={channel} />)}</div> : null}</div><StatusBadge status={status} /></div>{error && <p className="ui-field-error">{error}</p>}{actions && <div className="ui-card-actions">{actions}</div>}</Card>; }
export function Modal({ open, title, onClose, children, closeLabel = "Cerrar", className = "" }: { open: boolean; title: string; onClose: () => void; children: ReactNode; closeLabel?: string; className?: string }) {
  const titleId = `ui-modal-title-${useId().replace(/:/g, "")}`;
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="ui-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`ui-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="ui-modal-head"><h2 id={titleId}>{title}</h2><IconButton label={closeLabel} onClick={onClose}>×</IconButton></div>{children}</section></div>;
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
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);
  return open ? <div className="ui-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="ui-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="ui-modal-head"><h2 id={titleId}>{title}</h2><IconButton label={closeLabel} onClick={onClose}>×</IconButton></div>{children}</aside></div> : null;
}
export function Toast({ message, tone = "info", className = "", onClose, closeLabel = "Cerrar" }: { message: string; tone?: Tone; className?: string; onClose?: () => void; closeLabel?: string }) { return <div className={`ui-toast ui-toast-${tone} ${className}`.trim()} role={tone === "danger" ? "alert" : "status"}><span className="ui-toast-message">{message}</span>{onClose && <IconButton label={closeLabel} onClick={onClose}>×</IconButton>}</div>; }
export function DataTable({ headers, rows, empty = "Sin datos" }: { headers: string[]; rows: ReactNode[][]; empty?: string }) { return rows.length ? <div className="ui-table-wrap"><table className="ui-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : <EmptyState title={empty} />; }
export function VariantPreview({ channel, body }: { channel: string; body?: Record<string, any> }) { return <Card className="ui-variant-preview"><Inline gap="sm"><ChannelBadge channel={channel} /><StatusBadge status="draft" /></Inline><p>{String(body?.text || body?.body || body?.caption || "Sin contenido generado todavía.")}</p></Card>; }
export function WorkspaceSwitcher({ name, children }: { name: string; children?: ReactNode }) { return <div className="ui-switcher"><span className="ui-eyebrow">Espacio</span><strong>{name}</strong>{children}</div>; }
export function BrandSwitcher({ name, children }: { name: string; children?: ReactNode }) { return <div className="ui-switcher"><span className="ui-eyebrow">Marca</span><strong>{name}</strong>{children}</div>; }
export function SchedulePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <TextField type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} aria-label="Fecha y hora de publicación" />; }
export function IntegrationStatus({ connected, label }: { connected: boolean; label?: string }) { return <Badge tone={connected ? "success" : "warning"}>{label || (connected ? "Conectada" : "Sin conectar")}</Badge>; }
