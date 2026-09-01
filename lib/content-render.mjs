import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function looksLikeHtml(text = '') {
  const raw = String(text).trim()
  return /<(?:p|h[1-6]|div|ul|ol|li|article|blockquote|br)\b/i.test(raw)
}

export function isProbablyMarkdown(text = '') {
  const raw = String(text).trim()
  if (!raw) return false
  if (looksLikeHtml(raw)) return false
  return /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\*\*[^*]+\*\*|^>\s/m.test(raw)
}

export function renderPostBody(body = '') {
  const raw = String(body || '').trim()
  if (!raw) return ''
  if (looksLikeHtml(raw)) return raw
  return marked.parse(raw)
}
