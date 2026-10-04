#!/usr/bin/env node
// PreToolUse/PostToolUse/Stop hook: Telegram progress indicators.
//
// Reads config from <state dir>/command-config.json (default
// ~/.claude/channels/telegram/):
//   progress.statusUpdates: bool (default: true) - show tool progress in Telegram
//   progress.streamMode: "message" (default) | "draft"
//     "message" - one persistent progress message, sent silently on the first
//       tool call and edited in place as a quiet HTML blockquote. When the
//       turn ends it collapses into an expandable blockquote summary
//       ("Ran N steps · 42s") and stays in chat history as background
//       tracking info. Works in groups.
//     "draft" - legacy ephemeral streaming via sendRichMessageDraft /
//       sendMessageDraft (private chats only, 30s TTL); tool history is
//       persisted as a separate message right before the reply.
//     "edit" (legacy value) is treated as "message".
//
// Modes (argv[2]):
//   pre       - record in-flight tool label; establish context; begin
//               progress; finalize draft history before reply/send executes
//   post      - append completed tools; manage daemon; finalize on reply/send
//   stop      - turn ended; finalize progress and clean up (same session only)
//   fail      - StopFailure: an API error (rate limit, overload, auth...)
//               ended the turn, so Claude can't reply. Tell the user, then
//               finalize like stop. Fires instead of Stop.
//   interrupt - spawned by server.ts when the user taps Stop (no stdin):
//               finalize the trace as "Stopped" and clean up. Claude Code
//               fires no Stop hook on an interrupted turn.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execFileSync } = require('child_process');
const {
  LOG_FILE, PID_FILE, STOP_FILE, CURRENT_TOOL_FILE, ACTIVE_FILE, STATE_DIR, STOP_MARKUP,
  readToken, escapeHtml,
  readProgressLog, writeProgressLog, readCurrentTool,
  formatProgress, formatProgressMarkdown, formatProgressFinalHtml,
} = require('./telegram-shared.cjs');

const MODE = process.argv[2] || 'post';

function isTelegramTool(name) {
  return name.startsWith('mcp__plugin_claude-telegram-companion_telegram__')
    || name.startsWith('mcp__plugin_claude_telegram_companion_telegram__');
}
function getTelegramAction(name) {
  const parts = name.split('__');
  return parts[parts.length - 1] || '';
}
const DAEMON_SCRIPT = path.join(__dirname, 'telegram-typing-daemon.cjs');

const CONFIG_FILE = path.join(STATE_DIR, 'command-config.json');

// Lazy-loaded config (only read when Telegram context is active)
let _statusUpdates = null;
function statusUpdatesEnabled() {
  if (_statusUpdates !== null) return _statusUpdates;
  _statusUpdates = true;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (raw.progress && typeof raw.progress.statusUpdates === 'boolean')
      _statusUpdates = raw.progress.statusUpdates;
  } catch {}
  return _statusUpdates;
}

// "message" (default) edits one persistent rich message in place; "draft"
// opts back into the legacy ephemeral sendMessageDraft streaming. Drafts are
// a private-chat feature, so groups (negative chat_id) always use messages.
let _streamMode = null;
function streamMode() {
  if (_streamMode !== null) return _streamMode;
  _streamMode = 'message';
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (raw.progress && raw.progress.streamMode === 'draft')
      _streamMode = 'draft';
  } catch {}
  return _streamMode;
}
function useDraftFor(chatId) {
  return streamMode() === 'draft' && Number(chatId) > 0;
}

// Begin showing progress. Message mode sends one silent persistent message
// (quiet HTML blockquote) that the daemon then edits in place. Draft mode
// streams an ephemeral draft that auto-clears on the real reply.
function beginProgress(ctx, entries, currentTool) {
  try { fs.unlinkSync(STOP_FILE); } catch {}
  if (!ctx.started_at) ctx.started_at = now();
  if (useDraftFor(ctx.chat_id)) {
    ctx.progress_msg_id = 'draft';
    ctx.timestamp = now();
    writeActive(ctx);
    spawnDaemon(ctx.chat_id, 'draft');
    process.exit(0);
  }
  const text = formatProgress(entries, currentTool);
  if (!text || !getToken()) process.exit(0);
  telegramPostSync('sendMessage', {
    chat_id: ctx.chat_id,
    text,
    parse_mode: 'HTML',
    disable_notification: true,
    reply_markup: STOP_MARKUP,
  }, (msgId) => {
    if (msgId) {
      ctx.progress_msg_id = String(msgId);
      ctx.timestamp = now();
      writeActive(ctx);
      spawnDaemon(ctx.chat_id, ctx.progress_msg_id);
    }
    process.exit(0);
  });
}

