import { createHash } from 'node:crypto'

const sessions = new Map()

export const UPLOAD_CHUNK_CHAR_LIMIT = 120000
export const MAX_UPLOAD_CHUNKS = 40
export const UPLOAD_SESSION_TTL_MS = 15 * 60 * 1000

function pruneUploadSessions(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (now - session.createdAt > UPLOAD_SESSION_TTL_MS) sessions.delete(id)
  }
}

export function resetUploadSessions() {
  sessions.clear()
}

export function isChunkedUpload({ chunkCount, chunkIndex, uploadId } = {}) {
  const count = Number(chunkCount)
  const index = Number(chunkIndex)
  return Boolean(String(uploadId || '').trim()) || (Number.isInteger(count) && count > 1) || Number.isInteger(index)
}

export function collectUploadChunk({
  uploadId,
  chunkIndex = 0,
  chunkCount,
  contentBase64,
  filename = '',
  metadata = {}
} = {}) {
  pruneUploadSessions()
  const id = String(uploadId || '').trim()
  if (!id) {
    throw new Error('Para subir a trozos hace falta uploadId. Usa el mismo id en todos los trozos.')
  }
  const count = Number(chunkCount)
  const index = Number(chunkIndex)
  if (!Number.isInteger(count) || count < 2 || count > MAX_UPLOAD_CHUNKS) {
    throw new Error(`chunkCount debe ser un entero entre 2 y ${MAX_UPLOAD_CHUNKS}.`)
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`chunkIndex debe ir de 0 a ${count - 1}.`)
  }
  const piece = String(contentBase64 || '').replace(/\s/g, '')
  if (!piece) {
    throw new Error('El trozo contentBase64 está vacío.')
  }
  if (piece.length > UPLOAD_CHUNK_CHAR_LIMIT) {
    throw new Error(
      `Este trozo tiene ${piece.length} caracteres. Parte en trozos de hasta ${UPLOAD_CHUNK_CHAR_LIMIT} caracteres.`
    )
  }

  let session = sessions.get(id)
  if (!session) {
    session = {
      chunks: Array(count).fill(null),
      count,
      filename,
      metadata: JSON.stringify(metadata || {}),
      finalizedResult: null,
      createdAt: Date.now()
    }
    sessions.set(id, session)
  }
  if (session.count !== count) {
    throw new Error('chunkCount cambió a mitad de la subida. Empieza otra vez con un uploadId nuevo.')
  }
  if (session.metadata !== JSON.stringify(metadata || {})) {
    throw Object.assign(new Error('Los metadatos cambiaron a mitad de la subida. Reutiliza los metadatos iniciales o empieza con otro uploadId.'), { code: 'UPLOAD_METADATA_MISMATCH' })
  }
  if (filename) session.filename = filename

  const pieceHash = createHash('sha256').update(piece).digest('hex')
  if (session.chunkHashes) {
    if (session.chunkHashes[index] !== pieceHash) throw Object.assign(new Error('El chunk repetido no coincide con el recibido.'), { code: 'UPLOAD_CHUNK_CONFLICT' })
    return {
      complete: true,
      ...(session.finalizedResult ? { finalizedResult: session.finalizedResult } : {}),
      uploadId: id,
      received: count,
      count,
      ...(session.completedContentBase64 ? { contentBase64: session.completedContentBase64 } : {}),
      filename: session.filename || filename
    }
  }
  if (typeof session.chunks[index] === 'string' && session.chunks[index] !== piece) {
    throw Object.assign(new Error('El chunk repetido no coincide con el recibido.'), { code: 'UPLOAD_CHUNK_CONFLICT' })
  }
  session.chunks[index] = piece

  const received = session.chunks.filter((chunk) => typeof chunk === 'string').length
  const missing = []
  for (let i = 0; i < count; i += 1) {
    if (typeof session.chunks[i] !== 'string') missing.push(i)
  }
  if (missing.length) {
    return {
      complete: false,
      uploadId: id,
      received,
      count,
      nextChunkIndex: missing[0],
      missing
    }
  }

  const joined = session.chunks.join('')
  session.chunkHashes = session.chunks.map((chunk) => createHash('sha256').update(chunk).digest('hex'))
  session.completedContentBase64 = joined
  session.chunks = []
  return {
    complete: true,
    uploadId: id,
    received,
    count,
    contentBase64: joined,
    filename: session.filename || filename
  }
}

// ponytail: final upload results live for the chunk TTL; persist sessions if retries must survive a server restart.
export function rememberUploadResult(uploadId, result) {
  const session = sessions.get(String(uploadId || '').trim())
  if (!session?.completedContentBase64) return false
  session.finalizedResult = result
  session.completedContentBase64 = null
  return true
}
