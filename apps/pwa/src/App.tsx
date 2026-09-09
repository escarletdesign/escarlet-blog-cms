import { createContext, FormEvent, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from './api'
import type { Post, Session } from './types'

type Draft = Partial<Post> & { title: string; slug?: string }
type AppState = { session: Session; site: string; refresh: () => Promise<void> }
const SessionContext = createContext<AppState | null>(null)
const useApp = () => {
  const value = useContext(SessionContext)
  if (!value) throw new Error('App context unavailable')
  return value
}
const isAdmin = (role?: string) => role === 'admin' || role === 'agency_admin'
const readableDate = (value?: string) => value ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: value.includes('T') ? 'short' : undefined }).format(new Date(value)) : 'Sin fecha'
const slugify = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = async () => {
    try { setSession(await api.session()) } catch { setSession(null) } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  const basename = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/') ? '/app' : undefined
  if (loading) return <div className="splash"><span className="mark">E</span><p>Abriendo Escarlet…</p></div>
  return <BrowserRouter basename={basename}>{session ? <SessionContext.Provider value={{ session, site: session.site || session.sites?.[0] || 'escarlet', refresh }}><Routes><Route element={<Shell />}><Route path="/" element={<Home />} /><Route path="/chat" element={<Chat />} /><Route path="/manual" element={<ManualPost />} /><Route path="/preview/:slug" element={<Preview />} /><Route path="/schedule/:slug" element={<Schedule />} /><Route path="/publish/:slug" element={<PublishSocial />} /><Route path="/posts" element={<Posts />} /><Route path="/calendar" element={<Calendar />} /><Route path="/settings" element={<Settings />} /><Route path="/billing" element={<Billing />} /><Route path="/admin" element={<AdminGate />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes></SessionContext.Provider> : <Routes><Route path="*" element={<Login onLogin={refresh} />} /></Routes>}</BrowserRouter>
}

function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true)
    try { await api.loginWithToken(token.trim()); await onLogin() } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión.') } finally { setSubmitting(false) }
  }
  const sendMagic = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMagicSent(false); setSubmitting(true)
    try { await api.requestMagicLink(email.trim()); setMagicSent(true) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar el enlace.') } finally { setSubmitting(false) }
  }
  return <main className="login-page"><section className="login-card"><div className="brand"><span className="mark">E</span><span>Escarlet</span></div><p className="eyebrow">CMS DE CONTENIDO</p><h1>Tu próxima idea empieza aquí.</h1><p className="muted">Recibe un enlace mágico y entra sin contraseña. La sesión se activará automáticamente.</p><form onSubmit={sendMagic}><label>Tu email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" autoComplete="email" /></label><button className="primary" disabled={submitting}>{submitting ? 'Enviando…' : 'Enviar enlace mágico'}</button></form>{magicSent && <p className="success">Si el email está registrado, recibirás un enlace en unos minutos.</p>}<div className="magic-note">✦ ¿Ya abriste un enlace? Recarga esta página.</div><details><summary>Acceso con token</summary><form onSubmit={submit}><label>Token de acceso<input value={token} onChange={e => setToken(e.target.value)} placeholder="Pega tu token" autoComplete="off" /></label>{error && <p className="error">{error}</p>}<button className="primary" disabled={submitting}>{submitting ? 'Entrando…' : 'Entrar'}</button></form></details><p className="tiny">El acceso está limitado a usuarios invitados por Escarlet.</p></section></main>
}

