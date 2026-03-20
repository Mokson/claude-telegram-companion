#!/usr/bin/env node
// Pre/PostToolUse hook: Telegram progress indicators.
//
// Reads config from ~/.claude/channels/telegram/command-config.json:
//   progress.reaction:      bool (default: false) - react with emoji on receipt
//   progress.statusUpdates: bool (default: true)  - show tool progress in Telegram
//
// PreToolUse mode (argv[2] === 'pre'):
//   Writes current tool label to /tmp/telegram-current-tool.txt
//   so the daemon can show it as in-progress.
//
// PostToolUse mode (default):
//   Lifecycle:
//    1. react → establish Telegram context (chat_id)
//    2. First non-telegram tool → auto-send progress message, spawn daemon
//    3. Subsequent tools → append to progress log (daemon edits message)
//    4. Tool error before message sent → send error directly to Telegram
//    5. Claude's reply/send → delete progress message, clean up

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const MODE = process.argv[2] || 'post';

const TELEGRAM_PLUGIN_PREFIX = 'mcp__plugin_telegram_telegram__';
const TELEGRAM_PROGRESS_PREFIX = 'mcp__telegram_progress__';
const DAEMON_SCRIPT = path.join(__dirname, 'telegram-typing-daemon.js');

const tmpDir = os.tmpdir();
const ACTIVE_FILE = path.join(tmpDir, 'telegram-active.json');
const LOG_FILE = path.join(tmpDir, 'telegram-progress.jsonl');
const PID_FILE = path.join(tmpDir, 'telegram-typing-pid');
const STOP_FILE = path.join(tmpDir, 'telegram-typing-stop');
const CURRENT_TOOL_FILE = path.join(tmpDir, 'telegram-current-tool.txt');

const CONFIG_FILE = path.join(os.homedir(), '.claude', 'channels', 'telegram', 'command-config.json');

const SKIP_TOOLS = new Set([
  'mcp__plugin_telegram_telegram__react',
  'mcp__plugin_telegram_telegram__edit_message',
  'mcp__telegram_progress__send',
  'mcp__telegram_progress__edit',
]);

// Lazy-loaded config and token (only read when Telegram context is active)
let _config = null;
function getConfig() {
  if (_config) return _config;
  _config = { reaction: false, statusUpdates: true };
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (raw.progress) {
      if (typeof raw.progress.reaction === 'boolean') _config.reaction = raw.progress.reaction;
      if (typeof raw.progress.statusUpdates === 'boolean') _config.statusUpdates = raw.progress.statusUpdates;
    }
  } catch {}
  return _config;
}

const envFile = path.join(os.homedir(), '.claude', 'channels', 'telegram', '.env');
let _token = null;
function getToken() {
  if (_token !== null) return _token;
  _token = '';
  try {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^TELEGRAM_BOT_TOKEN=(.+)$/);
      if (m) { _token = m[1]; break; }
    }
  } catch {}
  return _token;
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    // Normalize hyphens in MCP server names (e.g. "mcp__telegram-progress__send" → "mcp__telegram_progress__send")
    const rawToolName = data.tool_name || '';
    const toolName = rawToolName.startsWith('mcp__') ? rawToolName.replace(/-/g, '_') : rawToolName;
    const toolInput = data.tool_input || {};
    const sessionId = data.session_id || '';

    if (MODE === 'pre') {
      handlePreToolUse(toolName, toolInput, sessionId);
    } else {
      handlePostToolUse(data, toolName, toolInput);
    }
  } catch {
    process.exit(0);
  }
});

// --- PreToolUse: write current tool to file for daemon ---

function handlePreToolUse(toolName, toolInput, sessionId) {
  if (!getConfig().statusUpdates) process.exit(0);

  const ctx = readActive();
  if (!ctx || !ctx.chat_id || isStale(ctx)) process.exit(0);
  if (ctx.session_id && ctx.session_id !== sessionId) process.exit(0);
  if (SKIP_TOOLS.has(toolName)) process.exit(0);

  // Skip telegram tools
  if (toolName.startsWith(TELEGRAM_PLUGIN_PREFIX)) process.exit(0);
  if (toolName.startsWith(TELEGRAM_PROGRESS_PREFIX)) process.exit(0);

  const label = formatToolLabel(toolName, toolInput);
  if (!label) process.exit(0);

  try { fs.writeFileSync(CURRENT_TOOL_FILE, label); } catch {}
  process.exit(0);
}

// --- PostToolUse: progress tracking and daemon management ---

