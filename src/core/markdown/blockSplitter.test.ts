import { describe, expect, it } from 'vitest'

import { blockKey, splitMarkdownBlocks, type MarkdownBlock } from './blockSplitter'

/**
 * 流式渲染的分块器。
 *
 * 这一层错了有两种表现，都不好排查：
 * - **切错**：同一段内容被拆成几块 → 列表重新从 1 开始、表格散架、代码被当正文；
 * - **切不出稳定 key**：前面的块跟着尾块一起变 → 分块白做，性能一点没省。
 *
 * 所以除了"切在哪"，还要钉死"**追加内容时前面的块一字不变**"这条性质 ——
 * 那正是省下解析量的全部依据。
 *
 * Ported 1:1 from Kotlin `MarkdownBlockSplitterTest.kt`.
 */
describe('splitMarkdownBlocks', () => {
  const split = (source: string) => splitMarkdownBlocks(source)

  /** 不变式：每块都必须是原文的**连续子串**（块文本不增不删）。 */
  const assertSubstrings = (source: string, blocks: MarkdownBlock[]) => {
    for (const b of blocks) {
      const end = b.start + b.text.length
      expect(end, `块越界: start=${b.start} len=${b.text.length}`).toBeLessThanOrEqual(
        source.length,
      )
      expect(b.text, '块文本不是原文子串').toBe(source.slice(b.start, end))
    }
  }

  // ── 主用例：空行是边界 ─────────────────────────────────

  it('blank lines separate paragraphs', () => {
    const src = '第一段。\n\n第二段。\n\n第三段。'
    const blocks = split(src)

    expect(blocks.length).toBe(3)
    expect(blocks.map((b) => b.text)).toEqual(['第一段。', '第二段。', '第三段。'])
    expect(blocks.map((b) => b.start)).toEqual([0, 6, 12])
    assertSubstrings(src, blocks)
  })

  it('single block when there is no blank line', () => {
    const src = '只有一段，\n中间没有空行。'
    const blocks = split(src)

    expect(blocks.length).toBe(1)
    expect(blocks[0].text).toBe(src)
    expect(blocks[0].start).toBe(0)
  })

  // ── 围栏：内部绝不切 ──────────────────────────────────

  it('code fence content is never split even with blank lines', () => {
    const src = '看代码：\n\n```kotlin\nval a = 1\n\nval b = 2\n```\n\n就这样。'
    const blocks = split(src)

    expect(blocks.length).toBe(3)
    expect(blocks[0].text).toBe('看代码：')
    expect(blocks[1].text).toBe('```kotlin\nval a = 1\n\nval b = 2\n```')
    expect(blocks[2].text).toBe('就这样。')
    assertSubstrings(src, blocks)
  })

  it('unclosed fence swallows the rest into one block', () => {
    // 流式最常见的形态：代码块还没写完。半截代码必须整块留着，
    // 不能被拆成"正文 + 代码 + 正文"。
    const src = '前言。\n\n```python\ndef f():\n    return 1\n\n还没写完'
    const blocks = split(src)

    expect(blocks.length).toBe(2)
    expect(blocks[0].text).toBe('前言。')
    expect(blocks[1].text.startsWith('```python')).toBe(true)
    expect(blocks[1].text.endsWith('还没写完')).toBe(true)
  })

  it('mismatched fence marker does not close the fence', () => {
    const src = '```\n~~~\n不是围栏\n\n还在代码里\n```'
    const blocks = split(src)

    expect(blocks.length).toBe(1)
    expect(blocks[0].text).toBe(src)
  })

  // ── 同族合并：列表 / 表格 ─────────────────────────────

  it('loose list stays one block', () => {
    // normalizeSoftBreaks 会在列表项之间补空行（松列表）。
    // 若这里不合并，会被拆成两个各自从 1 开始的列表。
    const src = '1. 第一项\n\n2. 第二项\n\n3. 第三项'
    const blocks = split(src)

    expect(blocks.length).toBe(1)
    expect(blocks[0].text).toBe(src)
  })

  it('table rows stay one block', () => {
    const src = '| 名字 | 年龄 |\n\n|---|---|\n\n| 甲 | 20 |'
    const blocks = split(src)

    expect(blocks.length).toBe(1)
    assertSubstrings(src, blocks)
  })

  it('list then paragraph are not merged', () => {
    const src = '- 甲\n\n- 乙\n\n普通段落。'
    const blocks = split(src)

    expect(blocks.length).toBe(2)
    expect(blocks[0].text).toBe('- 甲\n\n- 乙')
    expect(blocks[1].text).toBe('普通段落。')
  })

  it('paragraph then table are not merged', () => {
    // GFM 的表格不能打断段落，紧贴正文的表格根本不会被解析成表格 ——
    // 所以正文与表格之间**要**分开，让 normalize 插的空行生效。
    const src = '表格如下：\n\n| a | b |\n\n|---|---|'
    const blocks = split(src)

    expect(blocks.length).toBe(2)
    expect(blocks[0].text).toBe('表格如下：')
    expect(blocks[1].text).toBe('| a | b |\n\n|---|---|')
  })

  // ── 核心性质：追加内容时前面的块一字不变 ──────────────

  it('appending text keeps earlier blocks identical', () => {
    const before = '第一段。\n\n第二段。\n\n第三段'
    const after = '第一段。\n\n第二段。\n\n第三段写完了。\n\n第四段开始'

    const b1 = split(before)
    const b2 = split(after)

    // 前面已完成的块：文本与 key 都必须原样（界面据此跳过重渲染）
    expect(b1[0].text).toBe(b2[0].text)
    expect(b1[1].text).toBe(b2[1].text)
    expect(blockKey(b1[0])).toBe(blockKey(b2[0]))
    expect(blockKey(b1[1])).toBe(blockKey(b2[1]))

    // 只有尾块在长
    expect(b1[2].text).toBe('第三段')
    expect(b2[2].text.startsWith('第三段')).toBe(true)
  })

  it('appending to an open fence keeps earlier blocks identical', () => {
    const before = '前言。\n\n```kotlin\nval a ='
    const after = '前言。\n\n```kotlin\nval a = 1\nval b = 2'

    const b1 = split(before)
    const b2 = split(after)

    expect(b1.length).toBe(2)
    expect(b2.length).toBe(2)
    expect(blockKey(b1[0])).toBe(blockKey(b2[0]))
    expect(blockKey(b1[1])).toBe(blockKey(b2[1]))
    expect(b2[1].text.endsWith('val b = 2')).toBe(true)
  })

  // ── 边界 ──────────────────────────────────────────────

  it('empty input yields no blocks', () => {
    expect(split('').length).toBe(0)
  })

  it('blank only input yields no blocks', () => {
    expect(split('\n\n\n').length).toBe(0)
  })

  it('keys are unique', () => {
    const blocks = split('甲\n\n乙\n\n丙\n\n丁')
    expect(new Set(blocks.map((b) => blockKey(b))).size).toBe(blocks.length)
  })
})
