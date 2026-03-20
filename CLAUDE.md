# awesome-claude-telegram

Companion enhancements for the official Telegram channel plugin.

## Telegram

**This section applies ONLY when handling messages from the Telegram channel** (indicated by `<channel source="telegram">` tags). Do NOT use `telegram-progress` tools or `telegram-formatting` skill for terminal interactions.

**CRITICAL: The Telegram user cannot see your terminal output. Every outcome (success, failure, or partial result) MUST be communicated back to Telegram. If a tool call, skill, or subagent fails, immediately send the error. Silence is the worst UX.**

**Each incoming message gets its own reply.** Never edit a message that was sent in response to a previous request. If a prior attempt failed and the user retries, send a fresh message.

### Formatting

Use `telegram-progress` `send` and `edit` tools for all Telegram replies. These support HTML formatting. The plugin's `reply` and `edit_message` are plain text only; use them only for file attachments.

Format replies with HTML for readability:
- `<b>` for section headings and key labels
- `<code>` for task names, file names, commands, values
- `<pre>` for multi-line output or code blocks
- `<i>` sparingly for metadata or secondary info
- Plain dashes for lists, line breaks for structure

Keep formatting minimal and professional. No decorative markup. Use `<b>` and `<code>` as the primary tools; everything else only when it adds clarity. Refer to the `telegram-formatting` skill for the full HTML tag reference.

Do NOT wrap entire messages in `<pre>` or `<code>`. These are for actual code, commands, or technical values only. Regular text, task lists, and summaries should use `<b>` for headings and plain text for content.

### Reactions

Always call `react` with emoji `👀` on the incoming message as the first step. A PreToolUse hook reads `progress.reaction` from `command-config.json` and blocks the API call when reactions are disabled, while still establishing the context needed for progress tracking. Do NOT react on completion or failure.

### Progress indicators

Progress is **fully automatic**. Hooks establish Telegram context from `react` and spawn a background daemon that:

- Keeps "typing..." visible for up to 5 minutes (including during subagent runs)
- Edits the reply message with a live step log showing each tool as it completes
- Works across subagents (global state, not per-session)
- On tool errors before any reply was sent, injects a reminder to send the error to Telegram

Follow this flow:

1. `react` with `👀` on the incoming message
2. Do the actual work (tool calls, subagents, etc.) - progress updates automatically
3. On success: `telegram-progress` `send` with the final formatted answer
4. On failure: `telegram-progress` `send` with the error message

### Media Messages

Voice/audio messages are auto-transcribed by the plugin and arrive as text. If transcription is not configured, they arrive as "(voice message)" with `audio_path` in meta.

Documents arrive with `document_path` and `file_name`. Read if text/PDF. Photos: `image_path` - Read with Read tool. Videos: `video_path` - acknowledge receipt.
