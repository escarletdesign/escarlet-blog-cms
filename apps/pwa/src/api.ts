import type { Post, Session } from './types'

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(data.message || 'No se pudo completar la operación.', response.status)
  return data as T
}

const baseApi = {
  session: () => request<Session>('/api/admin/session'),
  loginWithToken: (token: string) => request<Session>('/api/login', { method: 'POST', body: JSON.stringify({ token }) }),
  requestMagicLink: (email: string) => request<{ ok: boolean }>('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  posts: (site?: string) => request<{ posts: Post[] }>(`/api/admin/posts${site ? `?site=${encodeURIComponent(site)}` : ''}`),
  post: (slug: string, site?: string) => request<{ post: Post }>(`/api/admin/posts/${encodeURIComponent(slug)}${site ? `?site=${encodeURIComponent(site)}` : ''}`),
  createDraft: (post: Partial<Post> & { title: string; site?: string }) => request<{ post: Post }>('/api/admin/posts/create-draft', { method: 'POST', body: JSON.stringify(post) }),
  updatePost: (post: Partial<Post> & { slug: string; site?: string; originalSlug?: string }) => request<{ post: Post }>('/api/admin/posts', { method: 'POST', body: JSON.stringify(post) }),
  publish: (slug: string, site?: string, publishAt?: string) => request<{ post: Post; message?: string; published?: boolean; submittedForReview?: boolean }>('/api/admin/posts/publish', { method: 'POST', body: JSON.stringify({ slug, site, publishAt }) }),
  schedule: (slug: string, publishAt: string, site?: string) => request<{ post: Post; message?: string }>('/api/admin/posts/schedule', { method: 'POST', body: JSON.stringify({ slug, site, publishAt }) }),
  calendar: (site?: string) => request<{ posts: Post[] }>(`/api/admin/posts/calendar${site ? `?site=${encodeURIComponent(site)}` : ''}`),
  socialPack: (slug: string, site?: string) => request<{ pack: { channels?: Record<string, string>; [key: string]: unknown } }>(`/api/admin/social-pack/${encodeURIComponent(slug)}${site ? `?site=${encodeURIComponent(site)}` : ''}`),
  quota: (site?: string) => request<Record<string, unknown>>(`/api/admin/quota${site ? `?site=${encodeURIComponent(site)}` : ''}`),
  billing: (site?: string) => request<Record<string, unknown>>(`/api/admin/billing${site ? `?site=${encodeURIComponent(site)}` : ''}`),
  checkout: (input: { site?: string; kind: 'membership' | 'credits'; planId?: string; packId?: string }) =>
    request<{ site: string; configured: boolean; reason?: string; sessionId?: string | null; url: string | null }>('/api/admin/billing/checkout', { method: 'POST', body: JSON.stringify(input) }),
  billingPortal: (input: { site?: string; customerId: string }) =>
    request<{ site: string; configured: boolean; reason?: string; url: string | null }>('/api/admin/billing/portal', { method: 'POST', body: JSON.stringify(input) }),
  sites: () => request<{ sites: Array<{ handle?: string; id?: string; name?: string }>; handles: string[]; role: string }>('/api/admin/sites'),
  brand: (site: string) => request<{ summary?: string; files?: string[] }>(`/api/admin/brand-kit/${encodeURIComponent(site)}`),
  paymentLinks: () => request<Record<string, unknown>>('/api/admin/payment-links')
}

export type AiGeneration = {
  content?: string
  operation?: string
  provider?: string
  mode?: string
  socialPack?: Record<string, string>
  quota?: Record<string, unknown>
}

async function aiChat(input: { site?: string; message: string; model?: string }, onDelta?: (text: string) => void) {
  const response = await fetch('/api/ai/chat', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new ApiError(data.message || 'El asistente no está disponible.', response.status)
  }
  if (!response.body) return ''
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let content = ''
  const consume = (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) continue
      try { const value = JSON.parse(line.slice(5).trim()); if (typeof value.delta === 'string') { content += value.delta; onDelta?.(content) } } catch { /* ignore malformed SSE frame */ }
    }
  }
  while (true) {
    const { done, value } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const frames = buffer.split('\n\n'); buffer = frames.pop() || ''; frames.forEach(consume)
    if (done) break
  }
  if (buffer) consume(buffer)
  return content
}

async function aiGenerate(input: { site?: string; operation: 'title' | 'body' | 'image' | 'social-pack'; prompt: string; post?: Partial<Post>; model?: string }) {
  return request<AiGeneration>('/api/ai/generate', { method: 'POST', body: JSON.stringify(input) })
}

async function billingSnapshot(site?: string) {
  return request<Record<string, any>>(`/api/billing/snapshot${site ? `?site=${encodeURIComponent(site)}` : ''}`)
}
async function billingCheckout(input: { site?: string; kind: 'membership' | 'credits'; planId?: string; packId?: string }) {
  return request<{ url?: string; configured?: boolean; reason?: string }>('/api/billing/checkout', { method: 'POST', body: JSON.stringify(input) })
}
async function billingPortal(input: { site?: string }) {
  return request<{ url?: string; configured?: boolean; reason?: string }>('/api/billing/portal', { method: 'POST', body: JSON.stringify(input) })
}

export const api = Object.assign(baseApi, { aiChat, aiGenerate, billingSnapshot, billingCheckout, billingPortal })
