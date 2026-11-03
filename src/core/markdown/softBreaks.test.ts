import { describe, expect, it } from 'vitest'

import { normalizeSoftBreaks } from './softBreaks'

/**
 * 软换行 → 段落边界的规范化。
 *
 * 这一层错了，表现是"某一类内容渲染错乱"：段落糊成一坨、代码被拆散、
 * 表格散架、或者模型故意写的段内换行被硬拆成两段。
 * 种类多、又都只在长文里出现，所以把每条规则都钉死。
 *
 * Ported 1:1 from Kotlin `SoftBreaksTest.kt`.
 */
describe('normalizeSoftBreaks', () => {
  const normalize = (input: string) => normalizeSoftBreaks(input)

  // ── 主用例：模型用单换行分段 ─────────────────────────────

  it('bare single newlines become paragraph breaks', () => {
    // 实测：让模型"用单换行分段"时它就是这么写的。
    // markdown 会把这些软换行合并成一个空格，几个自然段糊成一整块。
    const input = '第一段。\n第二段。\n第三段。'

    expect(normalize(input)).toBe('第一段。\n\n第二段。\n\n第三段。')
  })

  it('blank lines are left as they are', () => {
    const input = '第一段。\n\n第二段。'

    expect(normalize(input)).toBe(input)
  })

  // ── 不能动的第 4 条：硬换行是"段内换行" ─────────────────

  it('two trailing spaces mark a deliberate line break inside one paragraph', () => {
    // 实测 DeepSeek 就是这么写段内换行的；动了就把一段拆成两段。
    const input = '句子 A。  \n句子 B。'

    expect(normalize(input)).toBe(input)
  })

  it('trailing backslash is also a deliberate line break', () => {
    const input = '句子 A。\\\n句子 B。'

    expect(normalize(input)).toBe(input)
  })

  // ── 不能动的第 1 条：围栏代码块 ────────────────────────

  it('code fences are never touched', () => {
    const input = '看代码：\n```python\na = 1\nb = 2\n```\n就这样。'

    expect(normalize(input)).toBe('看代码：\n\n```python\na = 1\nb = 2\n```\n\n就这样。')
  })

  it('code fence content is preserved even if it looks like prose', () => {
    const input = '```\n第一行\n第二行\n```'

    expect(normalize(input)).toBe(input)
  })

  it('tilde fences are recognised too', () => {
    const input = '```\n~~~\n不是围栏\n~~~\n```'

    // 外层 ``` 开 → 里面的 ~~~ 不该把状态打乱
    expect(normalize(input)).toBe(input)
  })

  // ── 不能动的第 2 条：表格 ──────────────────────────────

  it('table rows are kept tight', () => {
    const input = '| 名字 | 年龄 |\n|---|---|\n| 甲 | 20 |'

    expect(normalize(input)).toBe(input)
  })

  it('a table right after a paragraph still gets its separator', () => {
    const input = '表格如下：\n| a | b |\n|---|---|'

    expect(normalize(input)).toBe('表格如下：\n\n| a | b |\n|---|---|')
  })

  // ── 不能动的第 5 条：缩进续行 ──────────────────────────

  it('indented continuation lines are not broken apart', () => {
    const input = '1. 第一项\n   续行\n2. 第二项'

    expect(normalize(input)).toBe(input)
  })

  // ── 边界 ──────────────────────────────────────────────

  it('empty input stays empty', () => {
    expect(normalize('')).toBe('')
  })

  it('a single line is unchanged', () => {
    expect(normalize('只有一行')).toBe('只有一行')
  })

  it('heading followed by text gets a break', () => {
    const input = '# 标题\n正文'

    expect(normalize(input)).toBe('# 标题\n\n正文')
  })

  it('already normalised text is idempotent', () => {
    const once = normalize('A\nB\nC')

    expect(normalize(once)).toBe(once)
  })

  // ── 第 6 条：句中标点收尾是同一段的续行 ─────────────────

  it('a line ending with a comma continues the same paragraph', () => {
    // 中文长句被换行截断时行尾就是逗号 —— 不加这条会被拆成两段。
    const input = '他转过身，\n看着窗外。'

    expect(normalize(input)).toBe(input)
  })

  it('an opening bracket on the line end also continues', () => {
    const input = '他说：\n「好的。」'

    expect(normalize(input)).toBe(input)
  })

  it('a line ending with a period still starts a new paragraph', () => {
    // 句号收尾是"一短句一行"的正常分段，不能被上一条吞掉。
    const input = '第一段。\n第二段。'

    expect(normalize(input)).toBe('第一段。\n\n第二段。')
  })

  it('continuation rule applies per line not per paragraph', () => {
    // 逗号行续接、句号行分段，两种情况在同一篇里共存。
    const input = '他转过身，\n看着窗外。\n然后离开了。'

    expect(normalize(input)).toBe('他转过身，\n看着窗外。\n\n然后离开了。')
  })

  it('a continuation line before a new block still breaks', () => {
    // `要点如下：` 末尾是句中标点，但下一行开了列表 —— 必须分块。
    const input = '要点如下：\n- 一'

    expect(normalize(input)).toBe('要点如下：\n\n- 一')
  })

  // ── 不能动的第 7 条：相邻引用行 ────────────────────────

  it('consecutive quote lines stay in one block', () => {
    // 拆开后每段各带一条竖线，看着像两个引用。
    const input = '> 引用第一行。\n> 引用第二行。'

    expect(normalize(input)).toBe(input)
  })

  it('an alert keeps its title and body together', () => {
    // GFM 提示块拆开后标题与正文各成一块。
    const input = '> [!NOTE]\n> 提示正文。'

    expect(normalize(input)).toBe(input)
  })

  it('separate quotes with a blank line are still separate', () => {
    const input = '> 引用一。\n\n> 引用二。'

    expect(normalize(input)).toBe(input)
  })
})
