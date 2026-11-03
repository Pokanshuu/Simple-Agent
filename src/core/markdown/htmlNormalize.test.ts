import { describe, expect, it } from 'vitest'

import { normalizeHtml } from './htmlNormalize'

/**
 * HTML → Markdown 折算。
 *
 * 这一层错了，表现是"内容少了"或"正文里一堆尖括号" ——
 * 渲染器对 `HTML_BLOCK` / `HTML_TAG` 没有对应组件，标签与内容都可能消失。
 * 认不出的标签必须**只去标签、留内容**，所以把每类标签都钉死。
 *
 * Ported 1:1 from Kotlin `HtmlNormalizeTest.kt`.
 */
describe('normalizeHtml', () => {
  // 占位文字自己塞进来:纯单测不碰界面语言资源(界面那边随语言取)
  const normalize = (input: string) => normalizeHtml(input, { imageAlt: () => '图片' })

  // ── 行内 ─────────────────────────────────────────────

  it('br becomes a hard line break', () => {
    expect(normalize('a<br>b')).toBe('a  \nb')
  })

  it('self closing br is accepted', () => {
    expect(normalize('a<br/>b')).toBe('a  \nb')
  })

  it('bold tags become emphasis markers', () => {
    expect(normalize('<b>粗</b>')).toBe('**粗**')
    expect(normalize('<strong>粗</strong>')).toBe('**粗**')
  })

  it('italic tags become emphasis markers', () => {
    expect(normalize('<i>斜</i>')).toBe('*斜*')
    expect(normalize('<em>斜</em>')).toBe('*斜*')
  })

  it('strike tags become tildes', () => {
    expect(normalize('<del>删</del>')).toBe('~~删~~')
    expect(normalize('<s>删</s>')).toBe('~~删~~')
  })

  it('inline code tag becomes a backtick span', () => {
    expect(normalize('<code>码</code>')).toBe('`码`')
  })

  it('tag names are case insensitive', () => {
    expect(normalize('<B>x</B>')).toBe('**x**')
  })

  it('attributes are ignored for paired tags', () => {
    expect(normalize('<b class="x">粗</b>')).toBe('**粗**')
  })

  // ── 块级 ─────────────────────────────────────────────

  it('heading tags become atx headings', () => {
    expect(normalize('<h3>标题</h3>')).toBe('\n### 标题\n')
  })

  it('p tag becomes a paragraph boundary', () => {
    expect(normalize('一<p>二')).toBe('一\n\n二')
  })

  it('li becomes a bullet item', () => {
    expect(normalize('<li>项</li>')).toBe('- 项\n')
  })

  it('hr becomes a thematic break', () => {
    expect(normalize('<hr>')).toBe('\n---\n')
  })

  it('unknown tags are stripped but content is kept', () => {
    // 认不出的标签不能把内容吞掉 —— 少一点格式没事，字不能丢。
    expect(normalize('<details><summary>标题</summary>内容</details>')).toBe('\n标题\n内容\n')
  })

  it('self closing block tag produces no stray boundary', () => {
    // 自闭合不该留下"关闭"那一半的语义，也不该多一段空白。
    expect(normalize('<div/>')).toBe('')
  })

  it('repeated blank lines collapse to one', () => {
    expect(normalize('一</p><p>二')).toBe('一\n\n二')
  })

  it('tags that only produce blank lines collapse to nothing', () => {
    expect(normalize('</p><p>')).toBe('')
  })

  // ── 链接与图片 ───────────────────────────────────────

  it('anchor becomes an inline link', () => {
    expect(normalize('<a href="https://a.b">链接</a>')).toBe('[链接](https://a.b)')
  })

  it('anchor without href keeps its text', () => {
    expect(normalize('<a name="x">文字</a>')).toBe('文字')
  })

  it('image keeps its alt text without making an image node', () => {
    // 不加载远程图：造图片节点只会在正文里留一块空白。
    expect(normalize('<img src="a.png" alt="图">')).toBe('图')
  })

  it('image without alt keeps the src', () => {
    expect(normalize('<img src="a.png">')).toBe('a.png')
  })

  it('image without src or alt becomes a placeholder', () => {
    expect(normalize('<img>')).toBe('图片')
  })

  // ── 不能动的地方 ─────────────────────────────────────

  it('autolink is left alone', () => {
    // `<https://…>` 长得像标签，其实是链接。
    expect(normalize('<https://a.b/c>')).toBe('<https://a.b/c>')
  })

  it('email autolink is left alone', () => {
    expect(normalize('<a@b.com>')).toBe('<a@b.com>')
  })

  it('inline code is left alone', () => {
    expect(normalize('`<div>`')).toBe('`<div>`')
  })

  it('fenced code is left alone', () => {
    const input = '```html\n<div>hi</div>\n```'
    expect(normalize(input)).toBe(input)
  })

  it('entities are decoded', () => {
    // 实测：渲染器的 EntityConverter 不还原这些，屏幕上会原样显示 `&amp;`。
    expect(normalize('A &amp; B&nbsp;C')).toBe('A & B C')
  })

  it('numeric entities are decoded', () => {
    expect(normalize('A&#39;B')).toBe("A'B")
  })

  it('decoded angle brackets are escaped so they stay literal', () => {
    // 还原出的 `<` 会被当成 HTML 标签（而标签没有渲染组件），要保住字面量。
    expect(normalize('&lt;div&gt;')).toBe('\\<div\\>')
  })

  it('markdown image keeps its alt text without making an image node', () => {
    // 不加载远程图：图片节点只会在正文里留一大块空白。
    expect(normalize('Markdown 图片：![MD 图片](https://a.b/c.png)')).toBe(
      'Markdown 图片：MD 图片',
    )
  })

  it('plain text is unchanged', () => {
    const input = '一 < 二，三 > 二。'
    expect(normalize(input)).toBe(input)
  })

  // ── 组合 ─────────────────────────────────────────────

  it('mixed inline tags round trip', () => {
    expect(normalize('<b>粗</b>和<i>斜</i>')).toBe('**粗**和*斜*')
  })

  // ── 引用式链接 ───────────────────────────────────────

  it('reference link becomes an inline link', () => {
    // 定义与用法常常被切进不同的块，分块解析查不到定义 → 退回字面。
    const input = '[ref]: https://example.com\n引用式链接：[引用文字][ref]'

    expect(normalize(input)).toBe('引用式链接：[引用文字](https://example.com)')
  })

  it('collapsed reference link uses its own text as the id', () => {
    const input = '[ref]: https://example.com\n看 [ref][]'

    expect(normalize(input)).toBe('看 [ref](https://example.com)')
  })

  it('empty reference text falls back to the title', () => {
    // 移动端没有悬停，标题无处显示 —— 只有文字为空时才拿它当文字。
    const input = '[ref]: https://example.com "只有标题"\n看 [][ref]'

    expect(normalize(input)).toBe('看 [只有标题](https://example.com)')
  })

  it('reference image keeps only its text', () => {
    const input = '[ref]: https://example.com/a.png\n看 ![图][ref]'

    expect(normalize(input)).toBe('看 图')
  })

  it('unknown reference is left as literal text', () => {
    expect(normalize('看 [文字][nope]')).toBe('看 [文字][nope]')
  })

  it('reference definition lines are removed', () => {
    const input = '[ref]: https://example.com\n看 [ref][]'

    expect(normalize(input)).toBe('看 [ref](https://example.com)')
  })

  it('reference links inside code fences are left alone', () => {
    const input = '```\n[ref]: a\n[x][ref]\n```'

    expect(normalize(input)).toBe(input)
  })
})
