// Per-session topics in the bot's private chat (Bot API 9.3/9.4 topic mode).
//
// Every Claude session with the Telegram channel loaded gets its own topic in
// each allowlisted user's DM, named after its project. Only one server polls
// (the leader), so the leader routes each topic's updates to the session that
// owns the topic: it writes the raw update to that topic's inbox directory,
// and the owning server feeds it through its own grammy handlers. Updates
// outside any registered topic (the main chat, a topic the user created) stay
// with the leader. The registry outlives sessions, so a restarted session gets
// its old topic back and drains what queued up while it was gone.
//
// Pure helpers live here so they can be unit tested; server.ts does the I/O.

import { basename } from 'path'

export type TopicEntry = {
  chat_id: string
  thread_id: number
  /** Session identity: the project dir, plus "#n" for a second session in it. */
  key: string
  name: string
  /** Server process that owns the topic now; 0 when released. */
  pid: number
  /** That process's start time (ps lstart), so a recycled pid isn't taken for the owner. */
  started?: string
}

export type TopicRegistry = { topics: TopicEntry[] }

export type TopicRoute = { chat_id: string; thread_id: number }

type Chatish = { id: number; type?: string }
type Msgish = { chat?: Chatish; message_thread_id?: number; is_topic_message?: boolean }

// Where a private-chat update belongs, if it sits inside a topic. Messages,
// button taps (on a message in the topic) and draft Stop presses route;
// everything else stays with the leader.
export function routeOf(update: Record<string, unknown>): TopicRoute | undefined {
  const inTopic = (m: Msgish | undefined) =>
    m?.chat?.type === 'private' && typeof m.message_thread_id === 'number'
      ? { chat_id: String(m.chat.id), thread_id: m.message_thread_id }
      : undefined
  if (update.message) return inTopic(update.message as Msgish)
  const cb = update.callback_query as { message?: Msgish } | undefined
  if (cb) return inTopic(cb.message)
  const stopped = update.stopped_message_generation as { chat?: Chatish; message_thread_id?: number } | undefined
  if (stopped?.chat && typeof stopped.message_thread_id === 'number') {
    return { chat_id: String(stopped.chat.id), thread_id: stopped.message_thread_id }
  }
  return undefined
}

export function findTopic(reg: TopicRegistry, route: TopicRoute): TopicEntry | undefined {
  return reg.topics.find(t => t.chat_id === route.chat_id && t.thread_id === route.thread_id)
}

// Which topic a starting session takes in one chat: its own (same pid), else
// a released or orphaned topic of the same project, else a new one. A second
// live session in the same project gets "<name> (2)" with key "<dir>#2".
export type ClaimPlan =
  | { kind: 'reuse'; entry: TopicEntry }
  | { kind: 'create'; key: string; name: string }

export function planClaim(
  reg: TopicRegistry,
  chat_id: string,
  projectDir: string,
  pid: number,
  isAlive: (entry: TopicEntry) => boolean,
): ClaimPlan {
  const base = basename(projectDir) || projectDir
  const mine = reg.topics.filter(t => t.chat_id === chat_id && (t.key === projectDir || t.key.startsWith(`${projectDir}#`)))
  const own = mine.find(t => t.pid === pid)
  if (own) return { kind: 'reuse', entry: own }
  // Lowest-numbered free topic first, so a lone session keeps the plain name.
  const rank = (t: TopicEntry) => (t.key === projectDir ? 1 : Number(t.key.slice(projectDir.length + 1)) || 99)
  const free = mine.filter(t => !t.pid || !isAlive(t)).sort((a, b) => rank(a) - rank(b))
  if (free[0]) return { kind: 'reuse', entry: free[0] }
  let n = 1
  while (mine.some(t => rank(t) === n)) n++
  return n === 1
    ? { kind: 'create', key: projectDir, name: base }
    : { kind: 'create', key: `${projectDir}#${n}`, name: `${base} (${n})` }
}

// Progress state (active turn, typing daemon, trace log) is kept per topic
// so two sessions can run turns at once. Thread ids are per chat, so the slot
// names both. The main chat keeps the original file names. Keep in sync with
// slotFor() in scripts/telegram-shared.cjs.
export function slotSuffix(chat_id?: string, thread_id?: number): string {
  return thread_id != null && chat_id ? `-t${chat_id}_${thread_id}` : ''
}

// Topic names are 1-128 chars.
export function topicName(name: string): string {
  const s = name.trim() || 'Claude'
  return s.length > 128 ? s.slice(0, 128) : s
}
