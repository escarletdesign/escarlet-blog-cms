import { AsyncLocalStorage } from 'node:async_hooks'
import { CmsError } from './cms-ops-errors.mjs'
import { getPasswordUserById } from './human-auth.mjs'
import { assertCmsAiEnabled } from './product-flags.mjs'
import { readDb } from './db.mjs'

// Context is set by trusted server entrypoints, never by model/tool arguments.
// AsyncLocalStorage also follows timers/promises created inside an MCP call.
const context = new AsyncLocalStorage()
export const CMS_AI_TOOLS = new Set([
  'blog_generate_assisted_content', 'blog_create_assisted_post',
  'blog_generate_post_image', 'blog_generate_social_pack'
])
export function withGenerationPolicy(policy, callback) {
  const parent = context.getStore()
  return context.run({ ...policy, externalMcp: parent?.externalMcp || policy.externalMcp }, callback)
}
export function assertCmsAiAllowed(auth) {
  assertCmsAiEnabled({ db: readDb() })
  const policy = context.getStore()
  const actor = auth || policy?.auth
  const live = actor?.userId ? getPasswordUserById(actor.userId) : actor
  if (policy?.externalMcp || (actor?.userId && !live)) {
    throw new CmsError(403, 'ChatGPT debe generar y entregar el contenido y las imágenes. La IA del CMS no está disponible para este acceso.', { code: 'CMS_AI_FORBIDDEN' })
  }
}
