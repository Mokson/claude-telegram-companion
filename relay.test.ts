import { test, expect, describe } from 'bun:test'
import { parseRelayCommand, paneState, extractOutput, runRelay, type RelayIO } from './relay.ts'

const BORDER = '─'.repeat(80)
const STATUS = ['  personal | ⎇ main | Opus 5.5 [med] | c:? | s:11%[4h6m] w:15%[6d]', '  ⏵⏵ auto mode on (shift+tab to cycle)']
const prompt = (input = '') => [BORDER, `❯ ${input}`, BORDER, ...STATUS]

// Shapes captured from Claude Code 2.1.323 in tmux.
const EFFORT_SCREEN = [
  '❯ /clear',
  '',
  '❯ /effort medium',
  '  ⎿  Set effort level to medium (saved as your default for new sessions):',
  '     Balanced approach with standard implementation and testing',
  '                    ◐ medium · /effort · ✔ Update installed · Restart to apply',
  ...prompt(),
].join('\n')

const COST_SCREEN = [
  '❯ /clear',
  '▔'.repeat(80),
  '   Settings  Status   Config   Usage   Stats',
  '   Session',
  '   Total cost:            $0.0000',
  '   Current session',
  '   ██████▌                                            13% used',
  '   Resets 1pm (Europe/Lisbon)',
].join('\n')

const BUSY_SCREEN = ['❯ do the thing', '✻ Working… (12s · esc to interrupt)', ...prompt()].join('\n')

describe('parseRelayCommand', () => {
  test('allowlisted commands parse with their mode', () => {
    expect(parseRelayCommand('/clear', 'bot')).toEqual({ command: '/clear', mode: 'clear' })
    expect(parseRelayCommand('/context', 'bot')).toEqual({ command: '/context', mode: 'inline' })
    expect(parseRelayCommand('/cost', 'bot')).toEqual({ command: '/cost', mode: 'dialog' })
    expect(parseRelayCommand('/usage', 'bot')).toEqual({ command: '/usage', mode: 'dialog' })
    expect(parseRelayCommand(' /Model sonnet ', 'bot')).toEqual({ command: '/model sonnet', mode: 'inline' })
    expect(parseRelayCommand('/effort high', 'bot')).toEqual({ command: '/effort high', mode: 'inline' })
    expect(parseRelayCommand('/compact keep the open questions', 'bot'))
      .toEqual({ command: '/compact keep the open questions', mode: 'compact' })
  })

  test('@mention of this bot is accepted, another bot is not', () => {
    expect(parseRelayCommand('/clear@MyBot', 'mybot')).toEqual({ command: '/clear', mode: 'clear' })
    expect(parseRelayCommand('/clear@OtherBot', 'mybot')).toBeNull()
    expect(parseRelayCommand('/stop@MyBot', 'mybot')).toEqual({ command: '/stop', mode: 'stop' })
    expect(parseRelayCommand('/stop@OtherBot', 'mybot')).toBeNull()
  })

  test('C1 controls and line separators are refused', () => {
    expect(parseRelayCommand('/compact a\u009bb', 'bot')).toBeNull()
    expect(parseRelayCommand('/compact a b', 'bot')).toBeNull()
  })

  test('pickers, unknown and dangerous commands are refused', () => {
    for (const t of ['/model', '/effort', '/resume', '/fast', '/permissions', '/plugin install x',
      '/mcp', '/clear now', '/context all', 'clear', 'please /clear'])
      expect(parseRelayCommand(t, 'bot')).toBeNull()
  })

  test('arguments that could smuggle keys or text are refused', () => {
    expect(parseRelayCommand('/compact a\nb', 'bot')).toBeNull()
    expect(parseRelayCommand('/compact a\x1b[A', 'bot')).toBeNull()
    expect(parseRelayCommand('/model sonnet; rm -rf ~', 'bot')).toBeNull()
    expect(parseRelayCommand('/model opus two', 'bot')).toBeNull()
    expect(parseRelayCommand(`/compact ${'x'.repeat(501)}`, 'bot')).toBeNull()
  })
})

describe('paneState', () => {
  test('idle prompt is ready, spinner is busy, open dialog is blocked', () => {
    expect(paneState(EFFORT_SCREEN)).toBe('ready')
    expect(paneState(BUSY_SCREEN)).toBe('busy')
    expect(paneState(COST_SCREEN)).toBe('blocked')
  })

  test('busy words in an echo or in output are not a spinner', () => {
    const screen = ['❯ /compact keep Compacting conversation notes', '  ⎿  Compacted; esc to interrupt was quoted', ...prompt()].join('\n')
    expect(paneState(screen)).toBe('ready')
  })
})

