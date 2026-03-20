# awesome-claude-telegram

Rich formatting, live progress, voice transcription, and error forwarding for Claude Code's Telegram channel.

The official plugin gives Claude a chat window. This makes it actually good.

| Without | With |
| --- | --- |
| Plain text replies | HTML: bold, code, links, blockquotes |
| Typing vanishes after 5s | Typing persists for up to 5 minutes |
| Silent multi-step tasks | Live step-by-step progress in chat |
| Errors lost in terminal | Errors auto-forwarded to Telegram |
| No command menu | Skills synced to `/` menu |
| Voice messages ignored | Voice transcribed via whisper.cpp |

## Install

```
/plugin marketplace add Mokson/awesome-claude-telegram
/plugin install awesome-claude-telegram@awesome-claude-telegram
```

Restart Claude Code, then:

```
/awesome-claude-telegram:init
```

**Requires:** Official `telegram` plugin enabled, [Bun](https://bun.sh) runtime.

## What's Inside

| Component | Purpose |
| --- | --- |
| **MCP server** (`send`, `edit`) | HTML-formatted replies with auto-chunking and parse error fallback |
| **PreToolUse hook** | Writes current tool label for the progress daemon |
| **PostToolUse hook** | Progress lifecycle: context tracking, daemon spawn, error forwarding |
| **SessionStart hook** | Syncs discovered skills to BotFather's `/` command menu |
| **Typing daemon** | Background process: sends "typing..." every 4s, edits progress message every 3s |
| **Formatting skill** | HTML tag reference Claude loads when formatting for Telegram |
| **Init skill** | Setup wizard: prerequisites, config, transcription, legacy migration |

## How It Works

This plugin sits alongside the official Telegram plugin. The official plugin polls Telegram and delivers messages. This plugin enhances the output and UX.

```
Telegram message arrives
  -> Official plugin routes to Claude
    -> Claude works (tools, subagents, etc.)
      -> [PreToolUse hook] writes tool label to temp file
      -> [PostToolUse hook] tracks progress:
           1. react -> establishes context, kills old daemon
           2. first tool -> sends progress message, spawns daemon
           3. subsequent tools -> appends to progress log
           4. reply/send -> deletes progress, cleanup
           5. error before reply -> forwards error to chat
      -> [Typing daemon] keeps "typing..." alive, edits progress message
    -> Claude calls send/edit with HTML
  -> User sees formatted reply
```

Same bot token, same access control. No conflicts.

### Hooks in Detail

**PostToolUse** is the core. It detects Telegram context by watching for `react` tool calls, then manages the full progress lifecycle:

- On `react`: kills any previous daemon, writes `telegram-active.json` with `chat_id` and `session_id`
- On first non-Telegram tool: sends an initial progress message, spawns the typing daemon as a detached process
- On each subsequent tool: appends a completed-step entry to `telegram-progress.jsonl`
- On `reply`/`send`: deletes the progress message, kills daemon, cleans up temp files
- On tool error (before any reply): sends the error text directly to Telegram via API

**PreToolUse** writes the current tool's human-readable label to `/tmp/telegram-current-tool.txt` so the daemon can show it as in-progress.

**SessionStart** discovers all installed skills (plugins, user skills, project commands) and calls BotFather's `setMyCommands` to populate the `/` command menu.

## Voice Transcription

Requires a [forked Telegram plugin](https://github.com/anthropics/claude-plugins-official) with voice/audio message handlers. When configured, voice messages are transcribed server-side via whisper.cpp and arrive as text.

Configure in `~/.claude/channels/telegram/command-config.json`:

```json
{
  "transcription": {
    "enabled": true,
    "binary": "whisper-cpp",
    "model": "/path/to/ggml-base.en.bin",
    "language": "en"
  }
}
```

**Requires:** `ffmpeg` and `whisper-cpp` in PATH. Without these, voice messages arrive as "(voice message)" with the audio file path in meta.

## Configuration

Edit `~/.claude/channels/telegram/command-config.json`:

| Key | What it does |
| --- | --- |
| `commands.exclude.plugins` | Plugin keys to hide from command menu |
| `commands.exclude.skills` | Individual skill names to hide |
| `commands.aliases` | Map a skill to a custom `/command` name |
| `commands.extra` | Add static commands not tied to skills |
| `progress.reaction` | React with emoji on receipt (default: false) |
| `progress.statusUpdates` | Live step-by-step progress (default: true) |
| `transcription.*` | Voice transcription settings (see above) |

## License

MIT