// Finalize the persistent progress message (collapse into an expandable
// summary) and tear down all coordination state. Used on reply/send, on
// Stop, and on a user interrupt (`stopped`). Draft-mode history was already
// persisted in PreToolUse — except on interrupt, where no reply comes and the
// draft must be persisted here.
function finalizeAndCleanup(stopped = false, retried = false) {
  const ctx = readActive();
  killDaemon();
  // Stop can land while the first progress message is still being sent; its
  // id appears in the active file a moment later. Wait once for it, so that
  // message gets collapsed instead of keeping a dead Stop button.
  if (stopped && !retried && ctx && !ctx.progress_msg_id) {
    setTimeout(() => finalizeAndCleanup(true, true), 2000);
    return;
  }
  const done = () => {
    cleanup();
    if (!stopped) process.exit(0);
    // A hook of the interrupted tool may still be in flight and rewrite the
    // active file after this cleanup. Sweep once more, but only the
    // interrupted turn's own state — a follow-up turn has a new started_at.
    setTimeout(() => {
      const late = readActive();
      if (late && ctx && late.session_id === ctx.session_id && late.started_at === ctx.started_at) cleanup();
      process.exit(0);
    }, 1500);
  };
  if (!ctx || !ctx.progress_msg_id || !getToken()) {
    done();
    return;
  }
  const isDraft = ctx.progress_msg_id === 'draft';
  if (isDraft && !stopped) {
    done();
    return;
  }
  const entries = readProgressLog();
  if (entries.length === 0) {
    // Nothing completed yet: the turn ended while the only step was still
    // in flight. Fold that step into the trace so the log is never deleted.
    const currentTool = readCurrentTool();
    if (currentTool) {
      entries.push({ label: currentTool, time: now(), status: 'done' });
    } else {
      // Nothing to show at all — leave the message as it stands.
      done();
      return;
    }
  }
  const elapsed = now() - (ctx.started_at || ctx.timestamp || now());
  const text = formatProgressFinalHtml(entries, elapsed, stopped);
  // No reply_markup: the final collapse drops the Stop button.
  if (isDraft) {
    telegramPostSync('sendMessage', {
      chat_id: ctx.chat_id, text, parse_mode: 'HTML', disable_notification: true,
    }, done);
    return;
  }
  telegramPostSync('editMessageText', {
    chat_id: ctx.chat_id,
    message_id: Number(ctx.progress_msg_id),
    text,
    parse_mode: 'HTML',
  }, done);
}

// The tmux pane of the Claude session running this hook, so server.ts can
// interrupt the turn with Escape when the user taps Stop. TMUX_PANE when the
// harness passes it through; otherwise walk our process ancestry up to a
// pane's root process. Null outside tmux.
function findTmuxPane() {
  if (process.env.TMUX_PANE) return process.env.TMUX_PANE;
  try {
    const opts = { encoding: 'utf8', timeout: 1000 };
    const panes = new Map(
      execFileSync('tmux', ['list-panes', '-a', '-F', '#{pane_pid} #{pane_id}'], opts)
        .trim().split('\n').map(l => l.split(' ')),
    );
    let pid = process.ppid;
    for (let i = 0; i < 30 && pid > 1; i++) {
      if (panes.has(String(pid))) return panes.get(String(pid));
      pid = parseInt(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], opts).trim(), 10);
    }
  } catch {}
  return null;
}

// Bind the context to the session that received the Telegram message.
function claimContext(ctx, sessionId) {
  ctx.session_id = sessionId;
  const pane = findTmuxPane();
  if (pane) ctx.tmux_pane = pane;
  return ctx;
}

let _token = null;
function getToken() {
  if (_token !== null) return _token;
  _token = readToken();
  return _token;
}

