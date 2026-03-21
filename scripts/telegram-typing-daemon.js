#!/usr/bin/env node
// Background daemon: typing indicator + progress message editing.
//
// Reads completed steps from /tmp/telegram-progress.jsonl
// Reads current in-progress tool from /tmp/telegram-current-tool.txt
//
// Usage: node telegram-typing-daemon.js <chat_id> [message_id]
// Stop:  write /tmp/telegram-typing-stop
// PID:   written to /tmp/telegram-typing-pid

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const chatId = process.argv[2];
const messageId = process.argv[3] || null;
if (!chatId) process.exit(1);

const tmpDir = os.tmpdir();
const PID_FILE = path.join(tmpDir, 'telegram-typing-pid');
const STOP_FILE = path.join(tmpDir, 'telegram-typing-stop');
const LOG_FILE = path.join(tmpDir, 'telegram-progress.jsonl');
const CURRENT_TOOL_FILE = path.join(tmpDir, 'telegram-current-tool.txt');

// Read token
const envFile = path.join(os.homedir(), '.claude', 'channels', 'telegram', '.env');
let token = '';
try {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^TELEGRAM_BOT_TOKEN=(.+)$/);
    if (m) { token = m[1]; break; }
  }
} catch { process.exit(1); }
if (!token) process.exit(1);

fs.writeFileSync(PID_FILE, String(process.pid));

const MAX_DURATION_MS = 5 * 60 * 1000;
const TYPING_INTERVAL_MS = 4000;
const PROGRESS_INTERVAL_MS = 3000;
const MAX_VISIBLE_STEPS = 15;
const startedAt = Date.now();

let lastProgressHash = '';
let lastEditAt = 0;

function shouldStop() {
  if (Date.now() - startedAt > MAX_DURATION_MS) return true;
  return fs.existsSync(STOP_FILE);
}

function cleanup() {
  try { fs.unlinkSync(PID_FILE); } catch {}
  try { fs.unlinkSync(STOP_FILE); } catch {}
}

// --- Typing ---

function sendTyping() {
  if (shouldStop()) { cleanup(); process.exit(0); }
  telegramPost('sendChatAction', { chat_id: chatId, action: 'typing' });
}

// --- Progress ---

function readProgressLog() {
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function readCurrentTool() {
  try {
    const label = fs.readFileSync(CURRENT_TOOL_FILE, 'utf8').trim();
    return label || null;
  } catch { return null; }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatProgress(entries, currentTool) {
  if (entries.length === 0 && !currentTool) return null;

  const visible = entries.length > MAX_VISIBLE_STEPS
    ? entries.slice(-MAX_VISIBLE_STEPS) : entries;
  const truncated = entries.length > MAX_VISIBLE_STEPS
    ? entries.length - MAX_VISIBLE_STEPS : 0;

  // Collect done labels to avoid showing current tool if already completed
  const doneLabels = new Set(entries.map(e => e.label));

  let lines = [];
  if (truncated > 0) lines.push(`<i>... ${truncated} earlier steps</i>`);
  for (const entry of visible) {
    const label = escapeHtml(entry.label || 'Working').slice(0, 50);
    lines.push(`\u2713 ${label}`);
  }
  // Show current tool only if not already in done log
  if (currentTool && !doneLabels.has(currentTool)) {
    const label = escapeHtml(currentTool).slice(0, 50);
    lines.push(`\u25B8 ${label}\u2026`);
  }

  return '<blockquote>' + lines.join('\n') + '</blockquote>';
}

function updateProgress() {
  if (shouldStop()) { cleanup(); process.exit(0); }
  if (!messageId) return;

  const entries = readProgressLog();
  const currentTool = readCurrentTool();
  if (entries.length === 0 && !currentTool) return;

  const text = formatProgress(entries, currentTool);
  if (!text || text === lastProgressHash) return;

  const elapsed = Date.now() - lastEditAt;
  if (elapsed < 2000) return;

  lastProgressHash = text;
  lastEditAt = Date.now();

  telegramPost('editMessageText', {
    chat_id: chatId,
    message_id: Number(messageId),
    text: text,
    parse_mode: 'HTML',
  });
}

// --- Telegram API ---

function telegramPost(method, body) {
  const postData = JSON.stringify(body);
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/${method}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 3000,
  }, (res) => { res.resume(); });
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.write(postData);
  req.end();
}

// --- Main ---

sendTyping();
const typingInterval = setInterval(sendTyping, TYPING_INTERVAL_MS);
const progressInterval = setInterval(updateProgress, PROGRESS_INTERVAL_MS);

process.on('SIGTERM', () => {
  clearInterval(typingInterval);
  clearInterval(progressInterval);
  cleanup();
  process.exit(0);
});
