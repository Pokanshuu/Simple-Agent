import { describe, expect, it } from 'vitest'

import type { ChatRequestBody } from '../chatRequest'
import type { StreamEvent } from '../sseParser'
import type { AgentStep, ToolCall, ToolResult } from '../types'
import { finalAnswer, finalReasoning, runAgentLoop, type AgentLoopDeps } from './loop'
import type { ToolSpec } from './tools'

/**
 * agent 主循环的控制流。
 *
 * Android 版没有等价实现（没有工具调用），所以这些用例按 `loop.ts` 的契约
 * 新写：每一步都靠注入的 `stream` / `approve` / `execute` 假实现驱动，
 * 不碰网络、窗口或文件系统。
 */
describe('runAgentLoop', () => {
  const TOOLS: ToolSpec[] = [
    {
      name: 'read_file',
      description: 'read',
      parameters: { type: 'object', properties: {} },
      requiresApproval: false,
      category: 'read',
    },
    {
      name: 'write_file',
      description: 'write',
      parameters: { type: 'object', properties: {} },
      requiresApproval: true,
      category: 'write',
    },
  ]

  const ok = (content: string): ToolResult => ({ content, isError: false, durationMs: 1 })

  const makeDeps = (overrides: Partial<AgentLoopDeps> = {}): AgentLoopDeps => ({
    history: [{ role: 'user', content: '你好' }],
    tools: TOOLS,
    maxSteps: 4,
    signal: new AbortController().signal,
    buildBody: (messages) => ({ model: 'test-model', messages, stream: true }),
    stream: async () => {},
    approve: async () => 'allow',
    execute: async () => ok('ok'),
    onStepStart: () => {},
    onDelta: () => {},
    onToolUpdate: () => {},
    ...overrides,
  })

  /** 一次 `stream` 调用播放一组事件；多次调用按 `turns` 顺序播放。 */
  const scriptedStream = (turns: StreamEvent[][]): AgentLoopDeps['stream'] => {
    let turn = 0
    return async (_body, _signal, onEvent) => {
      const events = turns[turn] ?? []
      turn++
      for (const event of events) onEvent(event)
    }
  }

  const toolCallEvent = (index: number, id: string, name: string, args: string): StreamEvent => ({
    type: 'toolCalls',
    deltas: [{ index, id, name, argumentsDelta: args }],
  })

  const recordingBody = (bodies: ChatRequestBody[]): AgentLoopDeps['buildBody'] =>
    (messages, _tools) => {
      bodies.push({ model: 'test-model', messages: [...messages], stream: true })
      return { model: 'test-model', messages, stream: true }
    }

  it('runs a single turn without tools and answers directly', async () => {
    const bodies: ChatRequestBody[] = []
    const steps: AgentStep[] = []

    const result = await runAgentLoop(
      makeDeps({
        buildBody: recordingBody(bodies),
        onStepStart: (step) => steps.push(step),
        stream: scriptedStream([
          [
            { type: 'reasoning', text: '想' },
            { type: 'content', text: '你好' },
            { type: 'usage', usage: { promptTokens: 10, completionTokens: 2 } },
            { type: 'done' },
          ],
        ]),
      }),
    )

    expect(result).toMatchObject({ error: null, stopped: false, exhausted: false })
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].content).toBe('你好')
    expect(result.steps[0].reasoning).toBe('想')
    expect(result.steps[0].toolCalls).toEqual([])
    expect(result.steps[0].usage).toEqual({ promptTokens: 10, completionTokens: 2 })
    expect(steps).toHaveLength(1)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].messages).toEqual([{ role: 'user', content: '你好' }])
    expect(finalAnswer(result.steps)).toBe('你好')
    expect(finalReasoning(result.steps)).toBe('想')
  })

  it('executes a tool call, feeds the result back and continues to the answer', async () => {
    const bodies: ChatRequestBody[] = []
    const executed: ToolCall[] = []

    const result = await runAgentLoop(
      makeDeps({
        buildBody: recordingBody(bodies),
        execute: async (call) => {
          executed.push(call)
          return ok('file body')
        },
        stream: scriptedStream([
          [
            toolCallEvent(0, 'call_1', 'read_file', '{"path"'),
            { type: 'toolCalls', deltas: [{ index: 0, argumentsDelta: ':"a.txt"}' }] },
            { type: 'done' },
          ],
          [{ type: 'content', text: '读到了' }, { type: 'done' }],
        ]),
      }),
    )

    expect(result).toMatchObject({ error: null, stopped: false, exhausted: false })
    expect(result.steps).toHaveLength(2)
    // 分片拼装成完整参数
    expect(result.steps[0].toolCalls).toHaveLength(1)
    expect(result.steps[0].toolCalls[0]).toMatchObject({
      id: 'call_1',
      name: 'read_file',
      args: '{"path":"a.txt"}',
      status: 'done',
      result: { content: 'file body', isError: false },
    })
    expect(executed).toHaveLength(1)
    expect(finalAnswer(result.steps)).toBe('读到了')

    // 第二轮请求必须带上 assistant(tool_calls) + tool 结果这一对
    expect(bodies).toHaveLength(2)
    expect(bodies[1].messages).toEqual([
      { role: 'user', content: '你好' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'file body' },
    ])
  })

  it('turns a denied call into an error tool result and keeps going', async () => {
    let approvals = 0
    let executions = 0

    const result = await runAgentLoop(
      makeDeps({
        approve: async () => {
          approvals++
          return 'deny'
        },
        execute: async () => {
          executions++
          return ok('should not run')
        },
        stream: scriptedStream([
          [toolCallEvent(0, 'call_1', 'write_file', '{"path":"a.txt"}')],
          [{ type: 'content', text: '好的，不写。' }, { type: 'done' }],
        ]),
      }),
    )

    expect(approvals).toBe(1)
    expect(executions).toBe(0)
    expect(result.steps[0].toolCalls[0].status).toBe('denied')
    expect(result.steps[0].toolCalls[0].result?.isError).toBe(true)
    expect(result.steps[0].toolCalls[0].result?.content).toContain('The user denied this tool call')
    expect(finalAnswer(result.steps)).toBe('好的，不写。')
  })

  it('does not ask for approval when the tool does not require it', async () => {
    let approvals = 0

    const result = await runAgentLoop(
      makeDeps({
        approve: async () => {
          approvals++
          return 'deny'
        },
        stream: scriptedStream([
          [toolCallEvent(0, 'call_1', 'read_file', '{}')],
          [{ type: 'content', text: '好了' }],
        ]),
      }),
    )

    expect(approvals).toBe(0)
    expect(result.steps[0].toolCalls[0].status).toBe('done')
  })

  it('returns stopped when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await runAgentLoop(
      makeDeps({
        signal: controller.signal,
        stream: async () => {
          throw new Error('stream must not run after abort')
        },
      }),
    )

    expect(result).toMatchObject({ error: null, stopped: true, exhausted: false })
    expect(result.steps).toEqual([])
  })

  it('keeps the partial turn and reports stopped when aborted mid-stream', async () => {
    const controller = new AbortController()

    const result = await runAgentLoop(
      makeDeps({
        signal: controller.signal,
        stream: async (_body, _signal, onEvent) => {
          onEvent({ type: 'content', text: '写了一半' })
          controller.abort()
          onEvent({ type: 'done' })
        },
      }),
    )

    expect(result).toMatchObject({ error: null, stopped: true, exhausted: false })
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].content).toBe('写了一半')
    // 没有工具调用 → 这一轮不该被当成"答完"
    expect(finalAnswer(result.steps)).toBe('写了一半')
  })

  it('denies the remaining tool calls when the user stops during execution', async () => {
    const controller = new AbortController()

    const result = await runAgentLoop(
      makeDeps({
        signal: controller.signal,
        execute: async () => {
          controller.abort()
          return ok('done before stop')
        },
        stream: scriptedStream([
          [
            toolCallEvent(0, 'call_1', 'read_file', '{}'),
            toolCallEvent(1, 'call_2', 'read_file', '{}'),
          ],
          // 循环在下一轮开头就发现 aborted，第二次 stream 不会被调用
          [{ type: 'content', text: '不该到这里' }],
        ]),
      }),
    )

    expect(result).toMatchObject({ error: null, stopped: true, exhausted: false })
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].toolCalls[0].status).toBe('done')
    expect(result.steps[0].toolCalls[1].status).toBe('denied')
    expect(result.steps[0].toolCalls[1].result).toEqual({
      content: 'Run stopped by the user.',
      isError: true,
      durationMs: 0,
    })
  })

  it('reports exhausted when maxSteps runs out while tools keep being requested', async () => {
    const result = await runAgentLoop(
      makeDeps({
        maxSteps: 2,
        stream: scriptedStream([
          [toolCallEvent(0, 'call_1', 'read_file', '{}')],
          [toolCallEvent(0, 'call_2', 'read_file', '{}')],
          [{ type: 'content', text: '永不执行' }],
        ]),
      }),
    )

    expect(result).toMatchObject({ error: null, stopped: false, exhausted: true })
    expect(result.steps).toHaveLength(2)
    expect(result.steps.map((step) => step.toolCalls[0].id)).toEqual(['call_1', 'call_2'])
  })

  it('propagates a stream error event and stops the run', async () => {
    const result = await runAgentLoop(
      makeDeps({
        stream: scriptedStream([
          [
            { type: 'content', text: '半句' },
            { type: 'error', message: 'Rate limit reached' },
          ],
          [{ type: 'content', text: '不该继续' }],
        ]),
      }),
    )

    expect(result).toMatchObject({ error: 'Rate limit reached', stopped: false, exhausted: false })
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].content).toBe('半句')
    expect(finalAnswer(result.steps)).toBe('半句')
  })

  it('converts a thrown exec error into an error tool result', async () => {
    const result = await runAgentLoop(
      makeDeps({
        execute: async () => {
          throw new Error('permission denied')
        },
        stream: scriptedStream([
          [toolCallEvent(0, 'call_1', 'read_file', '{}')],
          [{ type: 'content', text: '读不了。' }],
        ]),
      }),
    )

    expect(result.steps[0].toolCalls[0].status).toBe('error')
    expect(result.steps[0].toolCalls[0].result).toEqual({
      content: 'permission denied',
      isError: true,
      durationMs: 0,
    })
    expect(finalAnswer(result.steps)).toBe('读不了。')
  })
})

describe('finalAnswer', () => {
  const step = (content: string, reasoning = ''): AgentStep => ({
    index: 0,
    content,
    reasoning,
    toolCalls: [],
  })

  it('returns the last turn that produced text', () => {
    expect(finalAnswer([step('第一版'), step('  '), step('最终答案')])).toBe('最终答案')
  })

  it('returns an empty string when no turn produced text', () => {
    expect(finalAnswer([step(''), step('   ')])).toBe('')
    expect(finalAnswer([])).toBe('')
  })
})

describe('finalReasoning', () => {
  const step = (content: string, reasoning = ''): AgentStep => ({
    index: 0,
    content,
    reasoning,
    toolCalls: [],
  })

  it('returns the reasoning of the last turn that had any', () => {
    expect(finalReasoning([step('', '第一次思考'), step('答', '第二次思考'), step('答2', '  ')])).toBe(
      '第二次思考',
    )
  })

  it('returns an empty string when no turn reasoned', () => {
    expect(finalReasoning([step('答')])).toBe('')
    expect(finalReasoning([])).toBe('')
  })
})