function Shell() {
  const { session, site } = useApp()
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const location = useLocation()
  useEffect(() => setOpen(false), [location.pathname])
  const links = [{ to: '/', label: 'Inicio', icon: '⌂' }, { to: '/chat', label: 'Asistente', icon: '✦' }, { to: '/posts', label: 'Posts', icon: '▤' }, { to: '/calendar', label: 'Calendario', icon: '□' }]
  return <div className="app-shell"><aside className={`sidebar ${open ? 'open' : ''}`}><div className="sidebar-head"><NavLink to="/" className="brand"><span className="mark">E</span><span>Escarlet</span></NavLink><button className="icon-button close" onClick={() => setOpen(false)} aria-label="Cerrar menú">×</button></div><button className="new-chat" onClick={() => nav('/chat')}>＋ Nueva conversación</button><nav>{links.map(link => <NavLink key={link.to} to={link.to} end={link.to === '/'} className="nav-link"><i>{link.icon}</i>{link.label}</NavLink>)}{isAdmin(session.role) && <NavLink to="/admin" className="nav-link"><i>⚙</i>Administración</NavLink>}</nav><div className="sidebar-bottom"><p className="site-pill">● {site}</p><NavLink to="/settings" className="profile"><span className="avatar">{(session.email || session.userId || 'E')[0].toUpperCase()}</span><span><b>{session.email || 'Mi cuenta'}</b><small>{session.role === 'admin' ? 'Equipo Escarlet' : 'Espacio de trabajo'}</small></span><span>···</span></NavLink></div></aside><button className={`backdrop ${open ? 'show' : ''}`} onClick={() => setOpen(false)} aria-label="Cerrar navegación" /><section className="workspace"><header className="mobile-head"><button className="icon-button" onClick={() => setOpen(true)} aria-label="Abrir menú">☰</button><NavLink to="/" className="brand"><span className="mark">E</span><span>Escarlet</span></NavLink><NavLink className="icon-button" to="/settings" aria-label="Ajustes">◌</NavLink></header><Outlet /></section></div>
}

function Home() {
  const nav = useNavigate(); const { session, site } = useApp()
  return <main className="page home"><div className="home-intro"><p className="eyebrow">{site}</p><h1>¿Qué quieres crear hoy?</h1><p className="muted">Convierte una idea en un post listo para revisar, publicar o programar.</p></div><div className="choice-grid"><button className="choice-card ai" onClick={() => nav('/chat')}><span>✦</span><strong>Crear con IA</strong><small>Cuéntale al asistente qué quieres comunicar.</small><b>Empezar →</b></button><button className="choice-card" onClick={() => nav('/manual')}><span>✎</span><strong>Escribir un post</strong><small>Empieza con una estructura sencilla, a tu ritmo.</small><b>Crear post →</b></button></div><section className="home-section"><div className="section-title"><h2>Continúa creando</h2><NavLink to="/posts">Ver todos</NavLink></div><RecentPosts /><div className="quick-actions"><button onClick={() => nav('/calendar')}>□ Ver calendario editorial</button>{isAdmin(session.role) && <button onClick={() => nav('/admin')}>⚙ Abrir administración</button>}</div></section></main>
}

function RecentPosts() {
  const { site } = useApp(); const [posts, setPosts] = useState<Post[]>([]); const [error, setError] = useState('')
  useEffect(() => { api.posts(site).then(r => setPosts(r.posts.slice(0, 4))).catch(e => setError(e.message)) }, [site])
  if (error) return <p className="empty">No se pudieron cargar tus posts.</p>
  if (!posts.length) return <p className="empty">Aún no hay posts. Empieza con una idea o un borrador manual.</p>
  return <div className="post-list compact">{posts.map(post => <PostRow key={post.slug} post={post} />)}</div>
}