function handlePostToolUse(data, toolName, toolInput) {
  const sessionId = data.session_id || '';
  const toolOutput = data.tool_output || '';

  const isPluginTool = toolName.startsWith(TELEGRAM_PLUGIN_PREFIX);
  const isProgressTool = toolName.startsWith(TELEGRAM_PROGRESS_PREFIX);

  if (isPluginTool || isProgressTool) {
    const chatId = toolInput.chat_id;
    if (!chatId) process.exit(0);

    const action = isPluginTool
      ? toolName.replace(TELEGRAM_PLUGIN_PREFIX, '')
      : toolName.replace(TELEGRAM_PROGRESS_PREFIX, '');

    // react → always establish fresh context for this message
    if (action === 'react') {
      // Kill any existing daemon from a previous message
      killDaemon();
      try { fs.unlinkSync(LOG_FILE); } catch {}
      try { fs.unlinkSync(CURRENT_TOOL_FILE); } catch {}
      writeActive({ chat_id: chatId, session_id: sessionId, timestamp: now() });
      process.exit(0);
    }

    // reply/send → final message. Delete progress, clean up.
    if (action === 'reply' || action === 'send') {
      const ctx = readActive();
      if (ctx && ctx.progress_msg_id) {
        telegramPostFireForget('deleteMessage', {
          chat_id: ctx.chat_id,
          message_id: Number(ctx.progress_msg_id),
        });
      }
      cleanup();
      process.exit(0);
    }

    // edit/edit_message → clean up
    if (action === 'edit_message' || action === 'edit') {
      cleanup();
      process.exit(0);
    }

    process.exit(0);
  }

  // --- Non-Telegram tool ---
  if (!getConfig().statusUpdates) process.exit(0);

  const ctx = readActive();
  if (!ctx || !ctx.chat_id || isStale(ctx)) process.exit(0);
  // Only the originating session contributes to progress
  if (ctx.session_id && ctx.session_id !== sessionId) process.exit(0);
  if (SKIP_TOOLS.has(toolName)) process.exit(0);

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
    }, () => {});
    cleanup();
    return;
  }

  // Build progress entry
  const label = formatToolLabel(toolName, toolInput);
  if (!label) process.exit(0);

  // Deduplicate: exact label match against existing entries
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8').trim();
    if (raw) {
      const needle = `"label":${JSON.stringify(label)},`;
      if (raw.includes(needle)) {
        ctx.timestamp = now();
        writeActive(ctx);
        process.exit(0);
      }
    }
  } catch {}

  fs.appendFileSync(LOG_FILE, JSON.stringify({
    label, time: now(), status: 'done',
  }) + '\n');

  // Auto-send progress message if none exists yet
  if (!ctx.progress_msg_id && getToken()) {
    try { fs.unlinkSync(STOP_FILE); } catch {}
    const escaped = escapeHtml(label);
    telegramPostSync('sendMessage', {
      chat_id: ctx.chat_id,
      text: `<blockquote>\u2705 ${escaped}</blockquote>`,
      parse_mode: 'HTML',
    }, (msgId) => {
      if (msgId) {
        ctx.progress_msg_id = String(msgId);
        ctx.timestamp = now();
        writeActive(ctx);
        spawnDaemon(ctx.chat_id, ctx.progress_msg_id);
      }
    });
    return;
  }

  ctx.timestamp = now();
  writeActive(ctx);

  if (ctx.progress_msg_id && !isDaemonAlive()) {
    try { fs.unlinkSync(STOP_FILE); } catch {}
    spawnDaemon(ctx.chat_id, ctx.progress_msg_id);
  }

  process.exit(0);
}

// --- Helpers ---

function now() { return Math.floor(Date.now() / 1000); }
function isStale(ctx) { return ctx.timestamp && (now() - ctx.timestamp) > 120; }
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

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function looksLikeError(output) {
  const text = typeof output === 'string' ? output : JSON.stringify(output || '');
  return /\b(error:|Error:|ERROR|failed:|Failed|rate limit|timed out|exception:)/i.test(text);
}

// --- Telegram API ---

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
        cb(parsed.result && parsed.result.message_id || null);
      } catch { cb(null); }
      process.exit(0);
    });
  });
  req.on('error', () => { cb(null); process.exit(0); });
  req.on('timeout', () => { req.destroy(); cb(null); process.exit(0); });
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

// --- Tool labels ---

function formatToolLabel(toolName, toolInput) {
  if (toolName === 'Read' || toolName === 'Glob') return null;

  if (toolName === 'Agent') return toolInput.description || 'Processing';
  if (toolName === 'Skill') return toolInput.skill || null;
  if (toolName === 'Bash') {
    if (toolInput.description) return toolInput.description;
    const cmd = toolInput.command || '';
    return cmd.slice(0, 60).replace(/\n.*/s, '').trim() || 'Running command';
  }
  if (toolName === 'Write') {
    const name = path.basename(toolInput.file_path || '');
    return name ? `Writing ${name}` : 'Writing file';
  }
  if (toolName === 'Edit') {
    const name = path.basename(toolInput.file_path || '');
    return name ? `Editing ${name}` : 'Editing file';
  }
  if (toolName === 'Grep') return 'Searching codebase';
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const service = parts[1] || '';
    const op = (parts.slice(2).join('-') || '').replace(/-/g, ' ');
    if (service === 'todoist') return `Todoist: ${op}`.slice(0, 50);
    if (service === 'atlassian') return `Atlassian: ${op}`.slice(0, 50);
    return `${service}: ${op}`.slice(0, 50);
  }
  return toolName;
}
