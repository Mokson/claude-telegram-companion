# claude-telegram-companion

Companion enhancements for the official Telegram channel plugin.

## Telegram

**This section applies ONLY when handling messages from the Telegram channel** (indicated by `<channel source="telegram">` tags). For terminal interactions, ignore these instructions.

**CRITICAL: The Telegram user cannot see your terminal output. Every outcome (success, failure, or partial result) MUST be communicated back via the `reply` tool. Silence is the worst UX.**

**Each incoming message gets its own reply.** Never edit a message that was sent in response to a previous request.

### Formatting

Use the official plugin's `reply` tool with `format: "markdownv2"` for all Telegram replies. This enables bold, italic, code, links, and other Telegram formatting.

MarkdownV2 requires escaping these characters outside of code blocks: `_ * [ ] ( ) ~ > # + - = | { } . !`

Use `edit_message` with `format: "markdownv2"` for interim progress updates. Edits don't trigger push notifications, so send a new `reply` when a long task completes.

### Progress indicators

Progress is **fully automatic**. Hooks spawn a background daemon that:

- Keeps "typing..." visible for up to 5 minutes (including during subagent runs)
- Edits the reply message with a live step log showing each tool as it completes
- Works across subagents (global state, not per-session)
- On tool errors before any reply was sent, injects a reminder to send the error to Telegram

### Media Messages

Voice and audio messages arrive with `attachment_kind` of `voice` or `audio` and an `attachment_file_id`. Use the `transcribe` skill to download and transcribe them.

Documents arrive with `attachment_file_id`. Download with `download_attachment`, then Read if text/PDF. Photos arrive with `image_path` already downloaded. Videos: acknowledge receipt.
