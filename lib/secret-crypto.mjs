import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'
const MAX = 4096

function keyFromEnv(env = process.env) {
  const raw = String(env.CMS_SECRET_KEY || env.AI_CONNECTOR_ENCRYPTION_KEY || '').trim()
  if (!raw) return null
  const bytes = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'utf8')
  if (bytes.length < 32) return null
  return createHash('sha256').update(bytes).digest()
}

export function encryptSecret(value, { env = process.env } = {}) {
  const key = keyFromEnv(env)
  if (!key) throw Object.assign(new Error('CMS_SECRET_KEY es obligatorio para guardar credenciales.'), { status: 503, code: 'secret_key_required' })
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(String(value || '').slice(0, MAX), 'utf8'), cipher.final()])
  return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptSecret(value, { env = process.env } = {}) {
  const stored = String(value || '').trim().slice(0, MAX)
  if (!stored.startsWith(PREFIX)) return ''
  const key = keyFromEnv(env)
  if (!key) return ''
  const parts = stored.split(':')
  if (parts.length !== 5) return ''
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64url'))
    decipher.setAuthTag(Buffer.from(parts[3], 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64url')), decipher.final()]).toString('utf8').slice(0, MAX)
  } catch {
    return ''
  }
}
