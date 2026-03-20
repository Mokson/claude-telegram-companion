# awesome-claude-telegram

The official Telegram plugin gives Claude a chat window. This plugin makes it actually good.

**Before:** Claude sends plain text, typing indicator vanishes after 5 seconds, long tasks produce silence, errors disappear into the terminal.

**After:** Rich HTML formatting, persistent typing indicators, live progress tracking with step-by-step updates, automatic error forwarding, and your skills auto-synced to the Telegram command menu.

## What You Get

**Rich Formatting** - Bold, italic, code blocks, links, blockquotes. Claude's replies look professional instead of flat text walls.

**Live Progress** - When Claude runs a multi-step task (syncing Todoist, extracting wisdom from a video, searching code), Telegram shows each step as it completes:

```
> Todoist: find tasks by date
> Todoist: get overview
> Todoist full sync           (in progress)
```

**Typing That Doesn't Lie** - The "typing..." indicator stays visible for the entire duration of work, including during subagent runs that take minutes.

**Error Forwarding** - If a tool fails before Claude sends a reply, the error goes to Telegram automatically. No more staring at a chat wondering if anything happened.

**Command Menu Sync** - Your installed skills appear in Telegram's `/` command menu. Type `/` and see what Claude can do.

## Installation

```
/plugin marketplace add Mokson/awesome-claude-telegram
/plugin install awesome-claude-telegram@awesome-claude-telegram
```

Restart Claude Code, then run:

```
/awesome-claude-telegram:init
```

### Prerequisites

- Official `telegram` plugin enabled and configured (`/telegram:configure`)
- [Bun](https://bun.sh) runtime

## Configuration

Edit `~/.claude/channels/telegram/command-config.json`:

| Setting | Default | What it does |
|---------|---------|--------------|
| `progress.reaction` | `false` | React with an emoji when a message arrives |
| `progress.statusUpdates` | `true` | Show live step-by-step progress |
| `include` | `{}` | Map skills to Telegram `/commands` |
| `excludePlugins` | `[]` | Hide plugins from the command menu |

Changes to `progress.*` take effect on session restart.

## How It Works

This plugin sits alongside the official Telegram plugin. The official plugin handles message delivery (polling, access control, inbound routing). This plugin adds everything on top:

| Official plugin | This plugin |
|-----------------|-------------|
| `reply` (plain text) | `send` (HTML formatting) |
| `edit_message` (plain text) | `edit` (HTML formatting) |
| 5-second typing indicator | Persistent typing + progress steps |
| Silent tool failures | Error auto-forwarded to chat |
| No command menu | Skills synced to BotFather |

Same bot token, same access control. No conflicts.

## License

MIT
