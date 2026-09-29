/**
 * Shared StoryScope-inspired guidance for CMS generations.
 *
 * This is an editorial quality guide, not an AI-detector evasion recipe. The
 * findings are statistical tendencies, so the model should only apply the
 * choices that serve the topic and the approved brand voice.
 */
export const STORYSCOPE_HUMAN_WRITING_GUIDANCE = [
  'Aplica una pasada de autenticidad narrativa al contenido editorial.',
  'Conserva los hechos, la intención, la audiencia, las keywords y el formato solicitados. No inventes experiencias personales, citas, datos ni fuentes.',
  'Evita patrones genéricos: moralejas explicadas varias veces, tramas o argumentos de una sola vía cuando el tema admite matices, conectores repetidos y lenguaje intercambiable.',
  'Da agencia concreta a las personas y muestra decisiones con costes, dudas, consecuencias o trade-offs cuando existan en el material.',
  'Sustituye abstracciones por detalles observables o ejemplos verificables. Usa imágenes sensoriales solo si aclaran y no repitas metáforas corporales para expresar emociones.',
  'Deja que el lector infiera parte del sentido. Mantén una conclusión clara, pero no fuerces una solución limpia cuando el asunto sea realmente ambiguo.',
  'Varía ritmo, longitud de párrafos y estructura solo cuando ayude a la comprensión. Una estructura lineal también es válida si es la adecuada para el tema.',
  'No añadas rarezas, errores, informalidad artificial ni referencias externas solo para parecer humano. El objetivo es claridad, criterio y una voz situada.',
  'Haz una segunda pasada para eliminar frases que podría firmar cualquier marca y comprueba que cada cambio siga apoyando la idea central.'
].join('\n')

// Shared editorial context for every site. Brand kits still define the local
// voice, audience and constraints; this policy defines the cross-site quality
// bar that should be present before any editorial generation takes place.
export const SHARED_EDITORIAL_POLICY = Object.freeze({
  id: 'storyscope-inspired-human-writing',
  version: '1.2',
  purpose: 'Usar los hallazgos de StoryScope como guía de calidad narrativa, nunca como receta para esquivar detectores.',
  guidance: [
    'No uses guiones horizontales, rayas, em dash, en dash ni separadores de guiones como decoración en textos visibles. Usa puntuación, subtítulos, espacio o una estructura clara.',
    STORYSCOPE_HUMAN_WRITING_GUIDANCE
  ].join('\n'),
  imageGuidance: [
    'Antes de generar cualquier imagen de cualquier tipo, consulta `brand_get_context` y llama `brand_prepare_image_generation`. Usa `referenceImages` solo como contexto informativo. Entrega exactamente sus `resolvedReferences` como ImageContent y detente si `generationBlocked` es true.',
    'Entrega al generador exactamente sus `resolvedReferences` como bloques `ImageContent`, en el orden indicado. No inventes, escojas ni sustituyas referencias.',
    'Si `generationBlocked` es true, detén la generación y comunica `missingReferences`.'
  ].join('\n'),
  instagramGuidance: [
    'ChatGPT genera el fondo limpio de cada slide de Instagram. El CMS renderiza el texto editorial guardado en la variante.',
    'Usa formato 4:5 a 1080 × 1350. Las Stories usan 9:16 a 1080 × 1920.',
    'En carruseles de Instagram, el texto debe ser legible en un móvil desde la primera lectura.',
    'Respeta las safe areas del brand kit, conserva un tamaño de titular y cuerpo suficiente y no reduzcas la tipografía para hacer encajar demasiado texto.',
    'Si el texto no cabe, acórtalo, divide la idea entre slides o crea otra composición. Nunca entregues una slide con texto diminuto o ilegible.'
  ].join('\n')
})

export function isHumanWritingOperation(operation) {
  const value = String(operation || '').trim().toLowerCase()
  return value === 'body' || value === 'humanize'
}

export function buildHumanizePrompt({ title = '', excerpt = '', body = '', instruction = '' } = {}) {
  const extra = String(instruction || '').trim()
  return [
    'Reescribe el contenido actual para que suene más humano y tenga decisiones narrativas concretas.',
    'Mantén los hechos, la intención, las keywords SEO y el sentido original. No inventes datos ni experiencias personales.',
    'Devuelve únicamente el artículo completo en Markdown, con subtítulos y párrafos. No expliques el proceso.',
    extra ? `Indicación editorial adicional: ${extra}` : '',
    `Título: ${String(title || '').trim()}`,
    `Resumen: ${String(excerpt || '').trim()}`,
    `Contenido actual:\n${String(body || '').trim()}`
  ].filter(Boolean).join('\n\n')
}
