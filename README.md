# awesome-claude-telegram

Companion plugin for the official [telegram@claude-plugins-official](https://github.com/anthropics/claude-code) Telegram channel. Adds features the official plugin doesn't provide.

## Features

- **HTML Formatting** - `send` and `edit` MCP tools with `parse_mode: "HTML"` support (bold, italic, code, pre, links, blockquotes)
- **Automatic Progress Indicators** - Background daemon keeps "typing..." visible and shows a live step log during long-running tasks
- **Error Forwarding** - Automatically sends tool errors to Telegram when Claude fails silently
- **Command Sync** - Syncs discovered skills to Telegram's BotFather command menu on session start
- **Formatting Skill** - HTML entity reference loaded on demand when formatting Telegram messages

## Prerequisites

- [Claude Code](https://claude.ai/code) with the official `telegram` plugin enabled
- [Bun](https://bun.sh) runtime (used by the MCP server)
- A Telegram bot token configured via the official plugin (`/telegram:configure`)

## Installation

Add the marketplace source and enable the plugin in `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "awesome-claude-telegram": {
      "source": {
        "source": "github",
        "repo": "Mokson/awesome-claude-telegram"
      }
    }
  },
  "enabledPlugins": {
    "awesome-claude-telegram@awesome-claude-telegram": true
  }
}
```

Then restart Claude Code and run:

```
/awesome-claude-telegram:init
```

This verifies prerequisites, creates default config, and offers to clean up any legacy scattered files.

## Configuration

The plugin reads config from `~/.claude/channels/telegram/command-config.json`:

```json
{
  "excludePlugins": [],
  "include": {
    "tasks:todoist_sync": { "command": "todosync", "description": "Organize tasks" }
  },
  "excludeProject": [],
  "extra": [
    { "command": "help", "description": "Show available commands" }
  ],
  "progress": {
    "reaction": false,
    "statusUpdates": true
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `progress.reaction` | `false` | Show emoji reaction on message receipt |
| `progress.statusUpdates` | `true` | Show live progress steps during work |
| `excludePlugins` | `[]` | Plugin keys to exclude from command menu |
| `include` | `{}` | Manual skill-to-command mappings |
| `excludeProject` | `[]` | Project skills to exclude from menu |
| `extra` | `[]` | Additional commands to register |

Changes to `progress.*` require a session restart.

## Architecture

```
Official telegram plugin          awesome-claude-telegram
(message bridge)                  (companion enhancements)

reply (plain text)                send (HTML formatting)
react (emoji)                     edit (HTML formatting)
edit_message (plain text)         typing keepalive daemon
                                  progress step tracking
                                  error forwarding
                                  command sync
```

The companion reads the same bot token and access.json as the official plugin. It makes outbound API calls only (no polling, no message ingestion).

## License

MIT
