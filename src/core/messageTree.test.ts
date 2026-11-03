import { describe, expect, it } from 'vitest'

import {
  activePath,
  lastSibling,
  pathTo,
  ROOT_PARENT,
  siblingCounts,
  subtreeIds,
} from './messageTree'
import type { Message } from './types'

/**
 * 树的行走逻辑 —— 一旦错就是"顺序全乱 / 分支切错"，从现象上极难定位。
 *
 * 这里的用例同时是**规格说明**：把"编辑重发 = 挂个新兄弟，旧子树原样留着"
 * 这件事写成可执行的断言。
 *
 * Ported 1:1 from Kotlin `MessageTreeTest.kt`. Kotlin 的 `forkMessages`
 * 在 TS 侧尚未移植，对应 4 个用例本文件未收录（见交付说明）。
 */
describe('MessageTree', () => {
  /** Kotlin `node(...)` 夹具的等价物。 */
  const node = (
    id: string,
    parentId: string = ROOT_PARENT,
    variantIndex = 0,
    active = false,
    content: string = id,
  ): Message => ({
    id,
    conversationId: 'c1',
    parentId,
    variantIndex,
    active,
    role: variantIndex % 2 === 0 ? 'user' : 'assistant',
    content,
    attachments: [],
    reasoning: null,
    steps: [],
    status: 'DONE',
    errorMessage: null,
    model: null,
    thinkingMs: null,
    ttftMs: null,
    tps: null,
    tokensIn: null,
    tokensOut: null,
    createdAt: 0,
  })

  const ids = (messages: Message[]) => messages.map((m) => m.id)

  it('walks the active chain from root to leaf', () => {
    const tree = [
      node('u1', ROOT_PARENT, 0, true),
      node('a1', 'u1', 0, true),
      node('u2', 'a1', 0, true),
      node('a2', 'u2', 0, true),
    ]

    expect(ids(activePath(tree))).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('inactive siblings are not on the path', () => {
    const tree = [
      node('u1', ROOT_PARENT, 0, true),
      node('a1', 'u1', 0, false),
      node('a2', 'u1', 1, true),
    ]

    expect(ids(activePath(tree))).toEqual(['u1', 'a2'])
  })

  it('editing a message keeps the old subtree reachable', () => {
    // 在 u2 上「编辑并重发」：u2' 是新兄弟，旧 u2 的子树（a2、u3）原样留着
    const tree = [
      node('u1', ROOT_PARENT, 0, true),
      node('a1', 'u1', 0, true),
      node('u2', 'a1', 0, false),
      node('a2', 'u2', 0, true),
      node('u3', 'a2', 0, true),
      node('u2b', 'a1', 1, true),
      node('a2b', 'u2b', 0, true),
    ]

    // 当前走的是新分支
    expect(ids(activePath(tree))).toEqual(['u1', 'a1', 'u2b', 'a2b'])

    // 旧分支一条没少，切回 u2 就能看到整条
    const oldBranch = ['u1', 'a1', 'u2', 'a2', 'u3']
    const switched = tree.map((m) => ({ ...m, active: oldBranch.includes(m.id) }))
    expect(ids(activePath(switched))).toEqual(['u1', 'a1', 'u2', 'a2', 'u3'])
  })

  it('switching a variant swaps the whole downstream', () => {
    // i1 下有两个版本：v0 引出 [a1]，v1 引出 [b1]
    const tree = [
      node('root', ROOT_PARENT, 0, true),
      node('x1', 'root', 1, true),
      node('y1', 'x1', 0, true),
    ]

    expect(ids(activePath(tree))).toEqual(['root', 'x1', 'y1'])
  })

  it('sibling counts are keyed by parent', () => {
    const tree = [
      node('u1'),
      node('a1', 'u1', 0),
      node('a2', 'u1', 1),
      node('a3', 'u1', 2),
      node('u2', 'a1'),
    ]

    const counts = siblingCounts(tree)

    expect(counts.get('u1')).toBe(3)
    expect(counts.get('a1')).toBe(1)
    expect(counts.get(ROOT_PARENT)).toBe(1)
  })

  it('subtree includes all descendants across branches', () => {
    const tree = [
      node('u1', ROOT_PARENT, 0, true),
      node('a1', 'u1'),
      node('a1b', 'u1'), // 兄弟，也是 u1 的子树
      node('u2', 'a1'),
      node('u3', 'a1b'),
    ]

    const doomed = new Set(subtreeIds(tree, 'u1'))

    expect(doomed).toEqual(new Set(['u1', 'a1', 'a1b', 'u2', 'u3']))
  })

  it('subtree of a leaf is just itself', () => {
    const tree = [node('u1', ROOT_PARENT, 0, true), node('a1', 'u1', 0, true)]

    expect(subtreeIds(tree, 'a1')).toEqual(['a1'])
  })

  it('empty conversation yields an empty path', () => {
    expect(activePath([])).toEqual([])
  })

  it('a broken cycle does not hang the walker', () => {
    // 数据损坏时也必须能返回，不能用死循环把 UI 线程挂住
    const tree = [node('a', 'b', 0, true), node('b', 'a', 0, true)]

    const path = activePath(tree)

    expect(path.length, `应当及时停下，实际走了 ${path.length} 步`).toBeLessThanOrEqual(2)
  })

  // ── 「从这里新建对话」（§21）────────────────────────────

  it('pathTo cuts the active path at the given message', () => {
    const tree = [
      node('u1', ROOT_PARENT, 0, true),
      node('a1', 'u1', 0, true),
      node('u2', 'a1', 0, true),
      node('a2', 'u2', 0, true),
    ]

    expect(ids(pathTo(tree, 'u2'))).toEqual(['u1', 'a1', 'u2'])
  })

  it('pathTo of the first message is just that message', () => {
    const tree = [node('u1', ROOT_PARENT, 0, true), node('a1', 'u1', 0, true)]

    expect(ids(pathTo(tree, 'u1'))).toEqual(['u1'])
  })

  it('pathTo ignores messages that are not on the active path', () => {
    // u2 是旧分支上的，当前 active 走的是 u2b —— 不该复制到它
    const tree = [
      node('u1', ROOT_PARENT, 0, true),
      node('a1', 'u1', 0, true),
      node('u2', 'a1', 0, false),
      node('u2b', 'a1', 1, true),
    ]

    expect(pathTo(tree, 'u2')).toEqual([])
  })

  // ── lastSibling：删除后接管 active 的那个兄弟 ─────────────
  // Kotlin 侧没有直接用例（只经 `forkMessages` 之外的清理路径调用），按文档契约补两条。

  it('lastSibling returns the highest variantIndex among siblings', () => {
    const tree = [
      node('u1', ROOT_PARENT, 0, true),
      node('a1', 'u1', 0, false),
      node('a3', 'u1', 2, false),
      node('a2', 'u1', 1, true),
    ]

    expect(lastSibling(tree, 'u1')?.id).toBe('a3')
  })

  it('lastSibling returns null when the parent has no children', () => {
    const tree = [node('u1', ROOT_PARENT, 0, true)]

    expect(lastSibling(tree, 'nope')).toBeNull()
  })
})
