---
name: formatting
description: This skill should be used when replying to Telegram messages, formatting text for Telegram, using the telegram-progress send or edit tools, or when the user asks to "format for Telegram", "style Telegram message", or "send formatted message". Provides HTML formatting rules for Telegram Bot API messages. Not triggered by general markdown or HTML questions unrelated to Telegram.
---

# Telegram Message Formatting

Format all Telegram replies using HTML parse mode via the `telegram-progress` MCP server's `send` and `edit` tools. The plugin's `reply` and `edit_message` tools send plain text only.

## Tools

| Tool | Purpose |
|------|---------|
| `telegram-progress` `send` | Send formatted message (supports `format: "html"`) |
| `telegram-progress` `edit` | Edit message with formatting (supports `format: "html"`) |
| Plugin `reply` | Plain text only. Use only for file attachments. |
| Plugin `edit_message` | Plain text only. Avoid for formatted content. |

## HTML Formatting Reference

### Supported Tags

```
<b>bold</b>
<i>italic</i>
<u>underline</u>
<s>strikethrough</s>
<code>inline code</code>
<pre>code block</pre>
<pre><code class="language-python">highlighted code</code></pre>
<a href="https://example.com">link text</a>
<blockquote>block quote</blockquote>
<blockquote expandable>expandable quote (collapsed by default)</blockquote>
<tg-spoiler>hidden until tapped</tg-spoiler>
<tg-emoji emoji-id="5368324170671202286">emoji</tg-emoji>
```

### Nesting

Tags nest freely. Common patterns:

```html
<b>Bold with <i>italic</i> inside</b>
<b><i><u>bold italic underlined</u></i></b>
<blockquote><b>Heading</b>
Body text with <code>code</code></blockquote>
```

### Escaping

Escape these characters in regular text (outside tags):

| Character | Escape |
|-----------|--------|
| `<` | `&lt;` |
| `>` | `&gt;` |
| `&` | `&amp;` |

Inside `<pre>` and `<code>` blocks, no escaping needed except for the closing tag itself.

## Formatting Guidelines

### Structure

Use HTML tags for visual hierarchy, not plain-text workarounds:

```html
<b>Section Title</b>

Regular paragraph text with <code>inline code</code> and <b>emphasis</b>.

<blockquote>Important callout or quoted content</blockquote>

<pre>multi-line
code output</pre>
```

### Lists

Telegram has no list tags. Use plain dashes or bullets with line breaks:

```html
<b>Changes:</b>
- Task renamed to <code>Buy groceries</code>
- Priority set to <b>p2</b>
- Moved to <i>Personal</i> project
```

### Code

Use `<code>` for inline references (file names, commands, values). Use `<pre>` for multi-line output or code blocks:

```html
Run <code>npm install</code> in the project root.

<pre><code class="language-bash">cd ~/project
npm install
npm run build</code></pre>
```

### Links

```html
See <a href="https://example.com/docs">the documentation</a> for details.
```

### What to Avoid

- Do not use Markdown syntax (`**bold**`, `` `code` ``). The HTML parser ignores it.
- Do not use `<br>` tags. Use literal newlines.
- Do not use `<p>` tags. Use double newlines for paragraph breaks.
- Do not use `<h1>`-`<h6>`. Use `<b>` for headings with a newline after.
- Do not nest `<pre>` inside `<blockquote>` (Telegram rejects it).
- Do not use HTML entities other than `&lt;`, `&gt;`, `&amp;` (others are unsupported).

## Fallback Behavior

The `send` and `edit` tools automatically retry as plain text if Telegram rejects the HTML. Malformed tags cause the entire message to fail parsing, so always close tags properly.

## Additional Resources

### Reference Files

For the complete tag reference with edge cases and examples:
- **`references/html-reference.md`** - Full HTML entity reference with nesting rules, language codes, and character limits