describe('extractOutput', () => {
  test('inline output sits between the echo and the prompt, status line dropped', () => {
    expect(extractOutput(EFFORT_SCREEN, { command: '/effort medium', mode: 'inline' })).toBe(
      'Set effort level to medium (saved as your default for new sessions):\n     Balanced approach with standard implementation and testing',
    )
  })

  test('dialog output is the panel under its top edge', () => {
    const out = extractOutput(COST_SCREEN, { command: '/cost', mode: 'dialog' })!
    expect(out.startsWith('Settings  Status')).toBe(true)
    expect(out).toContain('Total cost:            $0.0000')
    expect(out).not.toContain('/clear')
  })

  test('no echo of the command means no output', () => {
    expect(extractOutput(EFFORT_SCREEN, { command: '/context', mode: 'inline' })).toBeUndefined()
  })

  test('output is found with notice rows under the prompt box', () => {
    const screen = ['❯ /model sonnet', '  ⎿  Set model to Sonnet 5.5', ...prompt(), ...Array(9).fill('  some notice row')].join('\n')
    expect(paneState(screen)).toBe('ready')
    expect(extractOutput(screen, { command: '/model sonnet', mode: 'inline' })).toBe('Set model to Sonnet 5.5')
  })

  test("an earlier run's echo is not taken for the new run's output", () => {
    const old = ['❯ /model sonnet', '  ⎿  Set model to Sonnet 5.5', ...prompt()].join('\n')
    const spec = { command: '/model sonnet', mode: 'inline' } as const
    expect(extractOutput(old, spec, 1)).toBeUndefined()
    const fresh = ['❯ /model sonnet', '  ⎿  Set model to Sonnet 5.5', '❯ /model sonnet', '  ⎿  Kept model as Sonnet 5.5', ...prompt()].join('\n')
    expect(extractOutput(fresh, spec, 1)).toBe('Kept model as Sonnet 5.5')
  })

  test('/model opus does not match an echo of /model opusplan', () => {
    const screen = ['❯ /model opusplan', '  ⎿  Set model to Opus Plan', ...prompt()].join('\n')
    expect(extractOutput(screen, { command: '/model opus', mode: 'inline' })).toBeUndefined()
  })
})

describe('runRelay', () => {
  function fakeIO(screens: string[]) {
    const sent: string[] = []
    let i = 0
    const io: RelayIO = {
      sendText: t => { sent.push(`text:${t}`) },
      sendKeys: (...k) => { sent.push(...k) },
      capture: () => screens[Math.min(i++, screens.length - 1)]!,
      sleep: async () => {},
    }
    return { io, sent }
  }

  test('a busy pane gets no keys', async () => {
    const { io, sent } = fakeIO([BUSY_SCREEN])
    expect(await runRelay({ command: '/clear', mode: 'clear' }, io)).toEqual({ status: 'busy' })
    expect(sent).toEqual([])
  })

  test('a dialog left open gets no keys', async () => {
    const { io, sent } = fakeIO([COST_SCREEN])
    expect(await runRelay({ command: '/clear', mode: 'clear' }, io)).toEqual({ status: 'blocked' })
    expect(sent).toEqual([])
  })

  test('dialog command is typed, captured, then closed with Esc', async () => {
    const { io, sent } = fakeIO([EFFORT_SCREEN, EFFORT_SCREEN, COST_SCREEN, EFFORT_SCREEN])
    const r = await runRelay({ command: '/cost', mode: 'dialog' }, io)
    expect(r.status).toBe('done')
    expect(sent).toEqual(['text:/cost', 'Enter', 'Enter', 'Escape'])
  })

  test('an ignored Esc is retried until the prompt is back', async () => {
    const { io, sent } = fakeIO([EFFORT_SCREEN, EFFORT_SCREEN, COST_SCREEN, COST_SCREEN, EFFORT_SCREEN])
    await runRelay({ command: '/cost', mode: 'dialog' }, io)
    expect(sent.filter(k => k === 'Escape')).toHaveLength(2)
  })

  test('no further Esc once the panel is gone, even if a turn started', async () => {
    const { io, sent } = fakeIO([EFFORT_SCREEN, EFFORT_SCREEN, COST_SCREEN, BUSY_SCREEN])
    await runRelay({ command: '/cost', mode: 'dialog' }, io)
    expect(sent.filter(k => k === 'Escape')).toHaveLength(1)
  })

  test('the ⎿ marker with a no-break space is stripped', () => {
    const screen = ['❯ /context', '  ⎿  Context usage', ...prompt()].join('\n')
    expect(extractOutput(screen, { command: '/context', mode: 'inline' })).toBe('Context usage')
  })

  test('compact waits out the spinner before reporting', async () => {
    const done = [...EFFORT_SCREEN.split('\n').slice(0, 2), '❯ /compact', '  ⎿  Compacted', ...prompt()].join('\n')
    const { io } = fakeIO([EFFORT_SCREEN, EFFORT_SCREEN, BUSY_SCREEN, BUSY_SCREEN, done])
    let started = false
    const r = await runRelay({ command: '/compact', mode: 'compact' }, io, () => { started = true })
    expect(started).toBe(true)
    expect(r).toEqual({ status: 'done', output: 'Compacted' })
  })

  test('compact that never finishes times out', async () => {
    const { io } = fakeIO([EFFORT_SCREEN, BUSY_SCREEN])
    expect(await runRelay({ command: '/compact', mode: 'compact' }, io, undefined, 9000)).toEqual({ status: 'timeout' })
  })
})
