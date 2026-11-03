import { describe, expect, it } from 'vitest'

import { orderedOutgoingMessages } from './requestOrdering'
import type { Attachment, Compaction, Message, MessageRole, MessageStatus } from './types'

/**
 * 请求序列的筛选规则。
 *
 * 输入是**已经走好的活跃路径**（顺序由 `messageTree.activePath` 保证，
 * 见 `messageTree.test.ts`），这里只负责挑哪些发出去。
 *
 * 这一层错了只会表现为"模型答非所问"，从现象上极难定位，所以把规则钉死。
 *
 * Ported 1:1 from Kotlin `RequestOrderingTest.kt`.
 */
describe('orderedOutgoingMessages', () => {
  const msg = (
    id: string,
    parentId: string,
    role: MessageRole,
    content: string,
    status: MessageStatus = 'DONE',
    attachments: Attachment[] = [],
  ): Message => ({
    id,
    conversationId: 'conv',
    parentId,
    variantIndex: 0,
    active: true,
    role,
    content,
    attachments,
    reasoning: null,
    steps: [],
    status,
    errorMessage: null,
    model: null,
    thinkingMs: null,
    ttftMs: null,
    tps: null,
    tokensIn: null,
    tokensOut: null,
    createdAt: 0,
  })

  const compaction = (throughId: string): Compaction => ({
    id: 'c1',
    conversationId: 'conv',
    throughMessageId: throughId,
    summary: '前情提要',
    createdAt: 0,
    updatedAt: 0,
  })

  const ids = (messages: Message[]) => messages.map((m) => m.id)
  const contents = (messages: Message[]) => messages.map((m) => m.content)

  /** 一条正常的 u/a 交替路径。 */
  const chain = (n: number): Message[] => {
    const out: Message[] = []
    let parent = ''
    for (let index = 0; index < n; index++) {
      const id = `m${index}`
      out.push(
        msg(
          id,
          parent,
          index % 2 === 0 ? 'user' : 'assistant',
          `c${index}`,
        ),
      )
      parent = id
    }
    return out
  }

  /**
   * 只挂附件、没打字的用户消息**不能被丢掉**。
   *
   * 这是真实用法："丢一张图进来说『你看看这个』"。
   * 按"正文非空"过滤会把它整条删掉，请求里只剩一串 assistant，
   * 服务端直接回 `Empty input messages` —— 现象是"发了消息但 AI 报错"。
   */
  it('user message with only attachments is kept', () => {
    const path = [
      msg('u1', '', 'user', '', 'DONE', [{ kind: 'image', name: 'a.png', bytes: 4, dataUrl: 'data:image/png;base64,AAAA' }]),
    ]

    expect(ids(orderedOutgoingMessages(path, null))).toEqual(['u1'])
  })

  /** 页脚消息：既没正文也没附件 —— 这才该被丢掉。 */
  it('empty message without attachments is dropped', () => {
    const path = [msg('u1', '', 'user', '你好'), msg('a1', 'u1', 'assistant', '   ')]

    expect(ids(orderedOutgoingMessages(path, null))).toEqual(['u1'])
  })

  it('keeps path order as given', () => {
    const path = chain(4)

    expect(contents(orderedOutgoingMessages(path, null))).toEqual(['c0', 'c1', 'c2', 'c3'])
  })

  it('drops the streaming placeholder', () => {
    const path = [
      msg('u1', '', 'user', 'a'),
      msg('a1', 'u1', 'assistant', '', 'STREAMING'),
    ]

    expect(contents(orderedOutgoingMessages(path, null))).toEqual(['a'])
  })

  it('drops blank content', () => {
    // 重新生成失败会留下空的 active 版本，不该把这一轮发出去
    const path = [
      msg('u1', '', 'user', 'a'),
      msg('a1', 'u1', 'assistant', '   '),
      msg('u2', 'a1', 'user', 'b'),
    ]

    expect(contents(orderedOutgoingMessages(path, null))).toEqual(['a', 'b'])
  })

  it('never starts with an assistant message', () => {
    const path = [
      msg('a0', '', 'assistant', 'orphan'),
      msg('u1', 'a0', 'user', 'a'),
      msg('a1', 'u1', 'assistant', 'b'),
    ]

    const result = orderedOutgoingMessages(path, null)

    expect(result[0].role).toBe('user')
    expect(contents(result)).toEqual(['a', 'b'])
  })

  it('returns empty when there is no user message at all', () => {
    const path = [msg('a0', '', 'assistant', 'orphan')]

    expect(orderedOutgoingMessages(path, null)).toEqual([])
  })

  it('compaction drops everything up to and including the covered node', () => {
    const path = chain(6)

    expect(contents(orderedOutgoingMessages(path, compaction('m3')))).toEqual(['c4', 'c5'])
  })

  it('compaction covering the whole path leaves only the user guard result', () => {
    const path = chain(4)

    // 覆盖到 m2，剩 m3（assistant）→ 首条不是 user → 全丢
    expect(orderedOutgoingMessages(path, compaction('m2'))).toEqual([])
  })

  it('stale compaction from another branch is ignored', () => {
    // 摘要是别的分支留下的（那个 id 不在当前路径上）→ 不该白丢一半上下文
    const path = chain(6)

    expect(contents(orderedOutgoingMessages(path, compaction('不存在的消息')))).toEqual(
      contents(path),
    )
  })
})
