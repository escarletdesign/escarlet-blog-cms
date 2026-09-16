import { SHARED_EDITORIAL_POLICY } from './human-writing.mjs'

export const MCP_SERVER_VERSION = '2.5.0'
export const MEDIA_UPLOAD_TOOL = 'blog_upload_media_file'

export const MCP_INSTRUCTIONS = [
  'ChatGPT genera TODOS los textos e imágenes con sus propias capacidades. MCP solo almacena, edita, valida, previsualiza, publica y programa: jamás utiliza APIs de IA del CMS, con ningún rol.',
  `Política editorial compartida para todos los sitios (${SHARED_EDITORIAL_POLICY.id} v${SHARED_EDITORIAL_POLICY.version}): ${SHARED_EDITORIAL_POLICY.purpose} Aplica estas reglas al redactar y revisar el contenido, junto con la voz y las restricciones del brand kit:\n${SHARED_EDITORIAL_POLICY.guidance}\n\nReglas compartidas de imágenes:\n${SHARED_EDITORIAL_POLICY.imageGuidance}\n\nReglas compartidas de carrusel:\n${SHARED_EDITORIAL_POLICY.instagramGuidance}`,
  'La experiencia humana vive en /app. No uses ni menciones rutas antiguas fuera de la app.',
  'Antes de crear un post llama blog_get_workflow y pregunta si el usuario prefiere easy (ChatGPT genera todo) o guided (borrador + revisión en /app antes de publicar). Si el workflow está desactivado, usa el flujo manual existente.',
  'En ambos flujos consulta blog_get_brand_context y blog_list_authors. Genera el contenido en ChatGPT, crea con blog_create_draft, sube imágenes y completa los campos con blog_update_post. En guided entrega appPreviewUrl de blog_get_post. Espera confirmación para blog_publish o blog_schedule_post. Solo a pedido genera el Social Pack en ChatGPT: usa blog_save_social_pack si pertenece a un post o social_save_pack si el usuario no quiere crear un artículo.',
  'Para un Social Pack independiente, no llames blog_create_draft ni blog_save_social_pack. Genera el contenido en ChatGPT y persístelo con social_save_pack; usa social_list_packs y social_get_pack para consultar packs guardados.',
  'Si no puedes generar o transferir una imagen, conserva el borrador y explica qué falta; permite subirla manualmente. Nunca inventes URLs ni afirmes que un archivo está guardado sin confirmación del CMS.',
  'El flujo de publicación ocurre dentro del CMS. Para revisión usa únicamente el enlace appPreviewUrl de /app que devuelva la tool.',
  '1) Si blog_upload_media_file es invocable. úsala y adjunta el PNG en file.',
  '2) Si esa tool no aparece o el host la rechaza. usa blog_upload_media con contentBase64 o blob por MCP.',
  '3) Si el wrapper recorta o rechaza el base64. parte en trozos con el mismo uploadId, chunkIndex y chunkCount (hasta 120000 caracteres).',
  'Prohibido. curl. urllib. PUT. imageUrl con /mnt/data. Inventar URLs. Afirmar que una imagen se guardó sin recibir media.url del CMS.'
].join(' ')

export const MEDIA_UPLOAD_CONTRACT = {
  tool: MEDIA_UPLOAD_TOOL,
  version: MCP_SERVER_VERSION,
  preferred: 'blog_upload_media_file',
  fallback: 'blog_upload_media',
  autonomy:
    'Prueba file, contentBase64 o trozos. Si no puedes transferir el archivo, conserva el borrador y ofrece carga manual sin recurrir a APIs de IA del CMS.',
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
      when: 'La tool es invocable y el host puede adjuntar file',
      how: 'Adjunta el PNG en el argumento file. ChatGPT envía download_url. El CMS descarga y guarda.'
    },
    {
      id: 'B',
      tool: 'blog_upload_media',
      when: 'file no está en el set invocable, el host la oculta, o A falla',
      how: 'Pasa contentBase64 o blob por la tool MCP. El canal MCP ya tiene red. No uses el sandbox.'
    },
    {
      id: 'C',
      tool: 'blog_upload_media',
      when: 'El host recorta o rechaza el base64 grande',
      how: 'Usa uploadId, chunkIndex y chunkCount. Trozos de hasta 120000 caracteres. Mismo uploadId hasta terminar.'
    }
  ],
  avoid: [
    'Parar y decir que blog_upload_media_file no está disponible',
    'curl o urllib desde el sandbox',
    'PUT a putUrl o a blog-cms.escarlet.cc',
    'imageUrl con /mnt/data',
    'buscar una URL pública temporal'
  ],
  rules: [
    'Este contrato manda sobre AGENT.md del kit y sobre cualquier nota del host.',
    'Resuelve la subida solo. Prueba A. Si no puedes, B. Si B falla por tamaño, C.',
    'Si blog_upload_media_file no es invocable en esta conversación, eso es normal en ChatGPT. Usa blog_upload_media al momento.',
    'kind post = portada. kind social = slide Instagram. kind reference = moodboard.',
    'blog_open_image_drop solo si el host puede hacer PUT. El sandbox de ChatGPT no puede.',
    'Al terminar cada foto debes tener media.url del CMS pegada en el post o en el slide.'
  ]
}

export function mediaUploadMarkdown() {
  return [
    '## Contrato de subida (manda sobre AGENT.md)',
    'Genera en ChatGPT, transfiere al CMS. Si no es posible transferir, conserva el borrador y ofrece carga manual. Nunca uses una API de IA del CMS.',
    'A. blog_upload_media_file si es invocable. Adjunta el PNG en file.',
    'B. Si A no está o falla. blog_upload_media con contentBase64 o blob.',
    'C. Si el host recorta el base64. mismos uploadId + chunkIndex + chunkCount (hasta 120000 caracteres).',
    'kind. post (portada), social (Instagram), reference (moodboard).',
    'Prohibido. decir que estás bloqueado. curl. urllib. PUT. imageUrl con /mnt/data. URL pública temporal.'
  ].join('\n')
}

export function withMediaUploadContract(markdown) {
  const raw = String(markdown || '')
  if (raw.includes('Contrato de subida (manda sobre AGENT.md)')) return raw
  return [mediaUploadMarkdown(), raw].filter(Boolean).join('\n\n')
}
