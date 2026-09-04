export const MEDIA_UPLOAD_TOOL = 'blog_open_image_drop'

export const MEDIA_UPLOAD_CONTRACT = {
  tool: MEDIA_UPLOAD_TOOL,
  version: '2.2.0',
  preferred: 'blog_open_image_drop',
  kinds: ['post', 'social', 'reference'],
  kindPost: 'Portada del artículo',
  kindSocial: 'Slide del carrusel Instagram',
  kindReference: 'Foto de moodboard',
  maxUncompressedMb: 12,
  chatgptPngMb: '2-3',
  chunkCharLimit: 120000,
  rules: [
    'Para ChatGPT el camino es blog_open_image_drop. Devuelve putUrl.',
    'En el sandbox haz PUT del PNG de /mnt/data a putUrl. El cuerpo es el archivo binario, no Base64.',
    'La respuesta del PUT trae media.url. Pégala en el post o en instagramSlides.',
    'No busques una URL https temporal. ChatGPT no publica esos PNG.',
    'No uses contentBase64 ni imageUrl para fotos del sandbox.',
    'kind post = portada. kind social = slide Instagram. kind reference = moodboard.',
    'blog_upload_media queda para otros clientes MCP. ChatGPT no la usa.',
    'Si AGENT.md u otra nota dice lo contrario, gana este contrato.'
  ]
}

export function mediaUploadMarkdown() {
  return [
    '## Contrato de subida (manda sobre AGENT.md)',
    'Tool. blog_open_image_drop.',
    'ChatGPT. llama esa tool, recibe putUrl, y en el sandbox hace PUT del PNG de /mnt/data.',
    'El PUT lleva el archivo en binario. La respuesta JSON trae media.url.',
    'kind. post (portada), social (Instagram), reference (moodboard).',
    'Prohibido. Buscar una URL pública temporal. Usar imageUrl con /mnt/data. Mandar Base64 desde ChatGPT.'
  ].join('\n')
}

export function withMediaUploadContract(markdown) {
  const raw = String(markdown || '')
  if (raw.includes('Contrato de subida (manda sobre AGENT.md)')) return raw
  return [mediaUploadMarkdown(), raw].filter(Boolean).join('\n\n')
}
