import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function isProbablyMarkdown(text = '') {
  const raw = String(text).trim()
  if (!raw) return false
  if (/<(?:p|h[1-6]|div|ul|ol|article|section|blockquote)\b/i.test(raw)) return false
  if (/<[a-z][^>]*>/i.test(raw) && !/^#{1,6}\s/m.test(raw)) return false
  return /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\*\*[^*]+\*\*|^>\s/m.test(raw)
}

export function renderPostBody(body = '') {
  const raw = String(body || '').trim()
  if (!raw) return ''
  if (isProbablyMarkdown(raw)) return marked.parse(raw)
  return raw
}