function Chat() {
  const nav = useNavigate()
  const [messages, setMessages] = useState<Array<{ role: 'assistant' | 'user'; text: string }>>([{ role: 'assistant', text: 'Hola. Cuéntame el objetivo, la audiencia y la idea que quieres convertir en post.' }])
  const [value, setValue] = useState(''); const [creating, setCreating] = useState(false); const [lastBrief, setLastBrief] = useState(''); const { site } = useApp()
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const brief = value.trim(); if (!brief) return
    setMessages(prev => [...prev, { role: 'user', text: brief }, { role: 'assistant', text: '' }]); setValue(''); setCreating(true); setLastBrief(brief)
    try {
      await api.aiChat({ site, message: brief, model: localStorage.getItem('escarlet_model') || undefined }, streamed => {
        setMessages(prev => prev.map((message, index) => index === prev.length - 1 ? { ...message, text: streamed } : message))
      })
    } catch (e) {
      setMessages(prev => prev.map((message, index) => index === prev.length - 1 ? { ...message, text: `No pude responder: ${e instanceof Error ? e.message : 'inténtalo de nuevo.'}` } : message))
    } finally { setCreating(false) }
  }
  const createDraft = async () => {
    if (!lastBrief) return; setCreating(true)
    try { const title = lastBrief.slice(0, 72); const result = await api.createDraft({ site, title, slug: slugify(title), contentSource: 'client' }); nav(`/preview/${encodeURIComponent(result.post.slug)}`) }
    catch (e) { setMessages(prev => [...prev, { role: 'assistant', text: `No pude crear el borrador: ${e instanceof Error ? e.message : 'inténtalo de nuevo.'}` }]) }
    finally { setCreating(false) }
  }
  return <main className="chat-page"><div className="chat-top"><div><p className="eyebrow">ASISTENTE ESCARLET</p><h1>Nueva conversación</h1></div><button className="ghost" onClick={() => { setLastBrief(''); setMessages([{ role: 'assistant', text: '¿Sobre qué quieres escribir hoy?' }]) }}>Limpiar</button></div><div className="messages">{messages.map((message, index) => <div key={index} className={`message ${message.role}`}><span className="message-mark">{message.role === 'assistant' ? '✦' : 'Tú'}</span><p>{message.text || '…'}</p></div>)}</div>{lastBrief && <button className="secondary draft-from-chat" disabled={creating} onClick={createDraft}>Convertir esta idea en borrador →</button>}<form className="composer" onSubmit={submit}><textarea value={value} onChange={e => setValue(e.target.value)} placeholder="Ej.: Quiero explicar cómo elegir una paleta de color para una marca…" rows={3} /><div><small>El asistente conoce el contexto de marca de tu sitio.</small><button className="primary" disabled={creating || !value.trim()}>{creating ? 'Pensando…' : 'Enviar ↑'}</button></div></form></main>
}

