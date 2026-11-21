import { test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { instructions, TOOLS } from './surface.ts'

// Every session running the plugin carries these tokens. Raise a budget only
// on purpose.
test('the MCP surface stays within its size budget', () => {
  expect(instructions(true).length).toBeLessThan(1600)
  expect(instructions(false).length).toBeLessThan(200)
  expect(JSON.stringify(TOOLS).length).toBeLessThan(3000)
})

test('every advertised tool has a handler', () => {
  const server = readFileSync(join(import.meta.dir, 'server.ts'), 'utf8')
  for (const t of TOOLS) expect(server).toContain(`case '${t.name}':`)
})
