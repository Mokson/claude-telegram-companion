---
name: init
description: This skill should be used when the user asks to "initialize awesome-claude-telegram", "set up telegram companion", "migrate telegram files", or runs /awesome-claude-telegram:init. Verifies prerequisites, creates default config, and cleans up legacy scattered files.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
---

# Initialize awesome-claude-telegram

Verify prerequisites, create default config, and migrate from the legacy scattered-file layout.

## Prerequisites Check

1. Read `~/.claude/settings.json` and verify `telegram@claude-plugins-official` is in `enabledPlugins` with value `true`
2. Verify `~/.claude/channels/telegram/.env` exists and contains `TELEGRAM_BOT_TOKEN=...`
3. Verify `~/.claude/channels/telegram/access.json` exists

Report any missing prerequisites. If the official telegram plugin is not enabled, stop and tell the user to enable it first.

## Config Setup

Check if `~/.claude/channels/telegram/command-config.json` exists.

If missing, copy from the plugin template:
```bash
cp "${CLAUDE_PLUGIN_ROOT}/config/command-config.example.json" ~/.claude/channels/telegram/command-config.json
```

If it already exists, leave it alone and report its current `progress` settings.

## Legacy Migration

Check for and report these legacy files (from before the plugin existed):

| Legacy file | Replacement |
|-------------|-------------|
| `~/.claude/servers/telegram-progress/` | Plugin's `server/` directory |
| `~/.claude/hooks/telegram-typing-keepalive.js` | Plugin's `scripts/telegram-typing-keepalive.js` |
| `~/.claude/hooks/telegram-typing-daemon.js` | Plugin's `scripts/telegram-typing-daemon.js` |
| `~/.claude/hooks/telegram-sync-commands.js` | Plugin's `scripts/telegram-sync-commands.js` |
| `~/.claude/skills/telegram-formatting/` | Plugin's `skills/telegram-formatting/` |

Check `~/.claude/settings.json` for hook entries referencing these files in `hooks.PreToolUse`, `hooks.PostToolUse`, and `hooks.SessionStart`. List the entries that should be removed.

Check project `.mcp.json` files for a `telegram-progress` entry pointing to the old `~/.claude/servers/` location.

Check `~/.claude/CLAUDE.md` for a `## Telegram` section that is now provided by the plugin's own CLAUDE.md.

Ask the user before deleting anything. Offer to remove each category (files, hook entries, MCP entries, CLAUDE.md section).

## Transcription Setup

Check if voice transcription dependencies are available:

1. Check `ffmpeg` is in PATH: `which ffmpeg`
2. Check `whisper-cpp` is in PATH: `which whisper-cpp`
3. If whisper-cpp found, auto-detect model files in common locations:
   - `/usr/local/share/whisper.cpp/models/`
   - `$(brew --prefix 2>/dev/null)/share/whisper.cpp/models/`
   - `~/.local/share/whisper.cpp/models/`

If both tools are found and a model is detected:
- Read the existing `command-config.json`
- If no `transcription` section exists, offer to add it with the detected binary and model paths
- If `transcription` section already exists, report its current settings

If either tool is missing, report which is missing and note that voice transcription is optional. Voice messages will still be received but arrive as "(voice message)" without transcription.

## Report

Summarize:
- Prerequisites: pass/fail
- Config: created or already exists
- Legacy files found and actions taken
- Transcription: available (binary + model) or not configured
