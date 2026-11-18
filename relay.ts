// Relay Claude Code built-in slash commands from Telegram into the session's
// tmux pane. A built-in arriving over the channel is plain text to Claude; it
// only runs when typed at the terminal prompt. The server types it there
// without spending a model turn, so it also works when a turn can't run
// (usage limit, full context).

// How a relayed command behaves in the terminal, checked against Claude Code:
//  - inline: prints its result above the prompt (/context, /model x, /effort x)
//  - dialog: opens a panel that waits for Esc (/cost)
//  - compact: runs for a while behind the spinner, then prints a result
//  - clear: wipes the conversation and prints nothing worth sending back
//  - stop: not typed; the server interrupts the running turn with Esc
export type RelayMode = 'inline' | 'dialog' | 'compact' | 'clear' | 'stop'
export type RelaySpec = { command: string; mode: RelayMode }

// Allowlist. Add a command only after checking in the terminal that it ends on
// one line, or in a dialog that a single Esc closes without changing anything.
// /fast is out: its dialog toggles fast mode on Enter. Pickers (/resume, /model
// with no argument) and access, permission and plugin commands stay out.
const SIMPLE: Record<string, RelayMode> = { clear: 'clear', context: 'inline', cost: 'dialog', usage: 'dialog' }
const WITH_ARG = new Set(['model', 'effort'])
const ARG_RE = /^[\w.:[\]-]{1,64}$/
const MAX_COMPACT_ARGS = 500

// Parse a message into a relay spec, or null when it is not an allowlisted
// built-in. `/cmd@bot` is accepted only for this bot.
export function parseRelayCommand(text: string, botUsername: string): RelaySpec | null {
  if (/[\x00-\x1f\x7f-\x9f\p{Zl}\p{Zp}]/u.test(text)) return null
  const m = /^\/([a-z]+)(?:@(\w+))?(?: +(.*))?$/i.exec(text.trim())
  if (!m) return null
  const [, rawName, at, rawArgs] = m
  if (at && at.toLowerCase() !== botUsername.toLowerCase()) return null
  const name = rawName!.toLowerCase()
  const args = rawArgs?.trim() ?? ''

  if (name === 'stop') return args ? null : { command: '/stop', mode: 'stop' }
  if (name in SIMPLE) return args ? null : { command: `/${name}`, mode: SIMPLE[name]! }
  if (name === 'compact') {
    if (args.length > MAX_COMPACT_ARGS) return null
    return { command: args ? `/compact ${args}` : '/compact', mode: 'compact' }
  }
  if (WITH_ARG.has(name)) return ARG_RE.test(args) ? { command: `/${name} ${args}`, mode: 'inline' } : null
  return null
}

const BORDER_RE = /^─{10,}/
const DIALOG_TOP_RE = /^▔{10,}/
const BUSY_RE = /esc to interrupt|Compacting conversation/i

function lines(screen: string): string[] {
  return screen.split('\n').map(l => l.trimEnd()).filter(l => l.trim())
}

// A spinner row, not an echoed prompt or a line of output that quotes the words.
function isSpinner(row: string): boolean {
  return !/^\s*[❯⎿]/.test(row) && BUSY_RE.test(row)
}

function dialogOpen(screen: string): boolean {
  return lines(screen).some(r => DIALOG_TOP_RE.test(r))
}

// Index of the empty-or-not input prompt line, framed by borders, near the
// bottom of the screen; notices and suggestion lists can sit under it. Absent
// while a dialog covers the prompt.
function promptIndex(rows: string[]): number {
  for (let i = rows.length - 1; i >= Math.max(1, rows.length - 16); i--) {
    if (rows[i]!.startsWith('❯') && BORDER_RE.test(rows[i - 1]!) && BORDER_RE.test(rows[i + 1] ?? '')) return i
  }
  return -1
}

// Whether the session can take a typed command right now.
export function paneState(screen: string): 'ready' | 'busy' | 'blocked' {
  const rows = lines(screen)
  if (rows.slice(-12).some(isSpinner)) return 'busy'
  return promptIndex(rows) >= 0 ? 'ready' : 'blocked'
}

// The transcript part of a capture: everything above the prompt box. Typing
// into the prompt leaves it unchanged; a submitted command changes it. A count
// of echoes can't tell a new run from an old one, because on a full screen the
// oldest echo scrolls off as the new one appears.
export function transcript(screen: string): string {
  const rows = lines(screen)
  const prompt = promptIndex(rows)
  return (prompt > 0 ? rows.slice(0, prompt - 1) : rows).join('\n')
}

