import { test, expect, describe } from 'bun:test'
import { githubMdToTelegramMdV2, entitiesToMarkdown, prepareRichMarkdown, inlineMdToRichHtml, embedRichMedia, expandRichButtons, stripRichButtons, disableRichButtons, richToPlain, type InboundEntity } from './markdown.ts'

describe('rich buttons', () => {
  test('a line of button links becomes one row; an inline link an inline button', () => {
    const md = 'Pick:\n[Yes](tg://button?data=y&style=success) [No](tg://button?data=n)\nor [skip](tg://button?data=s) it'
    const { markdown, buttons } = expandRichButtons(md, 'usr:')
    expect(markdown).toBe('Pick:\n<tg-button-row><tg-button type="callback_data" data="usr:y" style="success">Yes</tg-button><tg-button type="callback_data" data="usr:n">No</tg-button></tg-button-row>\n'
      + 'or <tg-button type="callback_data" data="usr:s">skip</tg-button> it')
    expect(buttons.map(b => b.data)).toEqual(['usr:y', 'usr:n', 'usr:s'])
  })

  test('fenced and inline code keep button syntax literal', () => {
    const md = '```\n[Yes](tg://button?data=y)\n```'
    expect(expandRichButtons(md, 'usr:').markdown).toBe(md)
    const inline = 'Write `[x](tg://button?style=primary)` to add one'
    expect(expandRichButtons(inline, 'usr:')).toEqual({ markdown: inline, buttons: [] })
    expect(stripRichButtons(inline, 'usr:').markdown).toBe(inline)
  })

  test('labels and data are escaped; unknown styles dropped; missing or oversize data throws', () => {
    expect(expandRichButtons('[a<b](tg://button?data=%22x%22&style=neon)', 'usr:').markdown)
      .toBe('<tg-button-row><tg-button type="callback_data" data="usr:&quot;x&quot;">a&lt;b</tg-button></tg-button-row>')
    expect(() => expandRichButtons('[x](tg://button?style=primary)', 'usr:')).toThrow(/needs a data/)
    expect(() => expandRichButtons(`[x](tg://button?data=${'a'.repeat(61)})`, 'usr:')).toThrow(/too long/)
  })

  test('fallback strips buttons and drops lines left empty', () => {
    const { markdown, buttons } = stripRichButtons('Pick:\n[Yes](tg://button?data=y) [No](tg://button?data=n)\nend', 'usr:')
    expect(markdown).toBe('Pick:\nend')
    expect(buttons).toEqual([{ text: 'Yes', data: 'usr:y' }, { text: 'No', data: 'usr:n' }])
  })

  test('disable marks the chosen button and keeps only its style', () => {
    const { markdown } = expandRichButtons('[Yes](tg://button?data=y&style=success) [No](tg://button?data=n&style=danger)', 'usr:')
    expect(disableRichButtons(markdown, 'usr:y'))
      .toBe('<tg-button-row><tg-button type="disabled" style="success">✓ Yes</tg-button><tg-button type="disabled">No</tg-button></tg-button-row>')
  })
})

describe('richToPlain', () => {
  test('flattens blocks to lines and inline runs to text, skipping urls', () => {
    const msg = {
      blocks: [
        { type: 'heading', size: 2, text: 'Plan' },
        { type: 'paragraph', text: ['Use ', { type: 'bold', text: 'bun' }, ' and ', { type: 'url', text: 'docs', url: 'https://x' }] },
        { type: 'list', items: [{ label: '1.', blocks: [{ type: 'paragraph', text: 'one' }] }] },
        { type: 'table', cells: [[{ text: 'A' }, { text: 'B' }]] },
        { type: 'buttons', buttons: [{ text: 'Go', callback_data: 'usr:go' }] },
      ],
    }
    expect(richToPlain(msg)).toBe('Plan\nUse bun and docs\n1. one\nA | B\n[Go]')
  })

  test('quote rich_texts read as one line', () => {
    expect(richToPlain([{ type: 'italic', text: 'quoted' }, ' bit'])).toBe('quoted bit')
  })
})

describe('prepareRichMarkdown', () => {
  test('plain markdown passes through unchanged', () => {
    const md = '## Title\n\n- **a**\n- _b_\n\n> quote'
    expect(prepareRichMarkdown(md)).toBe(md)
  })

  test('>! quote becomes an expandable blockquote with inline HTML', () => {
    expect(prepareRichMarkdown('intro\n>! **Head**\n> line `x<y`'))
      .toBe('intro\n\n<blockquote expandable><b>Head</b><br>line <code>x&lt;y</code></blockquote>\n')
  })

  test('GFM table becomes a compact HTML table with alignment', () => {
    expect(prepareRichMarkdown('| A | B |\n|:--|--:|\n| **1** | 2 |'))
      .toBe('\n<table compact><tr><th align="left">A</th><th align="right">B</th></tr><tr><td align="left"><b>1</b></td><td align="right">2</td></tr></table>\n')
  })

  test('fenced code is left alone, even when unclosed', () => {
    const md = '```\n| A | B |\n|---|---|\n>! x\n```'
    expect(prepareRichMarkdown(md)).toBe(md)
    const open = 'text\n~~~\n| A | B |\n|---|---|'
    expect(prepareRichMarkdown(open)).toBe(open)
  })

  test('an image inside a plain quote is not an expandable marker', () => {
    const md = '> ![](tg://photo?id=f1)'
    expect(prepareRichMarkdown(md)).toBe(md)
  })
})

