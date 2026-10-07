import { SHARED_EDITORIAL_POLICY } from './human-writing.mjs'

export const MCP_SERVER_VERSION = '3.8.0'
export const MCP_SERVER_NAME = 'escarlet-cms-v2'
export const MCP_CANONICAL_URL = 'https://cms.escarlet.design/mcp'
export const MEDIA_UPLOAD_TOOL = 'content_upload_media'

export const MCP_INSTRUCTIONS = [
  `Conecta exclusivamente con el MCP v2 de ${MCP_CANONICAL_URL}. Servidor ${MCP_SERVER_NAME}, versión ${MCP_SERVER_VERSION}. El host blog-cms.escarlet.cc está retirado; si aparece en una configuración, reconecta el servidor antes de ejecutar tools.`,
  'Trabaja de forma directa. Si el pedido es claro, no preguntes por flujo guiado, campaña nueva, personajes ni dimensiones. Solo pregunta si falta una decisión, como elegir entre varias marcas.',
  `Política editorial compartida (${SHARED_EDITORIAL_POLICY.id} v${SHARED_EDITORIAL_POLICY.version}): ${SHARED_EDITORIAL_POLICY.purpose}`,
  '## Brand Consult (consulta de marca)',
  'Usa brand_list si hay varias marcas. brand_get_context entrega voz, paleta y reglas. brand_get_style_board sirve solo para inspección; al publicar, brand_prepare_image_generation entrega UN solo ImageContent (style board) más generationPrompt y negativeRules. Genera con ese grounding. No elijas referencias sueltas.',
  '## Publish Workflow (publicar en el CMS)',
  'Si el usuario pide guardar o publicar: 1) Redacta todas las variantes y content_create_batch. 2) Obtén el style board. 3) Genera cada imagen final con texto integrado. 4) content_upload_media con preparationId y metadata textRendered=true, textContent, templateId y renderedBy=chatgpt-image-generation. 5) El CMS valida, almacena y asocia el PNG sin añadir overlays. 6) Para solo cuando readyForReview=true y entrega la URL de preview. Nunca apruebes ni publiques sin pedido explícito.',
  'Matriz fija: channel=instagram usa assetType=social_image y 1080x1350; channel=instagram_story usa assetType=instagram_story y 1080x1920. No deduzcas el formato desde palabras del título o del prompt.',
  'kind reference es solo moodboard del kit; no se asocia a blog/Instagram. assetIndex empieza en 0. Adjunta file; Base64/chunks son compatibilidad.',
  'Prohibido. curl. urllib. PUT. imageUrl con /mnt/data. Inventar URLs. Afirmar que una imagen se guardó sin media.url del CMS.',
  'Para vídeo usa video_* (no content_upload_media).'
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
  kindSocial: 'Imagen social final con texto integrado por ChatGPT; el CMS la guarda tal cual',
  kindReference: 'Foto de moodboard (no asociable a contenido)',
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
    'usar herramientas de subida fuera del contrato v2',
    'asociar kind=reference a variantes blog/instagram'
  ],
  rules: [
    'Este contrato manda sobre AGENT.md del kit y sobre cualquier nota del host.',
    'Resuelve la subida solo con content_upload_media. Adjunta file para transferir y guardar en una llamada.',
    'kind post = portada 3:2 sin texto. kind social = imagen final 1080x1350 o 1080x1920 con texto integrado. kind reference = moodboard no publicable.',
    'Para post y social pasa preparationId. En social declara textRendered=true, textContent, templateId y renderedBy=chatgpt-image-generation.',
    'Si la respuesta devuelve incomplete, recupera bodies completos con content_get_batch antes de content_update_item.',
    'Las imágenes sociales finales deben conservar exactamente sus píxeles y dimensiones. La normalización solo aplica a portadas legacy.'
  ]
}

export function mediaUploadMarkdown() {
  return [
    '## Contrato de subida (manda sobre AGENT.md)',
    'Consulta de marca: brand_get_context + style board (un ImageContent). Publicación: content_create_batch → upload con preparationId.',
    'content_upload_media. En social el CMS valida y guarda tu PNG final sin añadir tipografía ni logo.',
    'kind. post (portada), social (Instagram), reference (moodboard, no asociable).',
    'Prohibido. curl. urllib. PUT. imageUrl con /mnt/data. URL pública temporal.'
  ].join('\n')
}

export function withMediaUploadContract(markdown) {
  const raw = String(markdown || '')
  if (raw.includes('Contrato de subida (manda sobre AGENT.md)')) return raw
  return [mediaUploadMarkdown(), raw].filter(Boolean).join('\n\n')
}
