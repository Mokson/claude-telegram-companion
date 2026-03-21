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

Inside `` `inline code` `` and ` ```code blocks``` `, only `` ` `` and `\` need escaping.

**This is the primary source of formatting errors.** A single unescaped `.` or `-` causes the entire message to fail silently.

## Syntax Reference

| Format | Syntax |
|---|---|
| Bold | `*bold*` |
| Italic | `_italic_` |
| Underline | `__underline__` |
| Strikethrough | `~strikethrough~` |
| Spoiler | `\|\|spoiler\|\|` |
| Inline code | `` `code` `` |
| Code block | ` ```language\ncode\n``` ` |
| Link | `[text](url)` |
| Block quote | `>line` (each line starts with `>`) |

## Formatting Guidelines

Structure replies with visual hierarchy:

```
*Section Title*

Regular text with `inline code` and *emphasis*\.

>Important callout or quoted content

\`\`\`
multi\-line code output
\`\`\`
```

Use escaped dashes for lists:

```
*Changes:*
\- Task renamed to `Buy groceries`
\- Priority set to *p2*
\- Moved to _Personal_ project
```

## Common Escaping Mistakes

- Numbers with decimals: `3\.5` not `3.5`
- List dashes: `\- item` not `- item`
- Exclamations: `Done\!` not `Done!`
- Parentheses in text: `\(optional\)` not `(optional)`
- URLs inside `[text](url)` do not need escaping

## What to Avoid

- HTML tags (the MarkdownV2 parser ignores them)
- Nesting formatting across line boundaries
- Wrapping entire messages in code blocks for non-code content

## Fallback

If formatting causes errors, retry with plain text by omitting the `format` parameter.
