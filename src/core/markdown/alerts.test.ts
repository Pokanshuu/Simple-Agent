import { describe, expect, it } from 'vitest'
import { remarkAlerts } from './alerts'

/** Minimal mdast shape: blockquote > paragraph > text. */
function blockquote(text: string) {
  return {
    type: 'root',
    children: [
      {
        type: 'blockquote',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: text }] },
          { type: 'paragraph', children: [{ type: 'text', value: '正文' }] },
        ],
      },
    ],
  }
}

describe('remarkAlerts', () => {
  it('把 [!NOTE] 转成带 data-alert 的 div，并去掉标记', () => {
    const tree = blockquote('[!NOTE] 这是一条提示')
    remarkAlerts()(tree)

    const quote = tree.children[0] as any
    expect(quote.data.hName).toBe('div')
    expect(quote.data.hProperties.className).toEqual(['alert'])
    expect(quote.data.hProperties['data-alert']).toBe('NOTE')
    // The marker is gone, the message survives.
    expect(quote.children[0].children[0].value).toBe('这是一条提示')
    // Sibling paragraphs are untouched.
    expect(quote.children[1].children[0].value).toBe('正文')
  })

  it('识别全部五种类型且大小写无关', () => {
    for (const kind of ['TIP', 'IMPORTANT', 'WARNING', 'CAUTION', 'note']) {
      const tree = blockquote(`[!${kind}] x`)
      remarkAlerts()(tree)
      const quote = tree.children[0] as any
      expect(quote.data.hProperties['data-alert']).toBe(kind.toUpperCase())
    }
  })

  it('普通引用不受影响', () => {
    const tree = blockquote('只是引用')
    remarkAlerts()(tree)
    const quote = tree.children[0] as any
    expect(quote.data).toBeUndefined()
    expect(quote.children[0].children[0].value).toBe('只是引用')
  })

  it('行内的 [!NOTE] 不会被误判（必须在段首）', () => {
    const tree = blockquote('注意 [!NOTE] 不是标题')
    remarkAlerts()(tree)
    const quote = tree.children[0] as any
    expect(quote.data).toBeUndefined()
    expect(quote.children[0].children[0].value).toBe('注意 [!NOTE] 不是标题')
  })
})