if (MODE === 'interrupt') finalizeAndCleanup(true);
else readHookInput();

function readHookInput() {
  let input = '';
  const stdinTimeout = setTimeout(() => process.exit(0), 3000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      const data = JSON.parse(input);
      const toolName = data.tool_name || '';
      const toolInput = data.tool_input || {};
      const sessionId = data.session_id || '';
      const transcriptPath = data.transcript_path || '';

      if (MODE === 'pre') {
        handlePreToolUse(toolName, toolInput, sessionId, transcriptPath);
      } else if (MODE === 'stop') {
        handleStop(sessionId);
      } else if (MODE === 'fail') {
        handleStopFailure(data, sessionId, transcriptPath);
      } else {
        handlePostToolUse(data, toolName, toolInput);
      }
    } catch {
      process.exit(0);
    }
  });
}

// Ownership check: an unclaimed context (server wrote it without session_id)
// may only be claimed by the session that actually received the inbound
// Telegram message — otherwise every concurrent Claude session's tools would
// pollute the trace. The receiving session provably has the <channel
// source="telegram" chat_id="..."> block in its transcript; check the tail.
function sessionOwnsChannel(transcriptPath, chatId) {
  if (!transcriptPath || !chatId) return false;
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 262144);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const tail = buf.toString('utf8');
    // Transcript is JSONL, so the channel block usually appears JSON-escaped.
    return tail.includes(`chat_id=\\"${chatId}\\"`)
      || tail.includes(`chat_id="${chatId}"`);
  } catch { return false; }
}

// --- Stop: turn ended (with or without a reply) ---

function handleStop(sessionId) {
  const ctx = readActive();
  if (!ctx || !ctx.chat_id) process.exit(0);
  // Only the session that owns the context may finalize it. A context the
  // server wrote that no session claimed yet is left for its owner.
  if (!ctx.session_id || ctx.session_id !== sessionId) process.exit(0);
  finalizeAndCleanup();
}

// --- StopFailure: an API error ended the turn before Claude could reply ---

const FAILURE_LABELS = {
  rate_limit: 'usage limit reached',
  overloaded: 'Anthropic API is overloaded',
  billing_error: 'billing problem on the account',
  authentication_failed: 'authentication failed, log in again in the terminal',
  oauth_org_not_allowed: 'this organization is not allowed',
  account_on_hold: 'account is on hold',
  verification_required: 'account verification required',
  server_error: 'Anthropic API server error',
  max_output_tokens: 'response exceeded the output token limit',
  model_not_found: 'model not found',
  cloud_credential_error: 'cloud credential error',
};
// While rate limited, every new message starts a turn that fails at once.
// One notice per error type per window keeps that from spamming the chat.
const FAILURE_NOTICE_FILE = path.join(require('os').tmpdir(), 'telegram-failure-notice.json');
const FAILURE_NOTICE_COOLDOWN = 600;

function handleStopFailure(data, sessionId, transcriptPath) {
  const ctx = readActive();
  if (!ctx || !ctx.chat_id || isStale(ctx)) process.exit(0);
  // A turn that failed on its first API call never ran a tool, so the context
  // may still be unclaimed: accept it iff this session received the message.
  if (ctx.session_id ? ctx.session_id !== sessionId : !sessionOwnsChannel(transcriptPath, ctx.chat_id)) {
    process.exit(0);
  }

  const error = data.error || 'unknown';
  if (!getToken()) { finalizeAndCleanup(); return; }
  let last = {};
  try { last = JSON.parse(fs.readFileSync(FAILURE_NOTICE_FILE, 'utf8')); } catch {}
  if (last.error === error && now() - (last.at || 0) < FAILURE_NOTICE_COOLDOWN) {
    finalizeAndCleanup();
    return;
  }
  try { fs.writeFileSync(FAILURE_NOTICE_FILE, JSON.stringify({ error, at: now() })); } catch {}

  // last_assistant_message carries Claude Code's own error line, which for
  // rate limits includes the reset time ("... resets 3pm").
  const detail = String(data.last_assistant_message || data.error_details || '').trim().slice(0, 300);
  const label = FAILURE_LABELS[error] || `API error (${error})`;
  const text = `⚠️ <b>Can't reply: ${escapeHtml(label)}.</b>`
    + (detail ? `\n<blockquote>${escapeHtml(detail)}</blockquote>` : '');
  telegramPostSync('sendMessage', { chat_id: ctx.chat_id, text, parse_mode: 'HTML' },
    () => finalizeAndCleanup());
}

