---
name: telegram-markdownv2
description: >-
  This skill should be used when composing a reply to a Telegram message,
  calling the official plugin's reply or edit_message tools with format
  "markdownv2", or when the user asks to "format for Telegram", "fix Telegram
  formatting", or "send formatted message". Provides MarkdownV2 escaping rules
  and syntax required by the Telegram Bot API. Not triggered by general
  markdown or HTML questions unrelated to Telegram.
---

# Telegram MarkdownV2 Formatting

Format all Telegram replies using the official plugin's `reply` tool with `format: "markdownv2"`. Use `edit_message` with `format: "markdownv2"` for interim progress updates.

## Escaping Rules

Outside of code spans and code blocks, escape these characters with a preceding `\`:

```
_ * [ ] ( ) ~ ` > # + - = | { } . !
```

**Inside code blocks and inline code, do NOT escape special characters** (except `` ` `` and `\` themselves). The triple backticks that open and close code blocks are NOT escaped either.

**This is the primary source of formatting errors.** A single unescaped `.` or `-` in regular text causes the entire message to fail. But over-escaping inside code blocks also causes failures.

## Code Block Rules

Code blocks use unescaped triple backticks. Content inside is literal:

    ```python
    def hello():
        print("Hello!")
    ```

Do NOT write `\`\`\`` - that creates literal backtick characters, not a code block. Do NOT escape `(`, `)`, `-`, `.` or other characters inside the code block.

## Syntax Reference

| Format | Syntax |
|---|---|
| Bold | `*bold*` |
| Italic | `_italic_` |
| Underline | `__underline__` |
| Strikethrough | `~strikethrough~` |
| Spoiler | `\|\|spoiler\|\|` |
| Inline code | `` `code` `` |
| Code block | unescaped ` ``` ` with content as-is |
| Link | `[text](url)` |
| Block quote | `>line` (each line starts with `>`) |

## Example Message

A correctly formatted message looks like this (shown as the raw string passed to `reply`):

    *Task Complete*\n\nUpdated `config\.json` with new settings\.\n\n```json\n{"key": "value"}\n```\n\n\- Status: *done*\n\- Files changed: `2`

Key points in this example:
- `\.` escapes the dot in `config\.json` (outside code) but NOT inside the code block
- `\-` escapes dashes for list items (outside code)
- The ````json` and closing ```` ``` ```` are NOT escaped
- `{"key": "value"}` inside the code block has no escaping

## Common Escaping Mistakes

- Numbers with decimals: `3\.5` not `3.5`
- List dashes: `\- item` not `- item`
- Exclamations: `Done\!` not `Done!`
- Parentheses in text: `\(optional\)` not `(optional)`
- Equals signs: `deficiency \= 40%` not `deficiency = 40%`
- URLs inside `[text](url)` do not need escaping
- Code block backticks: use ```` ``` ```` NOT `\`\`\``
- Content inside code blocks: no escaping needed

## What to Avoid

- Escaping characters inside code blocks (most common cause of failures)
- HTML tags (the MarkdownV2 parser ignores them)
- Nesting formatting across line boundaries
- Wrapping entire messages in code blocks for non-code content

## Fallback

If formatting causes errors, retry with plain text by omitting the `format` parameter.
