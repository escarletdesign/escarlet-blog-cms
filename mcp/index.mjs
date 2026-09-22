#!/usr/bin/env node
/**
 * MCP por stdio. Solo si Cursor corre en la misma máquina que el repo.
 * Hermes en otro servidor debe usar el MCP HTTP del CMS. Ver docs/mcp.json.example
 */
import { StdioServerTransport } from '@modelcontextprotocol/server'
import { createMcpServer } from './create-mcp-server.mjs'

const server = createMcpServer()
const transport = new StdioServerTransport()
await server.connect(transport)
