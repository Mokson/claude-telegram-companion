// Shared constants and utilities for telegram-typing-keepalive.js
// and telegram-typing-daemon.js.

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = os.tmpdir();

// Progress state lives in a "slot" per conversation so sessions working in
// different private-chat topics can run turns at once: the main chat uses the
// original file names (slot ''), topic <id> of chat <c> appends "-t<c>_<id>"
// (thread ids are per chat). Keep in sync with slotSuffix() in topics.ts. P holds the current slot's paths; scripts
// pick a slot with useSlot() before touching any file.
const P = {};
function useSlot(slot) {
  const s = slot || '';
  P.slot = s;
  P.LOG_FILE = path.join(tmpDir, `telegram-progress${s}.jsonl`);
  P.PID_FILE = path.join(tmpDir, `telegram-typing-pid${s}`);
  P.STOP_FILE = path.join(tmpDir, `telegram-typing-stop${s}`);
  P.CURRENT_TOOL_FILE = path.join(tmpDir, `telegram-current-tool${s}.txt`);
  P.ACTIVE_FILE = path.join(tmpDir, `telegram-active${s}.json`);
  return P;
}
useSlot('');

const SLOT_RE = /^(-t-?\d+_\d+)?$/;
function slotFor(chatId, threadId) {
  const n = Number(threadId);
  const c = String(chatId == null ? '' : chatId);
  return /^-?\d+$/.test(c) && threadId != null && threadId !== '' && Number.isInteger(n) && n > 0 ? `-t${c}_${n}` : '';
}

// Slots that currently have an active-turn file.
function listActiveSlots() {
  try {
    return fs.readdirSync(tmpDir)
      .map(f => /^telegram-active(-t-?\d+_\d+)?\.json$/.exec(f))
      .filter(Boolean)
      .map(m => m[1] || '');
  } catch { return []; }
}
// Same resolution as server.ts: TELEGRAM_STATE_DIR, else the Claude config
// dir (CLAUDE_CONFIG_DIR or ~/.claude) + channels/telegram.
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const STATE_DIR = process.env.TELEGRAM_STATE_DIR || path.join(CLAUDE_DIR, 'channels', 'telegram');
const ENV_FILE = path.join(STATE_DIR, '.env');

const MAX_VISIBLE_STEPS = 15;
const MAX_FINAL_STEPS = 100;

// Stop button on the live progress message; server.ts handles `ctl:stop`.
// Every live edit must resend it (editMessageText without reply_markup drops
// the keyboard); the final collapse omits it on purpose.
const STOP_MARKUP = { inline_keyboard: [[{ text: '⏹ Stop', callback_data: 'ctl:stop' }]] };

function readToken() {
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^TELEGRAM_BOT_TOKEN=(.+)$/);
      if (m) return m[1];
    }
  } catch {}
  return '';
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readProgressLog() {
  try {
    const raw = fs.readFileSync(P.LOG_FILE, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function writeProgressLog(entries) {
  try {
    fs.writeFileSync(P.LOG_FILE, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  } catch {}
}

function readCurrentTool() {
  try {
    const label = fs.readFileSync(P.CURRENT_TOOL_FILE, 'utf8').trim();
    return label || null;
  } catch { return null; }
}

function countSuffix(entry) {
  return entry.count && entry.count > 1 ? ` ×${entry.count}` : '';
}

function stepCount(entries) {
  return entries.reduce((n, e) => n + (e.count || 1), 0);
}

function formatDuration(sec) {
  if (!(sec > 0)) return '';
  if (sec < 90) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

// Live progress as HTML — the primary rendering. HTML blockquotes preserve
// newlines reliably (rich-markdown paragraphs soft-wrap ✓ lines together)
// and read quieter than task-list checkboxes.
function formatProgress(entries, currentTool) {
  if (entries.length === 0 && !currentTool) return null;
  const visible = entries.length > MAX_VISIBLE_STEPS
    ? entries.slice(-MAX_VISIBLE_STEPS) : entries;
  const truncated = entries.length > MAX_VISIBLE_STEPS
    ? entries.length - MAX_VISIBLE_STEPS : 0;
  const doneLabels = new Set(entries.map(e => e.label));
  const lines = [];
  if (truncated > 0) lines.push(`<i>... ${truncated} earlier steps</i>`);
  for (const entry of visible) {
    lines.push(`✓ ${escapeHtml((entry.label || 'Working').slice(0, 80))}${countSuffix(entry)}`);
  }
  if (currentTool && !doneLabels.has(currentTool)) {
    lines.push(`▸ ${escapeHtml(currentTool.slice(0, 80))}…`);
  }
  return '<blockquote>' + lines.join('\n') + '</blockquote>';
}

// Live progress for rich drafts (draft streaming mode): completed steps as a
// blockquote, then the native animated "thinking" block (Bot API 10.2, drafts
// only) for the in-flight tool, or plain "Thinking…" between tools. Built
// from HTML blocks because markdown quote lines would soft-wrap into one line
// and markdown isn't parsed inside block tags anyway.
function formatProgressMarkdown(entries, currentTool) {
  if (entries.length === 0 && !currentTool) return null;
  const visible = entries.length > MAX_VISIBLE_STEPS
    ? entries.slice(-MAX_VISIBLE_STEPS) : entries;
  const truncated = entries.length > MAX_VISIBLE_STEPS
    ? entries.length - MAX_VISIBLE_STEPS : 0;
  const doneLabels = new Set(entries.map(e => e.label));
  const lines = [];
  if (truncated > 0) lines.push(`<i>... ${truncated} earlier steps</i>`);
  for (const entry of visible) {
    lines.push(`✓ ${escapeHtml((entry.label || 'Working').slice(0, 80))}${countSuffix(entry)}`);
  }
  const inFlight = currentTool && !doneLabels.has(currentTool)
    ? `${escapeHtml(currentTool.slice(0, 80))}…` : 'Thinking…';
  const quote = lines.length > 0 ? `<blockquote>${lines.join('<br>')}</blockquote>\n\n` : '';
  return `${quote}<tg-thinking>${inFlight}</tg-thinking>`;
}

// Final collapsed history: an expandable blockquote so the tool-call history
// persists in chat without dominating it. `stopped` marks a turn the user
// interrupted with the Stop button.
function formatProgressFinalHtml(entries, elapsedSec, stopped = false) {
  if (entries.length === 0) return null;
  const steps = stepCount(entries);
  const dur = formatDuration(elapsedSec);
  const verb = stopped ? '⏹ Stopped after' : 'Ran';
  const head = `${verb} ${steps} step${steps === 1 ? '' : 's'}${dur ? ` · ${dur}` : ''}`;
  const lines = entries.slice(-MAX_FINAL_STEPS)
    .map(e => `✓ ${escapeHtml((e.label || 'Working').slice(0, 80))}${countSuffix(e)}`);
  return `<blockquote expandable>${head}\n${lines.join('\n')}</blockquote>`;
}

module.exports = {
  P, useSlot, slotFor, SLOT_RE, listActiveSlots, STATE_DIR, STOP_MARKUP,
  readToken, escapeHtml,
  readProgressLog, writeProgressLog, readCurrentTool,
  formatProgress, formatProgressMarkdown, formatProgressFinalHtml,
};