function ManualPost() {
  const nav = useNavigate(); const { site } = useApp(); const [draft, setDraft] = useState<Draft>({ title: '', excerptEs: '', bodyHtml: '<p></p>', metaDescription: { es: '' } }); const [saving, setSaving] = useState(false); const [generating, setGenerating] = useState<'title' | 'body' | 'image' | null>(null); const [error, setError] = useState('')
  const update = (key: keyof Draft, value: unknown) => setDraft(current => ({ ...current, [key]: value }))
  const generate = async (operation: 'title' | 'body' | 'image') => {
    setError(''); setGenerating(operation)
    try { const result = await api.aiGenerate({ site, operation, prompt: draft.title || draft.excerptEs || 'Propón contenido para este post', post: draft, model: localStorage.getItem('escarlet_model') || undefined }); if (operation === 'title') update('title', result.content || ''); else if (operation === 'body') update('bodyHtml', `<p>${(result.content || '').replace(/\n+/g, '</p><p>')}</p>`); else update('imageAlt', result.content || '') }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar contenido.') } finally { setGenerating(null) }
  }
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); try { const created = await api.createDraft({ site, title: draft.title, slug: draft.slug || slugify(draft.title), contentSource: 'client' }); const post = created.post; const saved = await api.updatePost({ ...post, site, originalSlug: post.slug, title: draft.title, slug: draft.slug || post.slug, excerptEs: draft.excerptEs, bodyHtml: draft.bodyHtml, metaDescription: draft.metaDescription, metaTitle: { es: draft.title } }); nav(`/preview/${encodeURIComponent(saved.post.slug)}`) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el borrador.') } finally { setSaving(false) } }
  return <main className="page form-page"><PageTitle eyebrow="POST MANUAL" title="Escribe a tu manera" description="Crea un borrador. Podrás revisarlo antes de publicar o programar." /><form onSubmit={submit} className="editor-form"><label>Título <button type="button" className="inline-ai" onClick={() => generate('title')} disabled={Boolean(generating)}>{generating === 'title' ? 'Generando…' : '✦ Sugerir con IA'}</button><input required value={draft.title} onChange={e => update('title', e.target.value)} placeholder="Un título claro y atractivo" /></label><label>Slug <span className="optional">opcional</span><input value={draft.slug || ''} onChange={e => update('slug', slugify(e.target.value))} placeholder="se-crea-a-partir-del-titulo" /></label><label>Resumen<input value={draft.excerptEs || ''} onChange={e => update('excerptEs', e.target.value)} placeholder="Una frase para presentar el post." /></label><label>Contenido <button type="button" className="inline-ai" onClick={() => generate('body')} disabled={Boolean(generating)}>{generating === 'body' ? 'Generando…' : '✦ Redactar con IA'}</button><span className="optional">HTML sencillo permitido</span><textarea required value={draft.bodyHtml || ''} onChange={e => update('bodyHtml', e.target.value)} rows={13} placeholder="<p>Escribe tu historia…</p>" /></label><label>Imagen <button type="button" className="inline-ai" onClick={() => generate('image')} disabled={Boolean(generating)}>{generating === 'image' ? 'Generando…' : '✦ Proponer brief'}</button><span className="optional">Texto alternativo o briefing para adjuntar después</span><input value={draft.imageAlt || ''} onChange={e => update('imageAlt', e.target.value)} placeholder="Describe la imagen de portada" /></label><label>Meta descripción<input value={draft.metaDescription?.es || ''} onChange={e => update('metaDescription', { es: e.target.value })} maxLength={155} placeholder="Hasta 155 caracteres" /></label>{error && <p className="error">{error}</p>}<div className="form-actions"><button type="button" className="ghost" onClick={() => nav(-1)}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar y previsualizar →'}</button></div></form></main>
}

function Preview() {
  const { slug = '' } = useParams(); const nav = useNavigate(); const { site } = useApp(); const [post, setPost] = useState<Post | null>(null); const [error, setError] = useState('')
  useEffect(() => { api.post(slug, site).then(r => setPost(r.post)).catch(e => setError(e.message)) }, [slug, site])
  if (error) return <main className="page"><p className="error">{error}</p></main>; if (!post) return <Loading />
  return <main className="preview-page"><div className="preview-head"><div><p className="eyebrow">VISTA PREVIA</p><h1>Revisa antes de continuar</h1></div><span className={`status ${post.status}`}>{post.status}</span></div><article className="article-preview">{post.imageUrl && <img src={post.imageUrl} alt={post.imageAlt || ''} />}<p className="article-meta">{post.authorName || 'Escarlet'} · {readableDate(post.datePublished)}</p><h1>{post.title}</h1><p className="article-lead">{post.excerptEs}</p><div className="article-body" dangerouslySetInnerHTML={{ __html: post.bodyHtml }} /></article><div className="sticky-actions"><button className="ghost" onClick={() => nav('/manual')}>Editar</button><button className="secondary" onClick={() => nav(`/schedule/${encodeURIComponent(post.slug)}`)}>Programar</button><button className="primary" onClick={() => nav(`/publish/${encodeURIComponent(post.slug)}`)}>Publicar →</button></div></main>
}