// --- PreToolUse: write current tool to file for daemon ---

function handlePreToolUse(toolName, toolInput, sessionId, transcriptPath) {
  if (isTelegramTool(toolName)) {
    const action = getTelegramAction(toolName);
    if (action === 'reply' || action === 'send') {
      const ctx = readActive();
      if (ctx && ctx.progress_msg_id) {
        killDaemon();
        // Draft mode only: drafts auto-clear when the real reply arrives, so
        // the history must be persisted BEFORE reply executes. Message-mode
        // progress already persists; it is finalized in PostToolUse.
        if (ctx.progress_msg_id === 'draft') {
          const entries = readProgressLog();
          if (entries.length > 0) {
            const elapsed = now() - (ctx.started_at || ctx.timestamp || now());
            const html = formatProgressFinalHtml(entries, elapsed);
            if (html && getToken()) {
              telegramPostSync('sendMessage', {
                chat_id: ctx.chat_id,
                text: html,
                parse_mode: 'HTML',
                disable_notification: true,
              }, () => { process.exit(0); });
              return;
            }
          }
        }
      }
    }
    process.exit(0);
  }

  const label = formatToolLabel(toolName, toolInput);
  if (!label) process.exit(0);

  let ctx = readActive();
  if (!ctx || !ctx.chat_id || isStale(ctx)) process.exit(0);

  // Auto-establish context: server wrote active file without session_id.
  // Only the session that actually received the channel message may claim it.
  if (!ctx.session_id) {
    if (!sessionOwnsChannel(transcriptPath, ctx.chat_id)) process.exit(0);
    try { fs.unlinkSync(LOG_FILE); } catch {}
    try { fs.unlinkSync(CURRENT_TOOL_FILE); } catch {}
    killDaemon();
    claimContext(ctx, sessionId);
    ctx.started_at = now();
    if (statusUpdatesEnabled() && getToken() && useDraftFor(ctx.chat_id)) {
      ctx.progress_msg_id = 'draft';
      writeActive(ctx);
      spawnDaemon(ctx.chat_id, 'draft');
    } else {
      writeActive(ctx);
    }
  } else if (ctx.session_id !== sessionId) {
    process.exit(0);
  }

  if (!statusUpdatesEnabled()) process.exit(0);

  try { fs.writeFileSync(CURRENT_TOOL_FILE, label); } catch {}

  // Keep the context fresh while tools are starting, so a long-running tool
  // doesn't let the context go stale before its PostToolUse fires.
  ctx.timestamp = now();
  writeActive(ctx);

  // First visible tool: begin progress display and spawn daemon eagerly
  // so long-running tools appear in-progress immediately
  if (!ctx.progress_msg_id && getToken()) {
    beginProgress(ctx, readProgressLog(), label);
    return;
  }

  process.exit(0);
}

// --- PostToolUse: progress tracking and daemon management ---