describe('embedRichMedia', () => {
  const photo = (id: string) => ({ id, scheme: 'photo' as const })
  test('appends unplaced files, 2+ photos as a collage', () => {
    expect(embedRichMedia('hi\n', [photo('f1'), photo('f2'), { id: 'f3', scheme: 'document' }]))
      .toBe('hi\n\n<tg-collage>\n\n![](tg://photo?id=f1)\n![](tg://photo?id=f2)\n\n</tg-collage>\n\n![](tg://document?id=f3)')
  })

  test('fixes the scheme of placed references and skips them when appending', () => {
    expect(embedRichMedia('![cap](tg://photo?id=f1)', [{ id: 'f1', scheme: 'document' }]))
      .toBe('![cap](tg://document?id=f1)')
  })
})

describe('inlineMdToRichHtml', () => {
  test('converts inline markdown and escapes HTML', () => {
    expect(inlineMdToRichHtml('**b** _i_ ~~s~~ ||sp|| [l](https://a.b/?x=1&y=2) <t>'))
      .toBe('<b>b</b> <i>i</i> <s>s</s> <tg-spoiler>sp</tg-spoiler> <a href="https://a.b/?x=1&amp;y=2">l</a> &lt;t&gt;')
  })

  test('emphasis passes never touch link targets', () => {
    expect(inlineMdToRichHtml('[x](https://e.com/a/_b_/c?k=YQ==&s=Zg==) [w](https://w.org/Foo_(bar))'))
      .toBe('<a href="https://e.com/a/_b_/c?k=YQ==&amp;s=Zg==">x</a> <a href="https://w.org/Foo_(bar)">w</a>')
  })

  test('leaves snake_case and code content alone', () => {
    expect(inlineMdToRichHtml('my_var `**x**`')).toBe('my_var <code>**x**</code>')
  })
})

describe('githubMdToTelegramMdV2', () => {
  test('escapes MarkdownV2 specials in plain text', () => {
    expect(githubMdToTelegramMdV2('a.b-c!')).toBe('a\\.b\\-c\\!')
  })

  test('bold / italic / strikethrough', () => {
    expect(githubMdToTelegramMdV2('**bold**')).toBe('*bold*')
    expect(githubMdToTelegramMdV2('_italic_')).toBe('_italic_')
    expect(githubMdToTelegramMdV2('~~gone~~')).toBe('~gone~')
  })

  test('inline code keeps content literal', () => {
    expect(githubMdToTelegramMdV2('`a.b-c`')).toBe('`a.b-c`')
  })

  test('links escape text but not the url', () => {
    expect(githubMdToTelegramMdV2('[my text](http://a.com/x)')).toBe('[my text](http://a.com/x)')
  })

  test('code fences are preserved, content unescaped', () => {
    expect(githubMdToTelegramMdV2('```js\nconst x = 1.5\n```')).toBe('```js\nconst x = 1.5\n```')
  })

  // New formatting

  test('spoiler', () => {
    expect(githubMdToTelegramMdV2('||secret||')).toBe('||secret||')
    expect(githubMdToTelegramMdV2('||a.b||')).toBe('||a\\.b||')
  })

  test('blockquote prefixes each line, no escaped >', () => {
    expect(githubMdToTelegramMdV2('> quoted')).toBe('>quoted')
    expect(githubMdToTelegramMdV2('> a\n> b')).toBe('>a\n>b')
  })

  test('expandable blockquote opens with **> and closes with ||', () => {
    expect(githubMdToTelegramMdV2('>! a\n> b')).toBe('**>a\n>b||')
    expect(githubMdToTelegramMdV2('>! only')).toBe('**>only||')
  })

  test('blockquote content still gets inline formatting', () => {
    expect(githubMdToTelegramMdV2('> **hi** there')).toBe('>*hi* there')
  })

  test('custom emoji passthrough', () => {
    expect(githubMdToTelegramMdV2('![👍](tg://emoji?id=123)')).toBe('![👍](tg://emoji?id=123)')
  })

  test('non-emoji image syntax is not treated as custom emoji (! escaped, link kept)', () => {
    // tg://emoji is required for custom emoji; a normal image degrades to an
    // escaped "!" followed by an ordinary link.
    expect(githubMdToTelegramMdV2('![alt](http://a.com/i.png)')).toBe('\\![alt](http://a.com/i.png)')
  })
})

describe('entitiesToMarkdown', () => {
  test('plain text passes through unchanged', () => {
    expect(entitiesToMarkdown('hello world', [])).toBe('hello world')
    expect(entitiesToMarkdown('hello world', undefined)).toBe('hello world')
  })

  const e = (type: string, offset: number, length: number, extra: Partial<InboundEntity> = {}): InboundEntity =>
    ({ type, offset, length, ...extra })

  test('bold / spoiler / code', () => {
    expect(entitiesToMarkdown('hello', [e('bold', 0, 5)])).toBe('**hello**')
    expect(entitiesToMarkdown('abc', [e('spoiler', 0, 3)])).toBe('||abc||')
    expect(entitiesToMarkdown('x', [e('code', 0, 1)])).toBe('`x`')
  })

  test('text_link', () => {
    expect(entitiesToMarkdown('click', [e('text_link', 0, 5, { url: 'http://x' })])).toBe('[click](http://x)')
  })

  test('blockquote prefixes every line', () => {
    expect(entitiesToMarkdown('line1\nline2', [e('blockquote', 0, 11)])).toBe('> line1\n> line2')
  })

  test('nested entities wrap correctly', () => {
    // bold over "abcd", italic over "bc"
    expect(entitiesToMarkdown('abcd', [e('bold', 0, 4), e('italic', 1, 2)])).toBe('**a_bc_d**')
  })

  test('custom emoji keeps its fallback glyph', () => {
    expect(entitiesToMarkdown('👍', [e('custom_emoji', 0, 2)])).toBe('👍')
  })

  test('unknown entity types pass through', () => {
    expect(entitiesToMarkdown('@name', [e('mention', 0, 5)])).toBe('@name')
  })
})
