/**
 * ChatGPT Apps SDK file params.
 * https://developers.openai.com/apps-sdk/build/mcp-server
 *
 * El host no manda bytes. Manda { download_url, file_id }.
 * El CMS descarga download_url. El sandbox de ChatGPT no hace HTTP.
 */

export const OPENAI_FILE_DEF = {
  type: 'object',
  properties: {
    download_url: { type: 'string' },
    file_id: { type: 'string' },
    mime_type: { type: 'string' },
    file_name: { type: 'string' }
  },
  required: ['download_url', 'file_id'],
  additionalProperties: false
}

export function openaiFileDefs() {
  return { OpenAIFile: OPENAI_FILE_DEF }
}

export function connectorFileMeta() {
  return { 'openai/fileParams': ['file'] }
}

function firstFileCandidate(payload = {}) {
  if (Array.isArray(payload.file)) return payload.file[0]
  if (payload.file) return payload.file
  if (payload.image) return payload.image
  if (payload.imageFile) return payload.imageFile
  if (payload.download_url || payload.downloadUrl) return payload
  return null
}

export function pickConnectorFile(payload = {}) {
  const item = firstFileCandidate(payload)
  if (!item) return null

  if (typeof item === 'string') {
    const raw = item.trim()
    if (/^https?:\/\//i.test(raw)) {
      return { download_url: raw, file_id: '', mime_type: '', file_name: '' }
    }
    return { sandboxPath: raw, download_url: '', file_id: '', mime_type: '', file_name: '' }
  }

  if (typeof item !== 'object') return null

  const download_url = String(item.download_url || item.downloadUrl || item.url || '').trim()
  const file_id = String(item.file_id || item.fileId || item.id || '').trim()
  const mime_type = String(item.mime_type || item.mimeType || '').trim()
  const file_name = String(item.file_name || item.fileName || item.name || '').trim()

  if (/^https?:\/\//i.test(download_url)) {
    return { download_url, file_id, mime_type, file_name }
  }

  const nestedPath = String(item.path || item.uri || '').trim()
  if (nestedPath) {
    return { sandboxPath: nestedPath, download_url: '', file_id, mime_type, file_name }
  }

  return null
}
