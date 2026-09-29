import { SHARED_EDITORIAL_POLICY } from './human-writing.mjs'

export const MCP_SERVER_VERSION = '3.5.1'
export const MCP_SERVER_NAME = 'escarlet-cms-v2'
export const MCP_CANONICAL_URL = 'https://cms.escarlet.design/mcp'
export const MEDIA_UPLOAD_TOOL = 'content_upload_media'

export const MCP_INSTRUCTIONS = [
  `Conecta exclusivamente con el MCP v2 de ${MCP_CANONICAL_URL}. Servidor ${MCP_SERVER_NAME}, versión ${MCP_SERVER_VERSION}. El host blog-cms.escarlet.cc está retirado; si aparece en una configuración, reconecta el servidor antes de ejecutar tools.`,
  'Cardinalidad estricta de imágenes: si el usuario pide una imagen en singular, genera exactamente una imagen final, haz una sola llamada al generador y sube un solo archivo. No generes variantes, galerías, slides ni carruseles salvo que el usuario pida explícitamente una cantidad o un formato de varias piezas.',
  'ChatGPT genera TODOS los textos e imágenes con sus propias capacidades. MCP solo almacena, edita, valida, previsualiza, publica y programa: jamás utiliza APIs de IA del CMS, con ningún rol.',
  'Antes de generar cualquier imagen llama brand_prepare_image_generation. La tool devuelve preparationId, assetType, expectedDimensions y todas las referencias exactas en una sola respuesta; no uses referenceIndex, Pillow ni sustituyas referencias. ChatGPT genera los píxeles finales y content_upload_media valida el preflight, normaliza las dimensiones compatibles, calcula el hash final y asocia el medio al item si ya existe.',
  'El contrato de contenido es v2 y usa únicamente Postgres. Si el usuario tiene acceso a varias marcas, nunca elijas una por defecto ni uses la primera de la lista. Llama brand_list, muestra las marcas disponibles y pregunta al usuario con cuál quiere trabajar. Después incluye siempre el site elegido en cada llamada de contenido.',
  `Política editorial compartida para todos los sitios (${SHARED_EDITORIAL_POLICY.id} v${SHARED_EDITORIAL_POLICY.version}): ${SHARED_EDITORIAL_POLICY.purpose} Aplica estas reglas al redactar y revisar el contenido, junto con la voz y las restricciones del brand kit:\n${SHARED_EDITORIAL_POLICY.guidance}\n\nReglas compartidas de imágenes:\n${SHARED_EDITORIAL_POLICY.imageGuidance}\n\nReglas compartidas de carrusel:\n${SHARED_EDITORIAL_POLICY.instagramGuidance}`,
  'Consulta brand_get_context para respetar la voz, las restricciones y el brand kit activo. Si writesBrandKit es true, persiste cambios con brand_update_file. Si es false, explica writeDeniedReason: hace falta owner o admin del espacio. La preparación visual es un snapshot de solo lectura y no modifica el kit. Antes de generar cualquier imagen llama brand_prepare_image_generation. Omite kind y expectedDimensions en content_upload_media: el CMS los deriva de preparationId. Envía las dimensiones originales en sourceDimensions para validar la proporción antes de transferir; channels e itemId solo si el item ya existe. Si no existe itemId, el CMS devuelve pendingMediaId para asociarlo después con content_attach_media. El CMS registra qué referencias entregó, pero no afirma que pueda verificar visualmente cómo se usaron.',
  'Para localizar contenido usa content_list_plans y content_list_items. Una campaña puede contener publicaciones de Blog, Instagram, Instagram Story, LinkedIn, X, Video o Substack. Las Stories se envían a Buffer como notificación con la URL canónica del Blog para completar el link sticker desde Instagram. content_get_batch devuelve el detalle completo, incluidos items y variantes, aunque todavía no estén publicados.',
  'Para crear contenido usa content_create_batch y envía el texto completo en items[].variants. Antes consulta content_list_plans. Si hay campañas activas, pregunta al usuario si quiere reutilizar una con batchId o crear otra con createNewCampaign=true. Nunca crees una campaña nueva sin esa decisión. El CMS conserva los cuerpos recibidos sin generar ni completar nada.',
  'content_upload_media y content_attach_media asocian medios y verifican todas las variantes. Cuando el item está completo pasa a generated, listo para revisión humana. Nunca se aprueba ni publica automáticamente. La aprobación humana usa content_approve. Para publicar usa content_schedule con channels, publicationDate y timezone.',
  'Si no puedes generar o transferir una imagen, conserva el borrador y explica qué falta; permite subirla manualmente. Nunca inventes URLs ni afirmes que un archivo está guardado sin confirmación del CMS.',
  'La revisión humana ocurre en la app v2. El MCP debe reflejar siempre los estados canónicos de Postgres y no consultar una fuente de posts separada.',
  'content_upload_media prioriza file nativo: el servidor descarga el archivo adjunto y completa la subida en una llamada. Base64 y chunks son mecanismos de compatibilidad; repite los mismos metadatos de preflight en cada chunk.',
  'Prohibido. curl. urllib. PUT. imageUrl con /mnt/data. Inventar URLs. Afirmar que una imagen se guardó sin recibir media.url del CMS.',
  'Para vídeo usa las tools video_* (no content_upload_media): video_create_job, video_upload_media para RAW, video_get_job para sourceUrl y contexto, video_import_external_media para el export final, video_update_job y video_list_jobs. Descript y otras herramientas de edición viven fuera del CMS; el job solo guarda provider y metadata.'
].join(' ')

