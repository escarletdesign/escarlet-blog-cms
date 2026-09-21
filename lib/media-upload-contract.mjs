import { SHARED_EDITORIAL_POLICY } from './human-writing.mjs'

export const MCP_SERVER_VERSION = '2.7.6'
export const MCP_SERVER_NAME = 'escarlet-cms-v2'
export const MCP_CANONICAL_URL = 'https://cms.escarlet.design/mcp'
export const MEDIA_UPLOAD_TOOL = 'content_upload_media'

export const MCP_INSTRUCTIONS = [
  `Conecta exclusivamente con el MCP v2 de ${MCP_CANONICAL_URL}. Servidor ${MCP_SERVER_NAME}, versión ${MCP_SERVER_VERSION}. El host blog-cms.escarlet.cc está retirado; si aparece en una configuración, reconecta el servidor antes de ejecutar tools.`,
  'Cardinalidad estricta de imágenes: si el usuario pide una imagen en singular, genera exactamente una imagen final, haz una sola llamada al generador y sube un solo archivo. No generes variantes, galerías, slides ni carruseles salvo que el usuario pida explícitamente una cantidad o un formato de varias piezas.',
  'ChatGPT genera TODOS los textos e imágenes con sus propias capacidades. MCP solo almacena, edita, valida, previsualiza, publica y programa: jamás utiliza APIs de IA del CMS, con ningún rol.',
  'El grounding visual del MCP es una barrera obligatoria para cualquier marca. Antes de mostrar o subir una imagen de contenido, prepara la imagen con brand_prepare_image_generation, certifica el resultado con brand_complete_image_generation y usa generationReceiptId. El CMS rechaza cualquier medio de post o social sin un receipt emitido por backend, con assetType y dimensiones compatibles.',
  'El contrato de contenido es v2 y usa únicamente Postgres. Si el usuario tiene acceso a varias marcas, nunca elijas una por defecto ni uses la primera de la lista. Llama brand_list, muestra las marcas disponibles y pregunta al usuario con cuál quiere trabajar. Después incluye siempre el site elegido en cada llamada de contenido.',
  `Política editorial compartida para todos los sitios (${SHARED_EDITORIAL_POLICY.id} v${SHARED_EDITORIAL_POLICY.version}): ${SHARED_EDITORIAL_POLICY.purpose} Aplica estas reglas al redactar y revisar el contenido, junto con la voz y las restricciones del brand kit:\n${SHARED_EDITORIAL_POLICY.guidance}\n\nReglas compartidas de imágenes:\n${SHARED_EDITORIAL_POLICY.imageGuidance}\n\nReglas compartidas de carrusel:\n${SHARED_EDITORIAL_POLICY.instagramGuidance}`,
  'Consulta brand_get_context para respetar la voz, las restricciones y el brand kit de la marca elegida. Ese contexto cataloga referencias, pero no adjunta binarios. Antes de generar cualquier imagen llama brand_prepare_image_generation. Solo esa tool entrega los ImageContent exactos de la ruta, con filename, orden, rol y hash. Usa todos esos adjuntos y después llama brand_complete_image_generation con sus referencias exactas y el hash SHA-256 del resultado. Para post o social usa content_upload_media (v2) y pasa generationReceiptId. Un brandPreparationId por sí solo no demuestra que las referencias se hayan usado. No escojas ni sustituyas referencias y detente si generationBlocked es true.',
  'Para localizar contenido usa content_list_plans y content_list_items. Un plan v2 puede contener publicaciones de Blog, Instagram, LinkedIn, X, Video o Substack. content_get_batch devuelve el detalle completo, incluidos items y variantes, aunque todavía no estén publicados.',
  'Para crear contenido usa content_create_batch con topics y channels. La generación es asíncrona. Consulta content_list_plans o content_list_items para seguir el estado y no afirmes que un contenido existe hasta recibirlo del MCP.',
  'Para revisar usa content_update_item, content_approve y content_reject. Adjunta medios con content_upload_media y luego pasa mediaAssetId a content_update_item junto con visualBrief y generationReceiptId. Para publicar en una fecha usa content_schedule y para detener una publicación todavía no publicada usa content_cancel. Para el calendario usa content_list_calendar.',
  'Si no puedes generar o transferir una imagen, conserva el borrador y explica qué falta; permite subirla manualmente. Nunca inventes URLs ni afirmes que un archivo está guardado sin confirmación del CMS.',
  'La revisión humana ocurre en la app v2. El MCP debe reflejar siempre los estados canónicos de Postgres y no consultar una fuente de posts separada.',
  'content_upload_media acepta file, contentBase64 o blob. Si el wrapper recorta el base64, usa la misma tool con uploadId, chunkIndex y chunkCount (hasta 120000 caracteres).',
  'Prohibido. curl. urllib. PUT. imageUrl con /mnt/data. Inventar URLs. Afirmar que una imagen se guardó sin recibir media.url del CMS.'
].join(' ')