function Schedule() {
  const { slug = '' } = useParams(); const nav = useNavigate(); const { site } = useApp(); const [publishAt, setPublishAt] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!publishAt) return; setSaving(true); try { await api.schedule(slug, new Date(publishAt).toISOString(), site); nav('/posts') } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo programar.') } finally { setSaving(false) } }
  return <main className="page narrow"><PageTitle eyebrow="PROGRAMAR" title="Elige cuándo saldrá" description="El post seguirá siendo editable hasta su publicación." /><form className="card form-stack" onSubmit={submit}><label>Fecha y hora<input required type="datetime-local" value={publishAt} onChange={e => setPublishAt(e.target.value)} min={new Date().toISOString().slice(0, 16)} /></label>{error && <p className="error">{error}</p>}<button className="primary" disabled={saving}>{saving ? 'Programando…' : 'Confirmar programación'}</button><button type="button" className="ghost" onClick={() => nav(-1)}>Volver</button></form></main>
}

function PublishSocial() {
  const { slug = '' } = useParams(); const nav = useNavigate(); const { site } = useApp(); const [post, setPost] = useState<Post | null>(null); const [socialPack, setSocialPack] = useState<Record<string, string> | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { api.post(slug, site).then(r => setPost(r.post)).catch(e => setMessage(e.message)) }, [slug, site])
  const generatePack = async () => { if (!post) return; setBusy(true); try { const result = await api.aiGenerate({ site, operation: 'social-pack', prompt: `Genera un social pack para ${post.title}`, post }); setSocialPack(result.socialPack || null); setMessage(result.content || 'Social Pack preparado.') } catch (e) { setMessage(e instanceof Error ? e.message : 'No se pudo generar el Social Pack.') } finally { setBusy(false) } }
  const publish = async () => { setBusy(true); try { const result = await api.publish(slug, site); setMessage(result.message || (result.published ? 'Publicado correctamente.' : 'Enviado a revisión.')); setTimeout(() => nav('/posts'), 900) } catch (e) { setMessage(e instanceof Error ? e.message : 'No se pudo publicar.') } finally { setBusy(false) } }
  return <main className="page narrow"><PageTitle eyebrow="PUBLICAR" title="Todo listo para compartir" description="Publica el post y prepara los textos para tus canales." />{post && <section className="card social-card"><h2>{post.title}</h2><p className="muted">Prepara variantes para cada canal antes de publicar.</p><button className="secondary" disabled={busy} onClick={generatePack}>{busy ? 'Preparando…' : '✦ Generar Social Pack'}</button>{socialPack && <div className="social-output">{Object.entries(socialPack).map(([channel, text]) => <article key={channel}><b>{channel}</b><p>{text}</p></article>)}</div>}<div className="channel-chips"><span>LinkedIn</span><span>Instagram</span><span>X</span><span>Substack</span></div></section>}{message && <p className={message.includes('No se pudo') ? 'error' : 'success'}>{message}</p>}<div className="form-actions"><button className="ghost" onClick={() => nav(-1)}>Volver</button><button className="primary" disabled={busy || !post} onClick={publish}>{busy ? 'Publicando…' : 'Publicar ahora'}</button></div></main>
}

function Posts() {
  const { site } = useApp(); const [posts, setPosts] = useState<Post[]>([]); const [error, setError] = useState(''); const nav = useNavigate()
  useEffect(() => { api.posts(site).then(r => setPosts(r.posts)).catch(e => setError(e.message)) }, [site])
  return <main className="page"><div className="page-header"><PageTitle eyebrow="CONTENIDO" title="Tus posts" description="Borradores, publicaciones y programaciones en un solo lugar." /><button className="primary" onClick={() => nav('/manual')}>＋ Nuevo post</button></div>{error ? <p className="error">{error}</p> : posts.length ? <div className="post-list">{posts.map(post => <PostRow key={post.slug} post={post} />)}</div> : <EmptyState title="Aún no hay posts" action="Crear mi primer post" onClick={() => nav('/manual')} />}</main>
}
function PostRow({ post }: { post: Post }) { const nav = useNavigate(); return <button className="post-row" onClick={() => nav(`/preview/${encodeURIComponent(post.slug)}`)}><div><span className={`status ${post.status}`}>{post.status}</span><h3>{post.title}</h3><p>{post.publishAt ? `Programado: ${readableDate(post.publishAt)}` : `Actualizado: ${readableDate(post.dateModified || post.datePublished)}`}</p></div><span className="chevron">›</span></button> }

