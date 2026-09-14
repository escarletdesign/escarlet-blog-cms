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
