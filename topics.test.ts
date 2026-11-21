import { test, expect, describe } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { routeOf, planClaim, findTopic, slotSuffix, type TopicRegistry } from './topics.ts'

describe('routeOf', () => {
  const dm = { id: 7, type: 'private' }
  test('private-chat messages, button taps and draft stops in a topic route', () => {
    expect(routeOf({ message: { chat: dm, message_thread_id: 3 } })).toEqual({ chat_id: '7', thread_id: 3 })
    expect(routeOf({ callback_query: { message: { chat: dm, message_thread_id: 4 } } })).toEqual({ chat_id: '7', thread_id: 4 })
    expect(routeOf({ stopped_message_generation: { chat: dm, message_thread_id: 5, draft_id: 1 } })).toEqual({ chat_id: '7', thread_id: 5 })
  })
  test('main chat, groups and other updates stay with the leader', () => {
    expect(routeOf({ message: { chat: dm } })).toBeUndefined()
    expect(routeOf({ message: { chat: { id: -100, type: 'supergroup' }, message_thread_id: 3 } })).toBeUndefined()
    expect(routeOf({ message_reaction: { chat: dm } })).toBeUndefined()
  })
})

describe('planClaim', () => {
  const alive = (live: number[]) => (e: { pid: number }) => live.includes(e.pid)
  const reg = (...topics: TopicRegistry['topics']): TopicRegistry => ({ topics })
  const t = (thread_id: number, key: string, pid: number) => ({ chat_id: '7', thread_id, key, name: key, pid })

  test('a new project gets a topic named after its directory', () => {
    expect(planClaim(reg(), '7', '/p/app', 10, alive([]))).toEqual({ kind: 'create', key: '/p/app', name: 'app' })
  })
  test('a restarted session takes back its released or orphaned topic', () => {
    expect(planClaim(reg(t(3, '/p/app', 0)), '7', '/p/app', 10, alive([])))
      .toMatchObject({ kind: 'reuse', entry: { thread_id: 3 } })
    expect(planClaim(reg(t(3, '/p/app', 99)), '7', '/p/app', 10, alive([])))
      .toMatchObject({ kind: 'reuse', entry: { thread_id: 3 } })
  })
  test('a second live session in the same project gets its own numbered topic', () => {
    expect(planClaim(reg(t(3, '/p/app', 20)), '7', '/p/app', 10, alive([20])))
      .toEqual({ kind: 'create', key: '/p/app#2', name: 'app (2)' })
  })
  test('topics of other chats and other projects are not taken', () => {
    const other = { chat_id: '8', thread_id: 4, key: '/p/app', name: 'app', pid: 0 }
    expect(planClaim(reg(other, t(5, '/p/web', 0)), '7', '/p/app', 10, alive([])).kind).toBe('create')
  })
  test('findTopic matches chat and thread', () => {
    expect(findTopic(reg(t(3, '/p/app', 1)), { chat_id: '7', thread_id: 3 })?.key).toBe('/p/app')
    expect(findTopic(reg(t(3, '/p/app', 1)), { chat_id: '8', thread_id: 3 })).toBeUndefined()
  })
})

// The hooks pick their progress slot from the files in TMPDIR; two sessions
// in different topics must not touch each other's state.
describe('keepalive slot selection', () => {
  test('an unclaimed topic context is claimed only by the session holding its message', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'tg-slots-'))
    const state = mkdtempSync(join(tmpdir(), 'tg-state-')) // no .env: no token, no network
    const now = Math.floor(Date.now() / 1000)
    const mainCtx = { chat_id: '7', session_id: 'A', timestamp: now }
    writeFileSync(join(tmp, 'telegram-active.json'), JSON.stringify(mainCtx))
    writeFileSync(join(tmp, `telegram-active${slotSuffix('7', 5)}.json`),
      JSON.stringify({ chat_id: '7', message_thread_id: 5, message_id: '42', timestamp: now }))
    const transcriptB = join(tmp, 'b.jsonl')
    writeFileSync(transcriptB, JSON.stringify({ content: '<channel source="telegram" chat_id="7" message_id="42" user="u">' }) + '\n')
    const transcriptC = join(tmp, 'c.jsonl')
    writeFileSync(transcriptC, JSON.stringify({ content: '<channel source="telegram" chat_id="7" message_id="41">' }) + '\n')
    const run = (session: string, transcript: string) => spawnSync('node', [join(import.meta.dir, 'scripts', 'telegram-typing-keepalive.cjs'), 'pre'], {
      input: JSON.stringify({ session_id: session, transcript_path: transcript, tool_name: 'Bash', tool_input: { command: 'ls', description: 'list' } }),
      env: { ...process.env, TMPDIR: tmp, TELEGRAM_STATE_DIR: state },
      timeout: 5000,
    })

    run('C', transcriptC) // same chat, another message: no claim
    expect(JSON.parse(readFileSync(join(tmp, 'telegram-active-t7_5.json'), 'utf8')).session_id).toBeUndefined()

    run('B', transcriptB)
    expect(JSON.parse(readFileSync(join(tmp, 'telegram-active-t7_5.json'), 'utf8')).session_id).toBe('B')
    expect(readFileSync(join(tmp, 'telegram-current-tool-t7_5.txt'), 'utf8')).toBe('Bash(list)')
    expect(JSON.parse(readFileSync(join(tmp, 'telegram-active.json'), 'utf8'))).toEqual(mainCtx)
    expect(existsSync(join(tmp, 'telegram-current-tool.txt'))).toBe(false)
  })
})