function Calendar() {
  const { site } = useApp(); const [posts, setPosts] = useState<Post[]>([]); const [error, setError] = useState('')
  useEffect(() => { api.calendar(site).then(r => setPosts(r.posts || [])).catch(e => setError(e.message)) }, [site])
  const grouped = useMemo(() => posts.reduce<Record<string, Post[]>>((acc, post) => { const key = (post.publishAt || post.datePublished || 'Sin fecha').slice(0, 10); (acc[key] ||= []).push(post); return acc }, {}), [posts])
  return <main className="page"><PageTitle eyebrow="PLANIFICACIÓN" title="Calendario editorial" description="Visualiza lo que viene y mantén el ritmo de publicación." />{error && <p className="error">{error}</p>}<div className="calendar-list">{Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => <section key={date}><h2>{readableDate(date)}</h2>{rows.map(post => <PostRow key={post.slug} post={post} />)}</section>)}{!posts.length && !error && <EmptyState title="No hay publicaciones previstas" action="Crear un post" onClick={() => location.assign('./manual')} />}</div></main>
}

function Settings() {
  const { session, site, refresh } = useApp(); const [model, setModel] = useState(localStorage.getItem('escarlet_model') || 'auto'); const [message, setMessage] = useState('')
  const save = () => { localStorage.setItem('escarlet_model', model); setMessage('Preferencia guardada en este dispositivo.') }
  const logout = () => { document.cookie = 'escarlet_cms=; Path=/; Max-Age=0; SameSite=Lax'; void refresh() }
  return <main className="page narrow"><PageTitle eyebrow="CUENTA" title="Ajustes" description="Personaliza cómo trabajas en Escarlet." /><section className="card settings-card"><label>Modelo preferido<select value={model} onChange={e => setModel(e.target.value)}><option value="auto">Automático (según tu plan)</option><option value="gpt">GPT</option><option value="gemini">Gemini</option><option value="grok">Grok</option></select></label><p className="tiny">La disponibilidad depende de los créditos y del plan del sitio.</p><button className="secondary" onClick={save}>Guardar preferencia</button>{message && <p className="success">{message}</p>}</section><section className="card settings-card"><p className="eyebrow">ESPACIO</p><h2>{site}</h2><p className="muted">Rol: {session.role}</p><NavLink className="text-link" to="/billing">Ver créditos y packs →</NavLink></section><button className="danger-link" onClick={logout}>Cerrar sesión</button></main>
}

