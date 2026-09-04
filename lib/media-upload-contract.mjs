export const MEDIA_UPLOAD_TOOL = 'blog_upload_media'

export const MEDIA_UPLOAD_CONTRACT = {
  tool: MEDIA_UPLOAD_TOOL,
  version: '2.1.0',
  preferred: 'contentBase64',
  kinds: ['post', 'social', 'reference'],
  kindPost: 'Portada del artículo',
  kindSocial: 'Slide del carrusel Instagram',
  kindReference: 'Foto de moodboard',
  maxUncompressedMb: 12,
  chatgptPngMb: '2-3',
  chunkCharLimit: 120000,
  rules: [
    'Para imágenes generadas en ChatGPT usa contentBase64. Lee el PNG de /mnt/data y envía los bytes en base64.',
    'Un PNG de 2 a 3 MB vale. El CMS lo comprime a JPEG y devuelve media.url.',
    'No busques una URL https temporal. ChatGPT no publica esos PNG.',
    'Nunca pases /mnt/data, sandbox: ni file:// en imageUrl.',
    'kind post = portada. kind social = slide Instagram. kind reference = moodboard.',
    'Si el host recorta el base64, repite la tool con el mismo uploadId y chunkIndex 0, 1, 2. Cada trozo cabe en 120000 caracteres.',
    'imageUrl solo si ya tienes un https público real (CDN). Es el camino raro, no el preferido.',
    'Si AGENT.md u otra nota dice lo contrario, gana este contrato.'
  ]
}

export function mediaUploadMarkdown() {
  return [
    '## Contrato de subida (manda sobre AGENT.md)',
    'Tool. blog_upload_media.',
    'Camino normal. contentBase64 con el PNG o JPG. 2 a 3 MB valen.',
    'kind. post (portada), social (Instagram), reference (moodboard).',
    'El CMS comprime a JPEG y responde media.url. Esa URL va al post o a instagramSlides.',
    'Prohibido. imageUrl con /mnt/data. Buscar una URL pública temporal. Evitar contentBase64 por tamaño.',
    'Si el base64 se corta. uploadId, chunkIndex y chunkCount como texto. Trozos de hasta 120000 caracteres.'
  ].join('\n')
}

export function withMediaUploadContract(markdown) {
  const raw = String(markdown || '')
  if (raw.includes('Contrato de subida (manda sobre AGENT.md)')) return raw
  return [mediaUploadMarkdown(), raw].filter(Boolean).join('\n\n')
}