export const MEDIA_UPLOAD_CONTRACT = {
  tool: MEDIA_UPLOAD_TOOL,
  version: MCP_SERVER_VERSION,
  preferred: 'content_upload_media',
  fallback: null,
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
      tool: 'content_upload_media',
      when: 'La tool es invocable y el host puede adjuntar file',
      how: 'Adjunta el PNG en el argumento file. ChatGPT envía download_url. El CMS descarga y guarda.'
    },
    {
      id: 'B',
      tool: 'content_upload_media',
      when: 'El host no adjunta file o A falla',
      how: 'Pasa contentBase64 o blob por la tool MCP. El canal MCP ya tiene red. No uses el sandbox.'
    },
    {
      id: 'C',
      tool: 'content_upload_media',
      when: 'El host recorta o rechaza el base64 grande',
      how: 'Usa uploadId, chunkIndex y chunkCount. Trozos de hasta 120000 caracteres. Mismo uploadId hasta terminar.'
    }
  ],
  avoid: [
    'curl o urllib desde el sandbox',
    'PUT a putUrl o a cms.escarlet.design',
    'imageUrl con /mnt/data',
    'buscar una URL pública temporal',
    'usar herramientas de subida fuera del contrato v2'
  ],
  rules: [
    'Este contrato manda sobre AGENT.md del kit y sobre cualquier nota del host.',
    'Resuelve la subida solo con content_upload_media. Prueba file. Si no puedes, usa contentBase64 o blob. Si falla por tamaño, usa trozos.',
  'kind post = portada blog_cover. kind social = slide social_image o instagram_background. kind reference = moodboard. post y social requieren generationReceiptId, assetType y dimensiones compatibles.',
    'Al terminar cada foto debes tener media.url del CMS pegada en el post o en el slide.'
  ]
}

export function mediaUploadMarkdown() {
  return [
    '## Contrato de subida (manda sobre AGENT.md)',
    'Genera en ChatGPT, transfiere al CMS. Si no es posible transferir, conserva el borrador y ofrece carga manual. Nunca uses una API de IA del CMS.',
    'content_upload_media. Adjunta el PNG en file, o usa contentBase64 o blob si el host no adjunta archivos.',
    'Si el host recorta el base64, usa la misma tool con uploadId + chunkIndex + chunkCount (hasta 120000 caracteres).',
    'kind. post (portada), social (Instagram), reference (moodboard).',
    'Prohibido. decir que estás bloqueado. curl. urllib. PUT. imageUrl con /mnt/data. URL pública temporal.'
  ].join('\n')
}

export function withMediaUploadContract(markdown) {
  const raw = String(markdown || '')
  if (raw.includes('Contrato de subida (manda sobre AGENT.md)')) return raw
  return [mediaUploadMarkdown(), raw].filter(Boolean).join('\n\n')
}