export const MEDIA_UPLOAD_CONTRACT = {
  tool: MEDIA_UPLOAD_TOOL,
  version: MCP_SERVER_VERSION,
  preferred: 'content_upload_media',
  fallback: null,
  autonomy:
    'Adjunta file para transferencia nativa en una llamada. Si el host no admite archivos, usa contentBase64 o chunks con los mismos metadatos de preflight.',
  chatgptPluginPageVersion:
    'La ficha de ChatGPT puede mostrar 1.0.0. Eso es el catálogo del conector, no la versión del MCP. La versión real es mediaUpload.version.',
  kinds: ['post', 'social', 'reference'],
  kindPost: 'Portada del artículo',
  kindSocial: 'Imagen social o Story de Instagram',
  kindReference: 'Foto de moodboard',
  maxUncompressedMb: 12,
  chatgptPngMb: '2-3',
  chunkCharLimit: 120000,
  methods: [
    {
      id: 'A',
      tool: 'content_upload_media',
      when: 'El host puede adjuntar file',
      how: 'Adjunta el PNG en el argumento file. ChatGPT envía download_url. El servidor valida el preflight, descarga y guarda en una llamada.'
    },
    {
      id: 'B',
      tool: 'content_upload_media',
      when: 'El host no admite file',
      how: 'Pasa contentBase64 o blob por la tool MCP. El canal MCP ya tiene red. No uses el sandbox.'
    },
    {
      id: 'C',
      tool: 'content_upload_media',
      when: 'Solo como compatibilidad si el host no admite file ni base64 completo',
      how: 'Usa uploadId, chunkIndex y chunkCount. Trozos de hasta 120000 caracteres y los mismos metadatos de preflight en todas las llamadas.'
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
    'Resuelve la subida solo con content_upload_media. Adjunta file para transferir y guardar en una llamada. Usa contentBase64 o blob si el host no admite file. Chunks son compatibilidad y requieren los mismos metadatos en todas las llamadas.',
    'kind post = portada 3:2 sin texto embebido. kind social = carrusel 1080×1350 o Story 1080×1920 con el texto final generado en ChatGPT. kind reference = moodboard.',
    'Para post y social pasa preparationId, sourceDimensions y assetIndex. kind y expectedDimensions se derivan de preparationId y son opcionales. sourceDimensions sigue siendo necesario para validar la proporción antes de descargar. Acepta imageAlt como alias de alt. Incluye itemId y channels solo si el item ya existe. Sin itemId, no exijas channels y devuelve pendingMediaId para content_attach_media. El alt se conserva en metadata y en la variante.',
    'Si la respuesta devuelve incomplete, sigue suggestedTool y nextAction. Recupera los bodies completos con content_get_batch antes de llamar content_update_item, porque esa tool reemplaza el body completo de cada variante. Conserva todos los campos actuales y agrega los que falten; usa readyForReview=true al completar la última actualización.',
    'La normalización acepta hasta 3% de diferencia de proporción, recorta lo mínimo y guarda dimensiones originales, finales y hash recalculado.'
  ]
}

export function mediaUploadMarkdown() {
  return [
    '## Contrato de subida (manda sobre AGENT.md)',
    'Genera en ChatGPT, transfiere al CMS. Si no es posible transferir, conserva el borrador y ofrece carga manual. Nunca uses una API de IA del CMS.',
    'content_upload_media. Adjunta el PNG en file para que el servidor lo descargue y guarde en una llamada.',
    'contentBase64 o uploadId + chunkIndex + chunkCount son mecanismos de compatibilidad. Conserva los metadatos en cada chunk.',
    'kind. post (portada), social (Instagram), reference (moodboard).',
    'Prohibido. decir que estás bloqueado. curl. urllib. PUT. imageUrl con /mnt/data. URL pública temporal.'
  ].join('\n')
}

export function withMediaUploadContract(markdown) {
  const raw = String(markdown || '')
  if (raw.includes('Contrato de subida (manda sobre AGENT.md)')) return raw
  return [mediaUploadMarkdown(), raw].filter(Boolean).join('\n\n')
}
