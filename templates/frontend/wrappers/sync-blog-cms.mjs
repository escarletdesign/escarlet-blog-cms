/**
 * Delegado estable. El sync real lo baja el CMS en cada build.
 */
import { runCli } from './escarlet-blog.mjs'

await runCli(['sync'])
