# Agent instructions

Plugin `claude-telegram-companion` - self-hosted Telegram MCP server + hooks, forked from the official telegram plugin v0.0.6 with cherry-picked PRs. Since v2.6.0: progress tracking is fully automatic (server writes the hook coordination file on inbound; no `ack` round trip), default `progress.streamMode: "message"` edits one persistent quiet blockquote in place and collapses it to an expandable summary via the Stop hook; `edit_message` tries rich edits (Bot API 10.1) before MarkdownV2.

## Runtime layout and apply procedure

- Dev repo: this checkout (`~/Projects/Personal/claude-telegram-companion/`). Installed marketplace clone: `~/.claude/plugins/marketplaces/claude-telegram-companion/`. The RUNTIME is the versioned cache under `~/.claude/plugins/cache/claude-telegram-companion/claude-telegram-companion/<version>/` (path pinned in `~/.claude/plugins/installed_plugins.json`; hooks and MCP server both run from there).
- To apply changes now: edit the dev repo, copy changed files to BOTH the marketplace clone and the cache dir, then restart the polling leader. Hook scripts apply immediately (spawned per call); server.ts needs the MCP server restarted.
- The polling leader normally lives in the `telegram` tmux session (a dedicated claude listener). Restart: `kill -TERM $(cat ~/.claude/channels/telegram/poll.lock)`, then in tmux drive `/mcp` → select the telegram server → Reconnect (send-keys + capture-pane navigation works). Claude Code does NOT auto-respawn a killed MCP server; followers in other sessions exit when the leader dies and need `/mcp` reconnect too.
- Direct edits to the marketplace clone are overwritten by the next plugin update (git-based) - push to GitHub to make changes durable.

## Channel routing

- `--dangerously-load-development-channels plugin:claude-telegram-companion@claude-telegram-companion` is REQUIRED for channel notifications to surface. Without it, `allowedChannels` is empty and notifications are silently dropped.
- The `tengu_harbor` GrowthBook feature flag gates channel availability server-side. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` defaults all flags (including `tengu_harbor`) to false, breaking channels - keep it unset.
- The dev-channels flag shows an interactive prompt ("I am using this for local development / Exit"). In tmux, `sleep 3 && tmux send-keys Enter` auto-confirms it; `printf '\n' | claude` does NOT work (piping closes stdin).

## Host config

- `telegram@claude-plugins-official` stays disabled in settings.json (duplicate MCP servers race the poll lock; if both are active, inbound messages can drop on provider mismatch).
- `cldt` function in `~/.zshrc` launches with `--dangerously-skip-permissions` + `--dangerously-load-development-channels` + the send-keys auto-confirm.
- `channelsEnabled: true` and `allowedChannelPlugins` set in `~/.claude/settings.json`. Poll lock at `~/.claude/channels/telegram/poll.lock` ensures a single poller.

## Repo gotchas

- `.mcp.json` doubles as the plugin MCP manifest AND a project-scoped server when this repo is cwd. `${CLAUDE_PLUGIN_ROOT}` is only substituted for plugin-loaded servers, so the project-scoped duplicate spawns with the literal string and dies every ~10s with `MCP error -32000`. Keep `"disabledMcpjsonServers": ["telegram"]` in `.claude/settings.local.json`; do NOT remove `.mcp.json` (the plugin loader needs it).
- `patches/` is provenance history from the monorepo extraction, not live machinery.
- Skills: `claude-telegram-companion:access` and `claude-telegram-companion:configure`.
