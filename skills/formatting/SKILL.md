---
name: formatting
description: >-
  This skill should be used when replying to Telegram messages or formatting
  text for Telegram. Provides MarkdownV2 formatting rules for the official
  plugin's reply and edit_message tools. Not triggered by general markdown
  questions unrelated to Telegram.
---

# Telegram Message Formatting

Format Telegram replies using the official plugin's `reply` tool with `format: "markdownv2"`.

## MarkdownV2 Syntax

```
*bold*
_italic_
__underline__
~strikethrough~
||spoiler||
`inline code`
```language
code block
```
[link text](https://example.com)
>block quote (each line must start with >)
```

### Escaping

Outside of code blocks, escape these characters with a preceding `\`:

```
_ * [ ] ( ) ~ ` > # + - = | { } . !
```

Example: `Total: 3\.5\!` not `Total: 3.5!`

Inside `` `inline code` `` and ` ```code blocks``` `, only `` ` `` and `\` need escaping.

## Formatting Guidelines

**Structure** - Use MarkdownV2 for visual hierarchy:

```
*Section Title*

Regular text with `inline code` and *emphasis*\.

>Important callout or quoted content

\`\`\`
multi\-line code output
\`\`\`
```

**Lists** - Plain dashes with line breaks:

```
*Changes:*
\- Task renamed to `Buy groceries`
\- Priority set to *p2*
\- Moved to _Personal_ project
```

**What to avoid:**
- Do not use HTML tags. The MarkdownV2 parser ignores them.
- Do not forget to escape special characters. An unescaped `.` or `-` will cause the entire message to fail.
- Do not nest formatting across line boundaries.

## Fallback

If formatting causes errors, retry with plain text (omit `format` parameter or use `format: "text"`).
