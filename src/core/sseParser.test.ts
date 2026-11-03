import { describe, expect, it } from 'vitest'

import {
  parseErrorMessage,
  parseSseLine,
  ToolCallAccumulator,
  type StreamEvent,
} from './sseParser'

/**
 * SSE 解析的边界覆盖。
 *
 * 这些用例对应真实流里会遇到的形态：思考/正文分流、心跳注释、
 * 结束标记、脏数据、流中错误对象。没有 API Key 也能验证协议层正确性。
 *
 * Ported 1:1 from Kotlin `SseLineParserTest.kt`.
 *
 * 类型映射：Kotlin 的 `Result.Events / Done / Ignore` 在 TS 里统一成一个
 * `StreamEvent[]` —— `Done` 是 `{type:'done'}`，`Ignore` 与被忽略的坏数据都是 `[]`。
 * 所有 `StreamEvent.Xxx(...)` 对应 `{type:'xxx', ...}`。
 */
describe('parseSseLine', () => {
  const events = (line: string): StreamEvent[] => parseSseLine(line)

  // ── 正文增量 ──────────────────────────────────────────

  it('解析正文增量', () => {
    const result = events('data: {"choices":[{"index":0,"delta":{"content":"雨是从傍晚开始下的"}}]}')
    expect(result).toEqual([{ type: 'content', text: '雨是从傍晚开始下的' }])
  })

  it('content 为空串时不产生事件', () => {
    const result = events('data: {"choices":[{"index":0,"delta":{"content":""}}]}')
    expect(result).toEqual([])
  })

  // ── 思考增量 ──────────────────────────────────────────

  it('解析 reasoning_content 增量', () => {
    const result = events(
      'data: {"choices":[{"index":0,"delta":{"reasoning_content":"用户要的是第三人称"}}]}',
    )
    expect(result).toEqual([{ type: 'reasoning', text: '用户要的是第三人称' }])
  })

  it('同一条 chunk 同时含 reasoning 与 content 时按顺序派发', () => {
    const result = events(
      'data: {"choices":[{"index":0,"delta":{"reasoning_content":"想","content":"写"}}]}',
    )
    expect(result).toEqual([
      { type: 'reasoning', text: '想' },
      { type: 'content', text: '写' },
    ])
  })

  it('首条 chunk 只有 role 时不产生事件', () => {
    const result = events('data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}')
    expect(result).toEqual([])
  })

  // ── 用量 ─────────────────────────────────────────────

  it('解析 usage', () => {
    const result = events(
      'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":340,"prompt_cache_hit_tokens":80}}',
    )
    expect(result).toEqual([
      { type: 'usage', usage: { promptTokens: 120, completionTokens: 340, cacheHitTokens: 80 } },
    ])
  })

  it('usage 缺失缓存字段时为 null', () => {
    const result = events('data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2}}')

    expect(result).toHaveLength(1)
    const event = result[0]
    expect(event.type).toBe('usage')
    if (event.type === 'usage') {
      expect(event.usage.promptTokens).toBe(1)
      expect(event.usage.completionTokens).toBe(2)
      // Kotlin 的 `String?` 在 TS 里是 `undefined`（字段缺失，不是 0）
      expect(event.usage.cacheHitTokens).toBeUndefined()
    }
  })

  // ── 结束与忽略 ────────────────────────────────────────

  it('DONE 标记返回 Done', () => {
    expect(parseSseLine('data: [DONE]')).toEqual([{ type: 'done' }])
  })

  it('DONE 前有空格也能识别', () => {
    expect(parseSseLine('data:[DONE]')).toEqual([{ type: 'done' }])
  })

  it('空行被忽略', () => {
    expect(parseSseLine('')).toEqual([])
  })

  it('心跳注释被忽略', () => {
    expect(parseSseLine(': keep-alive')).toEqual([])
  })

  it('event 字段被忽略', () => {
    expect(parseSseLine('event: message')).toEqual([])
  })

  it('data 前缀但无内容被忽略', () => {
    expect(parseSseLine('data: ')).toEqual([])
  })

  it('finish_reason 单独出现不产生事件', () => {
    const result = events('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}')
    expect(result).toEqual([])
  })

  // ── 健壮性 ───────────────────────────────────────────

  it('脏数据不抛异常且返回空事件', () => {
    const result = events('data: {这不是合法 JSON')
    expect(result).toEqual([])
  })

  it('未知字段被忽略', () => {
    const result = events(
      'data: {"choices":[{"index":0,"delta":{"content":"好"},"logprobs":null}],"莫名字段":123}',
    )
    expect(result).toEqual([{ type: 'content', text: '好' }])
  })

  it('流中错误对象转成 Error 事件', () => {
    const result = events('data: {"error":{"message":"Rate limit reached","type":"rate_limit"}}')

    expect(result).toHaveLength(1)
    const error = result[0]
    expect(error.type).toBe('error')
    if (error.type === 'error') {
      expect(error.message).toBe('Rate limit reached')
    }
  })

  // ── 错误信息提取 ──────────────────────────────────────

  it('从 error envelope 提取错误信息', () => {
    const raw = '{"error":{"message":"Insufficient Balance","type":"insufficient_quota"}}'
    expect(parseErrorMessage(raw)).toBe('Insufficient Balance')
  })

  it('非 JSON 错误体原样截断返回', () => {
    const raw = 'Bad Gateway'
    expect(parseErrorMessage(raw)).toBe('Bad Gateway')
  })

  it('空错误体返回 null', () => {
    expect(parseErrorMessage(null)).toBeNull()
    expect(parseErrorMessage('   ')).toBeNull()
  })
})

/**
 * 流式 `tool_calls` 分片的拼装。
 *
 * Kotlin 侧没有对应实现（Android 版没有 agent 工具调用），
 * 这些用例按 `ToolCallAccumulator` 的文档契约新写。
 */
describe('ToolCallAccumulator', () => {
  it('拼装按 index 分片的调用参数', () => {
    const accumulator = new ToolCallAccumulator()

    accumulator.apply([
      { index: 0, id: 'call_a', name: 'read_file', argumentsDelta: '{"pa' },
    ])
    accumulator.apply([{ index: 0, argumentsDelta: 'th":"a"}' }])
    accumulator.apply([{ index: 1, id: 'call_b', name: 'list_dir' }])

    expect(accumulator.list()).toEqual([
      { id: 'call_a', name: 'read_file', args: '{"path":"a"}' },
      { id: 'call_b', name: 'list_dir', args: '{}' },
    ])
  })

  it('服务端没给 id 时补一个合成 id', () => {
    const accumulator = new ToolCallAccumulator()

    accumulator.apply([{ index: 2, name: 'glob' }])

    expect(accumulator.list()).toEqual([{ id: 'call_2', name: 'glob', args: '{}' }])
  })

  it('没有名字的分片不出现在结果里', () => {
    const accumulator = new ToolCallAccumulator()

    accumulator.apply([{ index: 0, argumentsDelta: '{}' }])

    expect(accumulator.list()).toEqual([])
    expect(accumulator.size).toBe(1)
  })

  it('clear 之后没有残留', () => {
    const accumulator = new ToolCallAccumulator()
    accumulator.apply([{ index: 0, id: 'call_a', name: 'read_file' }])

    accumulator.clear()

    expect(accumulator.size).toBe(0)
    expect(accumulator.list()).toEqual([])
  })
})