function handlePostToolUse(data, toolName, toolInput) {
  const sessionId = data.session_id || '';
  const toolOutput = data.tool_output || '';

  if (isTelegramTool(toolName)) {
    const chatId = toolInput.chat_id;
    if (!chatId) process.exit(0);

    const action = getTelegramAction(toolName);

    // ack → establish context and immediately start progress
    if (action === 'ack') {
      killDaemon();
      try { fs.unlinkSync(LOG_FILE); } catch {}
      try { fs.unlinkSync(CURRENT_TOOL_FILE); } catch {}
      const ctx = claimContext({ chat_id: chatId, timestamp: now(), started_at: now() }, sessionId);
      if (statusUpdatesEnabled() && getToken() && useDraftFor(chatId)) {
        ctx.progress_msg_id = 'draft';
        writeActive(ctx);
        spawnDaemon(chatId, 'draft');
      } else {
        writeActive(ctx);
      }
      process.exit(0);
    }

    // react → establish context (legacy, used for explicit emoji reactions)
    if (action === 'react') {
      if (!readActive()) {
        killDaemon();
        try { fs.unlinkSync(LOG_FILE); } catch {}
        try { fs.unlinkSync(CURRENT_TOOL_FILE); } catch {}
        writeActive(claimContext({ chat_id: chatId, timestamp: now(), started_at: now() }, sessionId));
      }
      process.exit(0);
    }

    // reply/send → collapse the persistent progress message and clean up.
    // (Draft history was already persisted in PreToolUse.)
    if (action === 'reply' || action === 'send') {
      finalizeAndCleanup();
      return;
    }

    // edit/edit_message → clean up
    if (action === 'edit_message' || action === 'edit') {
      cleanup();
      process.exit(0);
    }

    process.exit(0);
  }

  // --- Non-Telegram tool ---
  // Skip hidden tools before any file I/O
  if (HIDDEN_TOOLS.has(toolName)) process.exit(0);
  if (!statusUpdatesEnabled()) process.exit(0);

  const ctx = readActive();
  if (!ctx || !ctx.chat_id || isStale(ctx)) process.exit(0);
  // Only the session connected to the channel contributes to the trace. An
  // unclaimed context is claimed here iff this session received the inbound
  // message (PreToolUse normally claims first; this covers its misses).
  if (!ctx.session_id) {
    if (!sessionOwnsChannel(data.transcript_path || '', ctx.chat_id)) process.exit(0);
    claimContext(ctx, sessionId);
    if (!ctx.started_at) ctx.started_at = now();
  } else if (ctx.session_id !== sessionId) {
    process.exit(0);
  }

  // Error handling: no progress message sent yet + tool failed
  // Send error directly to Telegram (don't rely on Claude following additionalContext)
  if (!ctx.progress_msg_id && looksLikeError(toolOutput) && getToken()) {
    const errorText = typeof toolOutput === 'string'
      ? toolOutput.slice(0, 200)
      : JSON.stringify(toolOutput).slice(0, 200);
    telegramPostSync('sendMessage', {
      chat_id: ctx.chat_id,
      text: `<b>Failed:</b> ${escapeHtml(errorText)}`,
      parse_mode: 'HTML',
    }, () => { cleanup(); process.exit(0); });
    return;
  }

  // Build progress entry
  const label = formatToolLabel(toolName, toolInput);
  if (!label) process.exit(0);

  // Deduplicate: repeated identical labels increment a ×N counter instead of
  // silently collapsing (or spamming a line per repeat).
  const entries = readProgressLog();
  const existing = entries.find(e => e.label === label);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.time = now();
    writeProgressLog(entries);
    ctx.timestamp = now();
    writeActive(ctx);
    process.exit(0);
  }

  fs.appendFileSync(LOG_FILE, JSON.stringify({
    label, time: now(), status: 'done',
  }) + '\n');
  entries.push({ label, time: now(), status: 'done' });

  // Begin progress display if none exists yet
  if (!ctx.progress_msg_id && getToken()) {
    beginProgress(ctx, entries, readCurrentTool());
    return;
  }

  ctx.timestamp = now();
  writeActive(ctx);

  // If daemon died, refresh progress immediately and respawn. (Drafts can't be
  // edited out-of-band, so only nudge real messages here.)
  if (ctx.progress_msg_id && !isDaemonAlive()) {
    if (ctx.progress_msg_id !== 'draft') editProgress(ctx);
    try { fs.unlinkSync(STOP_FILE); } catch {}
    spawnDaemon(ctx.chat_id, ctx.progress_msg_id);
  }

  process.exit(0);
}

// --- Helpers ---

