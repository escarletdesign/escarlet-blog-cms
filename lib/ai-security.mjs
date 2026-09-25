/**
 * Defensive controls shared by the PWA AI endpoints and the MCP bridge.
 *
 * These checks are intentionally conservative: prompts are untrusted input,
 * while tool arguments are treated as an API boundary. No raw prompt or
 * credential is ever included in an error or rate-limit key.
 */

export const MAX_AI_PROMPT_CHARS = 12_000
export const MAX_TOOL_ARGUMENT_DEPTH = 6
export const MAX_TOOL_ARGUMENT_KEYS = 120
export const MAX_TOOL_STRING_CHARS = 120_000
export const MAX_TOOL_BINARY_CHARS = 8 * 1024 * 1024

const RATE_WINDOW_MS = 60_000
const rateBuckets = new Map()

// Covers instruction override attempts, system prompt exfiltration, common
// jailbreak markers and model-directed tool-call injection. It deliberately
// does not inspect the generated response, only untrusted user/tool input.
const PROMPT_INJECTION_PATTERNS = [
  /\b(?:ignore|omit|forget|disregard|override|bypass|skip|desobedece|omitir|ignor[aá]|olvid[aá]|anula)\b[\s\S]{0,160}\b(?:previous|prior|above|system|developer|instructions?|rules?|instrucciones?|reglas?|anteriores?)\b/i,
  /\b(?:reveal|show|print|repeat|dump|export|exfiltrat|revela|muestra|imprime|repite|exporta|descarga|comparte)\b[\s\S]{0,180}\b(?:system\s+prompt|system\s+message|developer\s+message|prompt\s+del\s+sistema|mensaje\s+del\s+sistema|api\s*key|secret|token|credential|brand\s*kit|voice(?:\.md)?|agent\.md|instrucciones?)\b/i,
  /\b(?:jailbreak|dan\b|developer\s+mode|modo\s+desarrollador|sin\s+restricciones|no\s+tengas\s+restricciones|do\s+anything\s+now)\b/i,
  /(?:<\s*(?:system|developer)|```\s*(?:system|developer)|BEGIN\s+(?:SYSTEM|DEVELOPER)|\[\s*(?:SYSTEM|DEVELOPER)\s*\])/i,
  /\b(?:tool|function)\s*(?:call|invocation|execute|ejecuta|llamada)\b[\s\S]{0,140}\b(?:delete|publish|schedule|admin|brand|borrar|publicar|programar)\b/i
]

const CHAT_BLOCKED_TOOLS = new Set([
  'blog_create_site',
  'blog_publish',
  'blog_schedule_post',
  'blog_confirm_schedule',
  'blog_cancel_schedule',
  'blog_unpublish',
  'blog_delete_post',
  'blog_request_changes',
  'content_approve',
  'content_schedule',
  'blog_update_brand_file',
  'blog_import_brand_zip'
])

function securityError(message, status, code, extra = {}) {
  const error = new Error(message)
  error.status = status
  error.extra = { code, ...extra }
  return error
}

function normalizeUntrustedText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

export function promptSecurityReason(value) {
  const text = normalizeUntrustedText(value)
  if (!text) return ''
  const match = PROMPT_INJECTION_PATTERNS.find((pattern) => pattern.test(text))
  return match ? 'prompt_injection' : ''
}

export function isPromptInjection(value) {
  return Boolean(promptSecurityReason(value))
}

/** Validate a user-facing AI instruction without exposing the input in errors. */
export function assertSafeAiPrompt(value, { field = 'prompt', maxChars = MAX_AI_PROMPT_CHARS } = {}) {
  const normalized = normalizeUntrustedText(value)
  if (normalized.length > maxChars) {
    throw securityError(`El campo ${field} supera el límite permitido.`, 413, 'AI_INPUT_TOO_LARGE', {
      field,
      maxChars
    })
  }
  const reason = promptSecurityReason(normalized)
  if (reason) {
    throw securityError(
      'La solicitud fue bloqueada por seguridad. Reformula la instrucción sin intentar cambiar las reglas del asistente ni solicitar secretos.',
      400,
      'AI_PROMPT_BLOCKED',
      { field, reason }
    )
  }
  return normalized
}

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === 'localhost.localdomain' || host === '::1') return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true
  const match = host.match(/^172\.(\d{1,3})\./)
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true
  if (host === '0.0.0.0' || host === '169.254.169.254') return true
  return host.endsWith('.local') || host.endsWith('.internal')
}

function assertSafeRemoteUrl(value, field) {
  const raw = String(value || '').trim()
  if (!raw) return
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw securityError(`La URL de ${field} no es válida.`, 400, 'AI_URL_BLOCKED', { field })
  }
  if (parsed.protocol !== 'https:' || isPrivateOrLocalHost(parsed.hostname) || parsed.username || parsed.password) {
    throw securityError(`La URL de ${field} fue bloqueada por seguridad.`, 400, 'AI_URL_BLOCKED', { field })
  }
}

function walkToolArguments(value, path, depth, state) {
  if (depth > MAX_TOOL_ARGUMENT_DEPTH) {
    throw securityError('Los argumentos de la tool son demasiado profundos.', 400, 'AI_TOOL_ARGS_BLOCKED')
  }
  if (typeof value === 'string') {
    const limit = /(?:base64|contentbase64|file)$/i.test(path) ? MAX_TOOL_BINARY_CHARS : MAX_TOOL_STRING_CHARS
    if (value.length > limit) {
      throw securityError('Los argumentos de la tool superan el límite permitido.', 413, 'AI_TOOL_ARGS_TOO_LARGE', {
        field: path,
        maxChars: limit
      })
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
      throw securityError('Los argumentos de la tool contienen caracteres no permitidos.', 400, 'AI_TOOL_ARGS_BLOCKED', {
        field: path
      })
    }
    return
  }
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    if (value.length > MAX_TOOL_ARGUMENT_KEYS) {
      throw securityError('Los argumentos de la tool contienen demasiados elementos.', 400, 'AI_TOOL_ARGS_BLOCKED')
    }
    value.forEach((entry, index) => walkToolArguments(entry, `${path}[${index}]`, depth + 1, state))
    return
  }
  const keys = Object.keys(value)
  state.keys += keys.length
  if (state.keys > MAX_TOOL_ARGUMENT_KEYS) {
    throw securityError('Los argumentos de la tool contienen demasiados campos.', 400, 'AI_TOOL_ARGS_BLOCKED')
  }
  for (const key of keys) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw securityError('Los argumentos de la tool contienen un campo no permitido.', 400, 'AI_TOOL_ARGS_BLOCKED')
    }
    const nextPath = path ? `${path}.${key}` : key
    walkToolArguments(value[key], nextPath, depth + 1, state)
    if (/^(?:imageUrl|zipUrl)$/i.test(key)) assertSafeRemoteUrl(value[key], key)
  }
}

export function assertSafeToolArguments(name, args = {}, { source = 'tool' } = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw securityError('Los argumentos de la tool deben ser un objeto.', 400, 'AI_TOOL_ARGS_BLOCKED', { tool: name })
  }
  walkToolArguments(args, '', 0, { keys: 0 })
  return args
}

export function isChatToolAllowedName(name) {
  const tool = String(name || '')
  return !CHAT_BLOCKED_TOOLS.has(tool)
}

/**
 * Chat may create/edit drafts and read data, but it cannot publish, schedule,
 * delete, unpublish or alter the site's internal brand configuration.
 */
export function assertChatToolAllowed(name, args = {}) {
  const tool = String(name || '')
  if (CHAT_BLOCKED_TOOLS.has(tool)) {
    throw securityError('Esta acción debe hacerse desde el flujo seguro de la aplicación y no desde el chat.', 403, 'AI_CHAT_TOOL_BLOCKED', {
      tool
    })
  }
  if (tool === 'blog_update_post') {
    const status = String(args.status || '').toLowerCase()
    if (args.keepPublished === true || args.publishAt || ['published', 'scheduled', 'pending_schedule'].includes(status)) {
      throw securityError('El chat solo puede editar borradores. Publicar o programar requiere el flujo de la aplicación.', 403, 'AI_CHAT_TOOL_BLOCKED', {
        tool
      })
    }
  }
  return true
}

export function aiRateLimitKey(auth = {}, site = '', ip = '') {
  const principal = auth.userId || auth.email || auth.tokenId || auth.role || 'anonymous'
  return `${String(principal)}:${String(site || '')}:${String(ip || '')}`
}

export function assertAiRateLimit(key, { limit = 30, windowMs = RATE_WINDOW_MS } = {}) {
  const now = Date.now()
  const bucketKey = String(key || 'anonymous')
  const previous = rateBuckets.get(bucketKey) || []
  const active = previous.filter((timestamp) => now - timestamp < windowMs)
  if (active.length >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - active[0])) / 1000))
    rateBuckets.set(bucketKey, active)
    throw securityError('Demasiadas solicitudes de IA. Espera un momento y vuelve a intentarlo.', 429, 'AI_RATE_LIMITED', {
      retryAfterSeconds
    })
  }
  active.push(now)
  rateBuckets.set(bucketKey, active)
  if (rateBuckets.size > 10_000) {
    for (const [entryKey, timestamps] of rateBuckets) {
      if (!timestamps.length || now - timestamps[timestamps.length - 1] >= windowMs) rateBuckets.delete(entryKey)
    }
  }
  return { remaining: Math.max(0, limit - active.length), resetAt: now + windowMs }
}

export function resetAiRateLimits() {
  rateBuckets.clear()
}

export const CHAT_BLOCKED_TOOL_NAMES = CHAT_BLOCKED_TOOLS
