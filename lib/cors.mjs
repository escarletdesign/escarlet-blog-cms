function configuredOrigins() {
  return String(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((value) => {
    try { return new URL(value.trim()).origin } catch { return '' }
  }).filter(Boolean)
}

function defaultOrigins() {
  const origins = []
  if (process.env.CMS_PUBLIC_URL) {
    try { origins.push(new URL(process.env.CMS_PUBLIC_URL).origin) } catch {}
  }
  if (process.env.NODE_ENV !== 'production') {
    const port = Number(process.env.PORT || 4173)
    origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`)
  }
  return origins
}

export function allowedOrigin(req) {
  const origin = String(req?.headers?.origin || '').trim()
  if (!origin) return ''
  const allowed = configuredOrigins()
  return (allowed.length ? allowed : defaultOrigins()).includes(origin) ? origin : ''
}

export function applyCors(res, req, { credentials = true } = {}) {
  const origin = allowedOrigin(req)
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Request-Id')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  return origin
}