// The command's output from a pane capture (joined lines, with scrollback):
// for a dialog, the panel under its top edge; otherwise the lines under the
// newest echo of the command, up to the prompt box, a spinner or the next
// prompt, minus trailing right-aligned status rows.
export function extractOutput(screen: string, spec: RelaySpec): string | undefined {
  const rows = lines(screen)
  let out: string[]
  if (spec.mode === 'dialog') {
    let top = -1
    for (let i = rows.length - 1; i >= 0; i--) if (DIALOG_TOP_RE.test(rows[i]!)) { top = i; break }
    if (top < 0) return undefined
    out = rows.slice(top + 1)
  } else {
    const echo = `❯ ${spec.command}`
    let at = -1
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i] === echo || rows[i]!.startsWith(`${echo} `)) { at = i; break }
    if (at < 0) return undefined
    const start = at + 1
    let end = start
    while (end < rows.length && !BORDER_RE.test(rows[end]!) && !rows[end]!.startsWith('❯') && !isSpinner(rows[end]!)) end++
    while (end > start && /^ {20,}\S/.test(rows[end - 1]!)) end--
    out = rows.slice(start, end)
  }
  const text = out.map(r => r.replace(/^\s*⎿\s+/, '')).join('\n').trim()
  return text ? (text.length > 3000 ? text.slice(0, 3000) + '\n…' : text) : undefined
}

export type RelayIO = {
  sendKeys: (...keys: string[]) => void
  sendText: (text: string) => void
  capture: (withScrollback: boolean) => string
  sleep: (ms: number) => Promise<void>
  // Make the pane tall enough for long output and return a function that
  // restores it. Claude Code may run on the alternate screen, where tmux keeps
  // no scrollback: output taller than the pane is lost to a capture, but a
  // taller pane makes Claude Code redraw it in full.
  grow?: () => () => void
}

export type RelayResult =
  | { status: 'busy' | 'blocked' }
  | { status: 'done'; output?: string }
  | { status: 'timeout' }

// Type the command into the pane and wait for its result. `onStarted` fires
// once the keys are in, so a long /compact can be acknowledged right away.
export async function runRelay(
  spec: RelaySpec,
  io: RelayIO,
  onStarted?: () => void,
  compactTimeoutMs = 10 * 60_000,
): Promise<RelayResult> {
  if (spec.mode === 'stop') throw new Error('/stop is handled by the server, not typed')
  // A pane mid-redraw (just resized, just closed a panel) briefly shows no
  // prompt box, so give 'blocked' a moment before refusing.
  let state = paneState(io.capture(false))
  for (let tries = 0; state === 'blocked' && tries < 4; tries++) {
    await io.sleep(500)
    state = paneState(io.capture(false))
  }
  if (state !== 'ready') return { status: state }

  const restore = spec.mode === 'inline' || spec.mode === 'dialog' ? io.grow?.() : undefined
  try {
    if (restore) await io.sleep(600)
    return await typeAndRead(spec, io, onStarted, compactTimeoutMs)
  } finally {
    restore?.()
  }
}

async function typeAndRead(
  spec: RelaySpec,
  io: RelayIO,
  onStarted: (() => void) | undefined,
  compactTimeoutMs: number,
): Promise<RelayResult> {
  const before = transcript(io.capture(true))
  // Output of this run, not an earlier one: only once the transcript changed.
  const fresh = () => {
    const screen = io.capture(true)
    return transcript(screen) === before ? undefined : extractOutput(screen, spec)
  }

  // The first Enter closes the slash-command autocomplete, the second submits.
  // A second Enter on an empty prompt does nothing.
  io.sendText(spec.command)
  await io.sleep(400)
  io.sendKeys('Enter')
  await io.sleep(400)
  io.sendKeys('Enter')
  onStarted?.()

  switch (spec.mode) {
    case 'stop':
    case 'clear':
      await io.sleep(1500)
      return { status: 'done' }
    case 'inline': {
      // Output usually renders within a second; a busy redraw can take longer.
      // Take it once two reads agree, so a half-drawn block isn't sent.
      let last: string | undefined
      for (let waited = 0; waited < 8000; waited += 500) {
        await io.sleep(500)
        const output = fresh()
        if (output && output === last) return { status: 'done', output }
        last = output
      }
      return { status: 'done', output: last }
    }
    case 'dialog': {
      await io.sleep(2000)
      const output = extractOutput(io.capture(true), spec)
      // An Esc that lands while the panel is still loading is ignored, so
      // press it again only while the panel is still on screen. Anything else
      // (a ready prompt, a turn that started meanwhile) must not get an Esc:
      // it opens the rewind menu or interrupts the turn.
      for (let tries = 0; tries < 4; tries++) {
        io.sendKeys('Escape')
        await io.sleep(700)
        if (!dialogOpen(io.capture(false))) break
      }
      return { status: 'done', output }
    }
    case 'compact': {
      await io.sleep(3000)
      for (let waited = 3000; waited < compactTimeoutMs; waited += 3000) {
        if (paneState(io.capture(false)) === 'ready') {
          return { status: 'done', output: fresh() }
        }
        await io.sleep(3000)
      }
      return { status: 'timeout' }
    }
  }
}
