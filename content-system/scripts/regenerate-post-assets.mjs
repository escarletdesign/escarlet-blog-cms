#!/usr/bin/env node
import { getPost } from '../../lib/cms-ops.mjs'
import { generatePostImageForPost, generateSocialPackForPost } from '../../lib/ai-workflows.mjs'
import { buildCoverBrief, buildCoverPrompt } from '../../lib/visual-system.mjs'
import { invokeMcpTool } from '../../mcp/create-mcp-server.mjs'

function args(argv) {
  return Object.fromEntries(argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, '').split('=')
    return [key, rest.join('=') || true]
  }))
}

const input = args(process.argv)
const site = String(input.site || 'escarlet')
const slug = String(input.slug || '')
if (!slug) throw new Error('Falta --slug=mi-post')
const current = (await getPost(site, slug)).post
const brief = buildCoverBrief({ site, title: current.title, summary: current.excerptEs, topic: current.title, mode: 'automatic' })
const plan = { site, slug, cover: { action: input.cover === 'false' ? 'skip' : 'regenerate', brief, prompt: buildCoverPrompt(brief) }, social: { action: input.social === 'false' ? 'skip' : 'regenerate' } }
if (input['dry-run'] || !input.execute) {
  console.log(JSON.stringify({ dryRun: true, plan }, null, 2))
  process.exit(0)
}

const auth = { role: 'admin' }
const result = {}
if (plan.cover.action === 'regenerate') result.cover = await generatePostImageForPost({ site, auth, slug, optionCount: 1 })
if (plan.social.action === 'regenerate') result.social = await generateSocialPackForPost({ site, auth, slug, includeImages: true })
// The MCP call keeps the decision metadata available to external agents too.
result.mcpMetadata = await invokeMcpTool('blog_update_post', { site, slug, visualBrief: brief }, auth, { source: 'mcp' })
console.log(JSON.stringify({ dryRun: false, plan, result }, null, 2))
