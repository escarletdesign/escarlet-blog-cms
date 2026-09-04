function boundaryFromContentType(contentType = '') {
  const match = String(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  return String(match?.[1] || match?.[2] || '').trim()
}

/**
 * Parser mínimo de multipart/form-data (un archivo + campos de texto).
 * Usa latin1 para no romper bytes binarios.
 */
export function parseMultipart(buffer, contentType) {
  const boundary = boundaryFromContentType(contentType)
  if (!boundary) throw new Error('Falta el boundary del formulario.')
  const raw = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer || '')
  const pieces = raw.split(`--${boundary}`)
  const fields = {}
  let file

  for (const piece of pieces) {
    if (!piece || piece === '--' || piece === '--\r\n' || piece.startsWith('--')) continue
    const headerEnd = piece.indexOf('\r\n\r\n')
    if (headerEnd < 0) continue
    const header = piece.slice(0, headerEnd)
    let body = piece.slice(headerEnd + 4)
    if (body.endsWith('\r\n')) body = body.slice(0, -2)
    const name = (header.match(/name="([^"]+)"/i) || [])[1]
    const filenameMatch = header.match(/filename="([^"]*)"/i)
    if (!name) continue
    if (filenameMatch) {
      file = {
        field: name,
        filename: filenameMatch[1] || 'imagen.jpg',
        buffer: Buffer.from(body, 'latin1')
      }
    } else {
      fields[name] = Buffer.from(body, 'latin1').toString('utf8')
    }
  }

  return { fields, file }
}

export function isMultipartRequest(req) {
  return String(req?.headers?.['content-type'] || '').includes('multipart/form-data')
}
