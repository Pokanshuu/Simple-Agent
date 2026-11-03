// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MessageItem } from './MessageItem'
import type { AgentStep, Message } from '@/core/types'

const call = (id: string) => ({
  id,
  name: 'read_file',
  args: '{"path":"a.ts"}',
  status: 'done' as const,
  result: { content: 'ok', isError: false, durationMs: 1 },
})

const step = (
  index: number,
  content: string,
  reasoning = '',
  tools: AgentStep['toolCalls'] = [],
): AgentStep => ({ index, content, reasoning, toolCalls: tools })

const message = (steps: AgentStep[], content: string): Message => ({
  id: 'm1',
  conversationId: 'c1',
  parentId: '',
  variantIndex: 0,
  active: true,
  role: 'assistant',
  content,
  attachments: [],
  reasoning: null,
  steps,
  status: 'DONE',
  errorMessage: null,
  model: 'test',
  thinkingMs: 1000,
  ttftMs: null,
  tps: null,
  tokensIn: null,
  tokensOut: null,
  createdAt: 0,
})

function renderMessage(steps: AgentStep[], content: string) {
  return render(
    <MessageItem
      message={message(steps, content)}
      variantIndex={1}
      variantTotal={1}
      streaming={false}
      canRewrite={false}
    />,
  )
}

describe('MessageItem 顺序', () => {
  it('轨迹在思考之前，思考在正文之前', () => {
    const steps = [
      step(0, '先读一下', '想A', [call('c1')]),
      step(1, '答案在这里', '想B'),
    ]
    const { container } = renderMessage(steps, '答案在这里')

    const trace = container.querySelector('.assistant-body > .steps')
    const thinking = container.querySelector('.assistant-body > .thinking')
    const body = container.querySelector('.assistant-body > .md, .assistant-body > .md-exit')

    expect(trace).not.toBeNull()
    expect(thinking).not.toBeNull()
    expect(body).not.toBeNull()

    // trace → thinking → body
    expect((trace as Node).compareDocumentPosition(thinking as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((thinking as Node).compareDocumentPosition(body as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('答案回合的正文不会在轨迹里重复出现', () => {
    const steps = [
      step(0, '先读一下', '想A', [call('c1')]),
      step(1, '答案在这里', '想B'),
    ]
    const { container } = renderMessage(steps, '答案在这里')

    const trace = container.querySelector('.assistant-body > .steps') as HTMLElement
    expect(trace.textContent).not.toContain('答案在这里')
    expect(trace.textContent).toContain('先读一下')
  })

  it('只有一步且没有工具调用时，不渲染轨迹', () => {
    const { container } = renderMessage([step(0, '普通回复', '想')], '普通回复')
    expect(container.querySelector('.steps')).toBeNull()
    expect(container.querySelector('.thinking')).not.toBeNull()
  })
})
