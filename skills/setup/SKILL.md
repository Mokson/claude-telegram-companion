---
name: setup
description: >-
  This skill should be used when the user asks to "set up
  claude-telegram-companion", "set up telegram companion", "configure telegram
  companion", or runs /claude-telegram-companion:setup. Verifies prerequisites,
  creates default config, cleans up legacy files, and checks transcription
  tools.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
---

# Set Up claude-telegram-companion

Verify prerequisites, create config, and clean up legacy files from before the plugin existed.

## 1. Prerequisites

1. Read `~/.claude/settings.json` and verify `telegram@claude-plugins-official` is in `enabledPlugins` with value `true`
2. Verify `~/.claude/channels/telegram/.env` exists and contains `TELEGRAM_BOT_TOKEN=...`
3. Verify `~/.claude/channels/telegram/access.json` exists

If the official telegram plugin is not enabled, stop and tell the user to enable it first.

## 2. Config

Check if `~/.claude/channels/telegram/command-config.json` exists.

If missing, copy from the plugin template:
```bash
cp "${CLAUDE_PLUGIN_ROOT}/config/command-config.example.json" ~/.claude/channels/telegram/command-config.json
```

If it already exists, report its current settings.

## 3. Legacy Cleanup

Check for leftover files from before this functionality was packaged as a plugin:

- `~/.claude/hooks/telegram-typing-keepalive.js`
- `~/.claude/hooks/telegram-typing-daemon.js`
- `~/.claude/hooks/telegram-sync-commands.js`
- `~/.claude/skills/telegram-formatting/`
Check `~/.claude/settings.json` for hook entries in `hooks.PreToolUse`, `hooks.PostToolUse`, and `hooks.SessionStart` referencing these files. List any that should be removed.

Check `~/.claude/CLAUDE.md` for a `## Telegram` section now provided by the plugin's own CLAUDE.md.

Ask the user before deleting anything.

## 4. Transcription

Check if voice transcription tools are available:

```bash
which ffmpeg && which whisper-cli && ls ~/.local/share/whisper.cpp/models/*.bin /opt/homebrew/share/whisper.cpp/models/*.bin 2>/dev/null | head -1
```

If missing, note that voice transcription is optional: `brew install whisper-cpp ffmpeg`.

## 5. Report

Summarize:
- Prerequisites: pass/fail
- Config: created or already exists
- Legacy files found and actions taken
- Transcription: available or not installed (optional)
