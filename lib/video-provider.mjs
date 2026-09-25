export const VIDEO_PROVIDERS = Object.freeze(['descript', 'heygen', 'higgsfield', 'runway', 'manual', 'unknown'])

export function normalizeProvider(value) {
  const clean = String(value || 'unknown').trim().toLowerCase()
  return VIDEO_PROVIDERS.includes(clean) ? clean : 'unknown'
}
