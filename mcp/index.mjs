#!/usr/bin/env node
/**
 * MCP v3 por stdio. Solo si Cursor corre en la misma máquina que el repo.
 * Hermes en otro servidor debe usar el MCP HTTP del CMS. Ver docs/mcp.json.example
 */
import { StdioServerTransport } from '@modelcontextprotocol/server'
import { createMcpServerV3 } from './v3/index.mjs'

const server = await createMcpServerV3({ role: 'admin' })
const transport = new StdioServerTransport()
await server.connect(transport)