function now() { return Math.floor(Date.now() / 1000); }
// Generous window: single tool calls (Agent, long Bash) can run for many
// minutes. Turn teardown is handled by the Stop hook, not staleness.
function isStale(ctx) { return ctx.timestamp && (now() - ctx.timestamp) > 1800; }
function readActive() {
  try { return JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8')); } catch { return null; }
}
function writeActive(ctx) {
  try { fs.writeFileSync(ACTIVE_FILE, JSON.stringify(ctx)); } catch {}
}
function cleanup() {
  killDaemon();
  try { fs.unlinkSync(ACTIVE_FILE); } catch {}
  try { fs.unlinkSync(LOG_FILE); } catch {}
  try { fs.unlinkSync(CURRENT_TOOL_FILE); } catch {}
}

function looksLikeError(output) {
  const text = typeof output === 'string' ? output : JSON.stringify(output || '');
  return /\b(error:|Error:|ERROR|failed:|Failed|rate limit|timed out|exception:)/i.test(text);
}

// --- Telegram API ---

// POST and wait for the response. cb receives the returned message_id (or a
// truthy ok signal for edits) or null. The callback owns process exit.
function telegramPostSync(method, body, cb) {
  if (!getToken()) { cb(null); process.exit(0); return; }
  const postData = JSON.stringify(body);
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${getToken()}/${method}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 2500,
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (!parsed.ok) { cb(null); return; }
        cb((parsed.result && parsed.result.message_id) || true);
      } catch { cb(null); }
    });
  });
  req.on('error', () => { cb(null); });
  req.on('timeout', () => { req.destroy(); cb(null); });
  req.write(postData);
  req.end();
}

function telegramPostFireForget(method, body) {
  if (!getToken()) return;
  const postData = JSON.stringify(body);
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${getToken()}/${method}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 2000,
  }, (res) => { res.resume(); });
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.write(postData);
  req.end();
}

// --- Daemon ---

function killDaemon() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (pid) process.kill(pid, 'SIGTERM');
  } catch {}
  try { fs.writeFileSync(STOP_FILE, '1'); } catch {}
}

function isDaemonAlive() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

function spawnDaemon(chatId, messageId) {
  try {
    const args = [DAEMON_SCRIPT, chatId];
    if (messageId) args.push(messageId);
    const child = spawn('node', args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {}
}

// --- Progress editing (one-shot nudge when the daemon died) ---

function editProgress(ctx) {
  if (!ctx.progress_msg_id || ctx.progress_msg_id === 'draft' || !getToken()) return;
  const entries = readProgressLog();
  const currentTool = readCurrentTool();
  const text = formatProgress(entries, currentTool);
  if (!text) return;
  telegramPostFireForget('editMessageText', {
    chat_id: ctx.chat_id,
    message_id: Number(ctx.progress_msg_id),
    text,
    parse_mode: 'HTML',
    reply_markup: STOP_MARKUP,
  });
}

// --- Tool labels ---

// Internal tools that shouldn't appear in progress
const HIDDEN_TOOLS = new Set([
  'Read', 'Glob', 'ToolSearch',
  'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop',
]);

function formatToolLabel(toolName, toolInput) {
  if (HIDDEN_TOOLS.has(toolName)) return null;

  if (toolName === 'Agent') return `Agent(${toolInput.description || 'processing'})`;
  if (toolName === 'Skill') {
    const skill = toolInput.skill || '';
    const name = skill.includes(':') ? skill.split(':').pop() : skill;
    return name ? `Skill(${name})` : null;
  }
  if (toolName === 'Bash') {
    const desc = toolInput.description
      || toolInput.command?.slice(0, 60).replace(/\n.*/s, '').trim()
      || 'command';
    return `Bash(${desc})`;
  }
  if (toolName === 'Write') {
    const name = path.basename(toolInput.file_path || '') || 'file';
    return `Write(${name})`;
  }
  if (toolName === 'Edit') {
    const name = path.basename(toolInput.file_path || '') || 'file';
    return `Edit(${name})`;
  }
  if (toolName === 'Grep') return 'Searched for patterns';
  if (toolName === 'WebSearch') {
    const query = toolInput.query || '';
    return query ? `Search(${query.slice(0, 50)})` : 'Web search';
  }
  if (toolName === 'WebFetch') {
    const url = toolInput.url || '';
    const short = url.replace(/^https?:\/\//, '').slice(0, 50);
    return short ? `Fetch(${short})` : 'Web fetch';
  }
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const service = parts[1] || '';
    const cap = service.charAt(0).toUpperCase() + service.slice(1);
    const op = (parts.slice(2).join('-') || '').replace(/-/g, ' ');
    return `${cap}: ${op}`.slice(0, 50);
  }
  return toolName;
}