function Billing() {
  const { site } = useApp(); const [snapshot, setSnapshot] = useState<Record<string, any> | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState('')
  useEffect(() => { api.billingSnapshot(site).then(setSnapshot).catch(e => setMessage(e.message)) }, [site])
  const checkout = async (input: { kind: 'membership' | 'credits'; planId?: string; packId?: string }) => { setBusy(input.planId || input.packId || input.kind); try { const result = await api.billingCheckout({ site, ...input }); if (result.url) window.location.assign(result.url); else setMessage('El pago no está configurado todavía para este pack.') } catch (e) { setMessage(e instanceof Error ? e.message : 'No se pudo abrir el checkout.') } finally { setBusy('') } }
  const portal = async () => { setBusy('portal'); try { const result = await api.billingPortal({ site }); if (result.url) window.location.assign(result.url); else setMessage('El portal de facturación no está disponible para esta cuenta.') } catch (e) { setMessage(e instanceof Error ? e.message : 'No se pudo abrir el portal.') } finally { setBusy('') } }
  const ai = snapshot?.ai?.tokenCredits; const packs = (snapshot?.creditPacks || []) as Array<{ id: string; name: string; tokenCredits: number; configured?: boolean }>
  return <main className="page narrow"><PageTitle eyebrow="CRÉDITOS" title="Packs y uso" description="Consulta el uso de tu espacio y amplía tus créditos cuando lo necesites." /><section className="card quota-card"><h2>Créditos de IA</h2>{snapshot ? <><strong className="credit-number">{Number(ai?.available || 0).toLocaleString('es-ES')}</strong><p className="muted">créditos disponibles · {Number(ai?.monthlyRemaining || 0).toLocaleString('es-ES')} incluidos este mes</p><p className="tiny">Plan actual: {snapshot?.plan?.name || snapshot?.plan?.id || '—'}</p></> : <p className="muted">Cargando tus créditos…</p>}<button className="ghost" disabled={busy === 'portal'} onClick={portal}>{busy === 'portal' ? 'Abriendo…' : 'Gestionar facturación'}</button></section><section className="pack-grid">{packs.length ? packs.map(pack => <div className="card" key={pack.id}><p className="eyebrow">CRÉDITOS EXTRA</p><h2>{pack.name}</h2><p>{pack.tokenCredits.toLocaleString('es-ES')} créditos para el asistente.</p><button className="secondary" disabled={Boolean(busy) || !pack.configured} onClick={() => checkout({ kind: 'credits', packId: pack.id })}>{busy === pack.id ? 'Abriendo…' : pack.configured ? 'Comprar pack' : 'Próximamente'}</button></div>) : <div className="card"><h2>Packs no disponibles</h2><p>Tu equipo podrá activar nuevos créditos aquí.</p></div>}<div className="card featured"><p className="eyebrow">PLAN</p><h2>Mejorar plan</h2><p>Más créditos y modelos disponibles para tu equipo.</p><button className="primary" disabled={Boolean(busy)} onClick={() => checkout({ kind: 'membership', planId: 'growth' })}>{busy === 'growth' ? 'Abriendo…' : 'Ver plan Growth'}</button></div></section>{message && <p className="success">{message}</p>}</main>
}

function AdminGate() { const { session } = useApp(); return isAdmin(session.role) ? <Admin /> : <Navigate to="/" replace /> }
function Admin() {
  const { site } = useApp(); const [sites, setSites] = useState<string[]>([]); const [brand, setBrand] = useState<string>(''); const [message, setMessage] = useState('')
  useEffect(() => { api.sites().then(data => setSites(data.handles)).catch(e => setMessage(e.message)); api.brand(site).then(data => setBrand(data.summary || '')).catch(() => {}) }, [site])
  return <main className="page"><PageTitle eyebrow="OPERACIONES" title="Administración" description="Herramientas internas de Escarlet para gestionar sitios y marca." /><div className="admin-grid"><section className="card"><h2>Sitios</h2>{sites.length ? <ul>{sites.map(handle => <li key={handle}>● {handle}</li>)}</ul> : <p className="muted">Cargando sitios…</p>}</section><section className="card"><h2>Brand kit</h2><p className="muted">{brand || 'Consulta el contexto de marca configurado para este sitio.'}</p><a className="text-link" href="/admin">Abrir panel legacy →</a></section><section className="card"><h2>Usuarios</h2><p className="muted">Invitaciones, magic links y roles siguen disponibles en el panel de operaciones.</p><a className="text-link" href="/admin">Gestionar usuarios →</a></section><section className="card"><h2>Conexión del sitio</h2><p className="muted">Webhooks, WordPress y ajustes de publicación.</p><a className="text-link" href="/admin">Abrir configuración →</a></section></div>{message && <p className="error">{message}</p>}</main>
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="title-block"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div> }
function EmptyState({ title, action, onClick }: { title: string; action: string; onClick: () => void }) { return <section className="empty-state"><span>✦</span><h2>{title}</h2><p>Cuando estés listo, crea un borrador y vuelve aquí para seguirlo.</p><button className="primary" onClick={onClick}>{action}</button></section> }
function Loading() { return <main className="page"><div className="loading">Cargando…</div></main> }

export default App
