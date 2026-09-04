/**
 * Delegado estable. El generador de packs lo baja el CMS en cada build.
 */
import { runCli } from './escarlet-blog.mjs'

await runCli(['packs'])
