const SOCIAL_ALIASES = new Set(['social', 'instagram', 'ig', 'carousel', 'slide', 'slides'])
const REFERENCE_ALIASES = new Set(['reference', 'ref', 'moodboard', 'brand'])

export const MEDIA_KINDS = ['post', 'social', 'reference']

export function normalizeMediaKind(kind) {
  const raw = String(kind || 'post').toLowerCase().trim()
  if (SOCIAL_ALIASES.has(raw)) return 'social'
  if (REFERENCE_ALIASES.has(raw)) return 'reference'
  return 'post'
}
