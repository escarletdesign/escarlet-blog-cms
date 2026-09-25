import dns from 'node:dns/promises'
import net from 'node:net'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 3

function privateAddress(address) {
  const normalized = String(address || '').toLowerCase()
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127
  }
  if (net.isIPv6(normalized)) {
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
  }
  return false
}

async function assertPublicUrl(rawUrl, { allowLocalhost = false, resolveDns = true } = {}) {
  const target = new URL(rawUrl)
  if (target.protocol !== 'https:' && !(allowLocalhost && target.protocol === 'http:' && (target.hostname === 'localhost' || target.hostname === '127.0.0.1' || target.hostname === '::1'))) {
    throw Object.assign(new Error('Solo se permiten destinos HTTPS'), { code: 'unsafe_url' })
  }
  if (target.username || target.password) throw Object.assign(new Error('La URL no puede incluir credenciales'), { code: 'unsafe_url' })
  const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if ((hostname === 'localhost' || hostname.endsWith('.localhost') || privateAddress(hostname)) && !(allowLocalhost && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'))) {
    throw Object.assign(new Error('Destino de red privada bloqueado'), { code: 'unsafe_url' })
  }
  if (resolveDns && !allowLocalhost && !net.isIP(hostname)) {
    const records = await dns.lookup(hostname, { all: true, verbatim: true })
    if (!records.length || records.some(({ address }) => privateAddress(address))) {
      throw Object.assign(new Error('Destino de red privada bloqueado'), { code: 'unsafe_url' })
    }
  }
  return target
}

function signalWithTimeout(timeoutMs, upstream) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('Tiempo de espera agotado'), { code: 'timeout' })), timeoutMs)
  const abort = () => controller.abort(upstream?.reason || Object.assign(new Error('Request cancelado'), { code: 'aborted' }))
  if (upstream) {
    if (upstream.aborted) abort()
    else upstream.addEventListener('abort', abort, { once: true })
  }
  return { signal: controller.signal, cleanup: () => { clearTimeout(timer); upstream?.removeEventListener?.('abort', abort) } }
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length') || 0)
  if (declared > maxBytes) throw Object.assign(new Error('Respuesta demasiado grande'), { code: 'response_too_large', status: 413 })
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw Object.assign(new Error('Respuesta demasiado grande'), { code: 'response_too_large', status: 413 })
    return bytes
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw Object.assign(new Error('Respuesta demasiado grande'), { code: 'response_too_large', status: 413 })
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks, size)
}

export async function fetchRemote(rawUrl, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  allowLocalhost = process.env.NODE_ENV !== 'production',
  ...init
} = {}) {
  let target = await assertPublicUrl(rawUrl, { allowLocalhost, resolveDns: fetchImpl === globalThis.fetch })
  const timeout = signalWithTimeout(timeoutMs, init.signal)
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetchImpl(target, { ...init, redirect: 'manual', signal: timeout.signal })
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return { response, body: await readLimited(response, maxBytes), url: target.toString() }
      }
      if (redirects === MAX_REDIRECTS) throw Object.assign(new Error('Demasiadas redirecciones'), { code: 'too_many_redirects' })
      const location = response.headers?.get?.('location')
      if (!location) throw Object.assign(new Error('Redirección sin destino'), { code: 'unsafe_redirect' })
      target = await assertPublicUrl(new URL(location, target).toString(), { allowLocalhost, resolveDns: fetchImpl === globalThis.fetch })
    }
  } finally {
    timeout.cleanup()
  }
}

export async function fetchRemoteText(url, options = {}) {
  const result = await fetchRemote(url, options)
  return { ...result, text: result.body.toString('utf8') }
}

export { assertPublicUrl, privateAddress }
