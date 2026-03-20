# Telegram Bot API HTML Reference

Complete reference for `parse_mode: "HTML"` in the Telegram Bot API.

## All Supported Tags

### Text Styling

| Tag | Result | Aliases |
|-----|--------|---------|
| `<b>text</b>` | **bold** | `<strong>` |
| `<i>text</i>` | *italic* | `<em>` |
| `<u>text</u>` | underline | `<ins>` |
| `<s>text</s>` | ~~strikethrough~~ | `<strike>`, `<del>` |
| `<tg-spoiler>text</tg-spoiler>` | spoiler (tap to reveal) | `<span class="tg-spoiler">` |

### Code

| Tag | Result |
|-----|--------|
| `<code>text</code>` | `inline code` |
| `<pre>text</pre>` | code block (monospace, preserves whitespace) |
| `<pre><code class="language-X">text</code></pre>` | syntax-highlighted code block |

Supported language values for `class="language-X"`:
`python`, `javascript`, `typescript`, `bash`, `shell`, `json`, `yaml`, `xml`, `html`, `css`, `sql`, `go`, `rust`, `java`, `kotlin`, `swift`, `c`, `cpp`, `csharp`, `ruby`, `php`, `perl`, `r`, `scala`, `markdown`

### Links

| Tag | Result |
|-----|--------|
| `<a href="URL">text</a>` | clickable link |
| `<a href="tg://user?id=123">text</a>` | inline mention of user by ID |

### Block Quotes

| Tag | Result |
|-----|--------|
| `<blockquote>text</blockquote>` | indented block quote |
| `<blockquote expandable>text</blockquote>` | collapsible quote (shows ~4 lines, tap to expand) |

### Custom Emoji

| Tag | Result |
|-----|--------|
| `<tg-emoji emoji-id="ID">fallback</tg-emoji>` | custom emoji (premium feature) |

## Nesting Rules

### Allowed Nesting

Most inline tags nest freely inside each other:

```html
<b><i>bold italic</i></b>
<b><u><s>bold underline strikethrough</s></u></b>
<i>italic with <code>code</code> inside</i>
<b>bold with <a href="https://example.com">link</a></b>
<blockquote><b>Title</b>
Content with <i>italic</i> and <code>code</code></blockquote>
```

### Forbidden Nesting

These combinations are rejected by Telegram:

- `<pre>` inside `<blockquote>` (code blocks inside quotes)
- `<blockquote>` inside `<blockquote>` (nested quotes)
- `<pre>` inside `<pre>` (nested code blocks)
- `<a>` inside `<a>` (nested links)
- `<code>` inside `<code>` (nested inline code)

## Character Escaping

### In Regular Text

Three characters must be escaped:

| Character | Escape | Example |
|-----------|--------|---------|
| `<` | `&lt;` | `5 &lt; 10` renders as `5 < 10` |
| `>` | `&gt;` | `10 &gt; 5` renders as `10 > 5` |
| `&` | `&amp;` | `A &amp; B` renders as `A & B` |

### Inside `<pre>` and `<code>`

Only `&`, `<`, and `>` need escaping. All other characters are displayed literally (including `*`, `_`, etc.).

### Inside Link URLs

No escaping needed inside `href="..."`. The URL is taken as-is.

### Unsupported Entities

Telegram rejects all other HTML entities. Do NOT use:
- `&nbsp;`, `&mdash;`, `&ndash;`, `&hellip;`, `&quot;`, `&apos;`
- Numeric entities like `&#123;` or `&#x7B;`

Use the literal Unicode characters instead.

## Message Limits

| Limit | Value |
|-------|-------|
| Message text | 4096 characters (including HTML tags) |
| Caption text | 1024 characters |
| Tag characters count toward the limit | Yes |

The `send` tool in the telegram-progress MCP server auto-chunks messages longer than 4096 characters at paragraph boundaries.

## Error Handling

If Telegram cannot parse the HTML, the entire message is rejected with:
```
Bad Request: can't parse entities
```

Common causes:
- Unclosed tags (`<b>text` without `</b>`)
- Unescaped `<` or `&` in text
- Unsupported HTML entities (`&nbsp;`)
- Forbidden nesting (e.g., `<pre>` inside `<blockquote>`)
- Unsupported tags (e.g., `<h1>`, `<p>`, `<br>`, `<div>`)

The `send` and `edit` tools automatically retry as plain text on parse failure.

## Practical Patterns

### Summary with Sections

```html
<b>Todoist Sync Complete</b>

Scanned 31 tasks across Personal, Kinesso, and Kymeta.

<b>4 tasks updated:</b>
- <code>kyiv-krakow buy train tickets</code> renamed, labeled, moved
- <code>Book Alba</code> renamed, labeled, moved
- <code>Update email</code> moved to Kinesso General
- <code>Define team split</code> moved to Kinesso General

<b>Today's priorities (Mar 20):</b>
- <b>p2:</b> Define team split and scope
- <b>p3:</b> Jira account migration (13:30)
- <b>p3:</b> Call Raiffeisen bank
```

### Error Message

```html
<b>Failed:</b> Rate limit reached

Todoist API returned 429. Try again in a few minutes.
```

### Knowledge Note with Quote

```html
<b>The Microbiome Doctor</b>
<i>Tim Spector on The Diary Of A CEO</i>

<blockquote>The gut microbiome is like a garden. You need diversity of plants to have a healthy ecosystem.</blockquote>

<b>Key insights:</b>
- Eat 30 different plants per week
- Fermented foods boost microbiome diversity
- Ultra-processed foods reduce gut bacteria variety
```

### Code Output

```html
Found 3 TODO comments:

<pre><code class="language-text">src/config.ts:42    // TODO: validate env vars
src/server.ts:118   // TODO: add rate limiting
src/auth.ts:7       // TODO: refresh token logic</code></pre>
```
