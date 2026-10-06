import { SHARED_EDITORIAL_POLICY } from './human-writing.mjs'

export const MCP_SERVER_VERSION = '3.6.0'
export const MCP_SERVER_NAME = 'escarlet-cms-v2'
export const MCP_CANONICAL_URL = 'https://cms.escarlet.design/mcp'
export const MEDIA_UPLOAD_TOOL = 'content_upload_media'

export const MCP_INSTRUCTIONS = [
  `Conecta exclusivamente con el MCP v2 de ${MCP_CANONICAL_URL}. Servidor ${MCP_SERVER_NAME}, versión ${MCP_SERVER_VERSION}. El host blog-cms.escarlet.cc está retirado; si aparece en una configuración, reconecta el servidor antes de ejecutar tools.`,
  'Trabaja de forma directa. Si el pedido es claro, no preguntes si prefiere flujo guiado, campaña nueva, personajes de marca ni dimensiones. Solo pregunta si falta una decisión que impida crear el contenido, como elegir entre varias marcas disponibles.',
  'Usa brand_get_context y aplica la voz, restricciones y referencias del sitio. Si hay varias marcas accesibles, usa brand_list y pregunta al usuario cuál elegir. Redacta todos los textos y variantes primero, y guárdalos completos con content_create_batch antes de generar imágenes. Una campaña nueva se crea por defecto; usa batchId solo si el usuario pidió añadir a una existente.',
  `Política editorial compartida (${SHARED_EDITORIAL_POLICY.id} v${SHARED_EDITORIAL_POLICY.version}): ${SHARED_EDITORIAL_POLICY.purpose} Aplica también la guía de voz y contenido del brand kit.`,
  'Para Instagram, guarda headline, body, alt y caption en la variante. Después genera fondos sin texto: content_upload_media compone cada slide con el texto exacto guardado. Para otros formatos sigue la composición de brand_prepare_image_generation. Una petición de imagen singular produce una sola imagen; crea varias solo si el usuario pide carrusel, story o una cantidad.',
  'Llama brand_prepare_image_generation antes de generar imágenes. Prepara una vez por item y canal; en carrusel indica expectedAssetCount y reutiliza preparationId para todos los fondos. Sube con content_upload_media y preparationId; el CMS obtiene dimensiones reales, normaliza formatos compatibles y reutiliza item y canal. assetIndex comienza en 0 y distingue las slides. Adjunta file para una sola llamada; Base64 y chunks son compatibilidad.',
  'No digas que terminó hasta que el CMS devuelva readyForReview=true. Si una subida indica que faltan slides, sube las restantes; usa nextAction solo cuando aparezca. Al final informa claramente si quedó listo para revisión o qué falta. Nunca apruebes ni publiques sin pedido explícito. content_approve aprueba y content_schedule programa.',
  'Las Stories se envían a Buffer como notificación con la URL canónica del Blog para completar el link sticker desde Instagram. Para localizar contenido usa content_list_plans y content_list_items; ese listado es un resumen. El body, los medios y el visual brief se leen con content_get_item o content_get_batch. Instagram se valida contra expectedAssetCount y los assetIndex, no contra un rango fijo de slides. El contrato v2 usa Postgres y la app v2 como fuente de estados.',
  'Si no puedes generar o transferir una imagen, conserva el borrador y explica qué falta. Nunca inventes URLs ni afirmes que un archivo se guardó sin confirmación del CMS.',
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
    'kind post = portada 3:2 sin texto. kind social Instagram = fondo 1080×1350, el CMS renderiza el texto guardado. kind reference = moodboard.',
    'Para post y social pasa preparationId. El CMS inspecciona el archivo real y deriva tipo, dimensiones, item, canal e índice 0 si preparaste esos datos antes. Acepta imageAlt como alias de alt. Sin itemId devuelve pendingMediaId para content_attach_media. El alt se conserva en metadata y en la variante.',
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
