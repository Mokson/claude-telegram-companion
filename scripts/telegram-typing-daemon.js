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
const {
  PID_FILE, STOP_FILE,
  readToken, readProgressLog, readCurrentTool, formatProgress,
} = require('./telegram-shared');

const chatId = process.argv[2];
const messageId = process.argv[3] || null;
if (!chatId) process.exit(1);

const token = readToken();
if (!token) process.exit(1);

fs.writeFileSync(PID_FILE, String(process.pid));

const MAX_DURATION_MS = 5 * 60 * 1000;
const TYPING_INTERVAL_MS = 4000;
const PROGRESS_INTERVAL_MS = 3000;
const startedAt = Date.now();

let lastProgressText = '';
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

function updateProgress() {
  if (shouldStop()) { cleanup(); process.exit(0); }
  if (!messageId) return;

  const entries = readProgressLog();
  const currentTool = readCurrentTool();
  if (entries.length === 0 && !currentTool) return;

  const text = formatProgress(entries, currentTool);
  if (!text || text === lastProgressText) return;

  const elapsed = Date.now() - lastEditAt;
  if (elapsed < 2000) return;

  lastProgressText = text;
  lastEditAt = Date.now();

  telegramPost('editMessageText', {
    chat_id: chatId,
    message_id: Number(messageId),
    text,
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
