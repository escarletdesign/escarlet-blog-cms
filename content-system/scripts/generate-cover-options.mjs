#!/usr/bin/env node
import { buildCoverBrief, buildCoverPrompt } from '../../lib/visual-system.mjs'

function args(argv) {
  return Object.fromEntries(argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, '').split('=')
    return [key, rest.join('=') || true]
  }))
}

const input = args(process.argv)
const brief = buildCoverBrief({
  site: String(input.site || 'escarlet'),
  title: String(input.title || ''),
  summary: String(input.summary || ''),
  topic: String(input.topic || ''),
  mode: input.mode === 'exploration' ? 'exploration' : 'automatic',
  preferredArchetype: String(input.archetype || '')
})
const output = { brief, prompt: buildCoverPrompt(brief) }
if (input.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
else {
  console.log(`Arquetipo: ${brief.archetype}`)
  console.log(`Referencias: ${brief.references.join(', ') || 'ninguna'}`)
  console.log(`Motivo: ${brief.decision.reason}`)
  console.log('\nPROMPT\n')
  console.log(output.prompt)
}
