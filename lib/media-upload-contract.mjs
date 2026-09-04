export const MCP_SERVER_VERSION = '2.3.0'
export const MEDIA_UPLOAD_TOOL = 'blog_upload_media_file'

export const MCP_INSTRUCTIONS = [
  'Fotos. llama blog_upload_media_file y adjunta el PNG en file. ChatGPT rellena download_url. El CMS descarga. No hagas curl, urllib ni PUT. El sandbox no tiene DNS.',
  'Si file no está disponible. blog_upload_media con contentBase64 por MCP. Si el host recorta, uploadId + chunkIndex + chunkCount.',
  'kind post = portada. kind social = Instagram. Prohibido imageUrl con /mnt/data.'
].join(' ')

export const MEDIA_UPLOAD_CONTRACT = {
  tool: MEDIA_UPLOAD_TOOL,
  version: MCP_SERVER_VERSION,
  preferred: 'blog_upload_media_file',
  chatgptPluginPageVersion:
    'La ficha de ChatGPT puede mostrar 1.0.0. Eso es el catálogo del conector, no la versión del MCP. La versión real es mediaUpload.version.',
  kinds: ['post', 'social', 'reference'],
  kindPost: 'Portada del artículo',
  kindSocial: 'Slide del carrusel Instagram',
  kindReference: 'Foto de moodboard',
  maxUncompressedMb: 12,
  chatgptPngMb: '2-3',
  chunkCharLimit: 120000,
  methods: [
    {
      id: 'A',
      tool: 'blog_upload_media_file',
      how: 'Adjunta el PNG en el argumento file. ChatGPT envía download_url. El CMS descarga y guarda. El sandbox no hace red.'
    },
    {
      id: 'B',
      tool: 'blog_upload_media',
      how: 'Pasa contentBase64 o blob por la tool MCP. El canal MCP ya tiene red. No uses el sandbox.'
    },
    {
      id: 'C',
      tool: 'blog_upload_media',
      how: 'Si el host recorta el base64, usa uploadId, chunkIndex y chunkCount. Trozos de hasta 120000 caracteres.'
    }
  ],
  avoid: [
    'curl o urllib desde el sandbox',
    'PUT a putUrl o a blog-cms.escarlet.cc',
    'imageUrl con /mnt/data',
    'buscar una URL pública temporal'
  ],
  rules: [
    'Para ChatGPT el camino es blog_upload_media_file. Adjunta el PNG en file.',
    'El CMS descarga file.download_url. No hace falta DNS en el sandbox.',
    'Si file no existe en el host, usa blog_upload_media con contentBase64 por MCP.',
    'Si el host recorta el base64, usa uploadId con chunkIndex y chunkCount.',
    'kind post = portada. kind social = slide Instagram. kind reference = moodboard.',
    'blog_open_image_drop solo si el host puede hacer PUT. El sandbox de ChatGPT no puede.',
    'Si AGENT.md u otra nota dice lo contrario, gana este contrato.'
  ]
}

export function mediaUploadMarkdown() {
  return [
    '## Contrato de subida (manda sobre AGENT.md)',
    'Tool preferida. blog_upload_media_file.',
    'ChatGPT. adjunta el PNG en file. El CMS descarga download_url y devuelve media.url.',
    'Respaldo. blog_upload_media con contentBase64 por MCP, o a trozos con uploadId.',
    'kind. post (portada), social (Instagram), reference (moodboard).',
    'Prohibido. curl. urllib. PUT desde el sandbox. imageUrl con /mnt/data. URL pública temporal.'
  ].join('\n')
}

export function withMediaUploadContract(markdown) {
  const raw = String(markdown || '')
  if (raw.includes('Contrato de subida (manda sobre AGENT.md)')) return raw
  return [mediaUploadMarkdown(), raw].filter(Boolean).join('\n\n')
}
