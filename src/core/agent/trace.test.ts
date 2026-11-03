import { describe, expect, it } from 'vitest'
import { answerStepIndex, bodyReasoning, lastNoToolStepIndex, placeSteps } from './trace'
import type { AgentStep, ToolCall } from '../types'

const call = (id: string): ToolCall => ({
  id,
  name: 'read_file',
  args: '{}',
  status: 'done',
  result: { content: 'ok', isError: false, durationMs: 1 },
})

const step = (index: number, content: string, reasoning = '', tools: ToolCall[] = []): AgentStep => ({
  index,
  content,
  reasoning,
  toolCalls: tools,
})

describe('answerStepIndex', () => {
  it('带工具调用的回合不是答案', () => {
    expect(answerStepIndex([step(0, '我先跑测试', '想', [call('c1')])])).toBe(-1)
  })

  it('取最后一个「有文字且无工具调用」的回合', () => {
    const steps = [
      step(0, '', '想', [call('c1')]),
      step(1, '全部通过'),
      step(2, '', '再想', [call('c2')]),
      step(3, '继续写'),
    ]
    expect(answerStepIndex(steps)).toBe(3)
  })

  it('末尾是工具调用时，答案仍取之前的纯文本回合', () => {
    const steps = [step(0, '全部通过'), step(1, '', '', [call('c1')])]
    expect(answerStepIndex(steps)).toBe(0)
  })

  it('空内容不算答案', () => {
    expect(answerStepIndex([step(0, '   ')])).toBe(-1)
    expect(answerStepIndex([])).toBe(-1)
  })
})

describe('lastNoToolStepIndex', () => {
  it('正在思考（无正文无工具）时指向该回合', () => {
    expect(lastNoToolStepIndex([step(0, '', '正在想')])).toBe(0)
  })

  it('全是工具回合时返回 -1', () => {
    expect(lastNoToolStepIndex([step(0, 'x', '想', [call('c1')])])).toBe(-1)
  })
})

describe('placeSteps', () => {
  it('答案回合既不进入时间线，也不重复渲染', () => {
    const steps = [
      step(0, '', '想A', [call('c1')]),
      step(1, '答案', '想B'),
    ]
    const placement = placeSteps(steps)
    expect(placement.timeline.map((s) => s.index)).toEqual([0])
    expect(placement.answer?.index).toBe(1)
    expect(placement.active?.index).toBe(1)
  })

  it('工具回合全部留在时间线里，并保持原有顺序', () => {
    const steps = [
      step(0, '先看一眼', '想A', [call('c1')]),
      step(1, '', '想B', [call('c2')]),
      step(2, '答案'),
    ]
    const placement = placeSteps(steps)
    expect(placement.timeline.map((s) => s.index)).toEqual([0, 1])
    expect(placement.timeline.map((s) => s.reasoning)).toEqual(['想A', '想B'])
    // 顺序即发生顺序：工具回合的正文排在它自己的思考之后、后续回合之前
    expect(placement.timeline[0].content).toBe('先看一眼')
  })

  it('以工具回合收尾时没有答案正文', () => {
    const placement = placeSteps([step(0, '跑一下', '想', [call('c1')])])
    expect(placement.answer).toBeNull()
    expect(placement.timeline.map((s) => s.index)).toEqual([0])
  })
})

describe('bodyReasoning', () => {
  it('取正在写的那一步的思考', () => {
    expect(bodyReasoning([step(0, '', '正在想')], null)).toBe('正在想')
  })

  it('已经出正文时取答案回合的思考', () => {
    expect(bodyReasoning([step(0, '答案', '想B')], null)).toBe('想B')
  })

  it('没有 steps 时回落到消息级 reasoning（老数据）', () => {
    expect(bodyReasoning([], '旧思考')).toBe('旧思考')
    expect(bodyReasoning([], null)).toBe('')
  })
})
