---
name: setup
description: This skill should be used when the user asks to "set up awesome-claude-telegram", "set up telegram companion", "migrate telegram files", or runs /awesome-claude-telegram:setup. Verifies prerequisites, creates default config, and cleans up legacy scattered files.
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

## Transcription Check

Check if voice transcription tools are available:

```bash
which ffmpeg && which whisper-cli && ls ~/.local/share/whisper.cpp/models/*.bin /opt/homebrew/share/whisper.cpp/models/*.bin 2>/dev/null | head -1
```

Report status. If missing, note that voice transcription is optional and point to: `brew install whisper-cpp ffmpeg`.

## Report

Summarize:
- Prerequisites: pass/fail
- Config: created or already exists
- Legacy files found and actions taken
- Transcription tools: available or not installed (optional)
