// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { StepTimeline } from './StepTimeline'
import type { AgentStep } from '@/core/types'

const call = (id: string) => ({
  id,
  name: 'read_file',
  args: '{}',
  status: 'done' as const,
  result: { content: 'ok', isError: false, durationMs: 1 },
})

const step = (
  index: number,
  content: string,
  reasoning = '',
  tools: AgentStep['toolCalls'] = [],
): AgentStep => ({ index, content, reasoning, toolCalls: tools })

describe('StepTimeline 结构', () => {
  const steps: AgentStep[] = [
    step(0, '先看一眼', '想A', [call('c1')]),
    step(1, '再改一下', '想B', [call('c2')]),
  ]

  it('每个回合都是「思考 → 正文 → 工具调用」的顺序', () => {
    const { container } = render(<StepTimeline steps={steps} streaming={false} />)
    const rows = Array.from(container.querySelectorAll('.trace-step'))
    expect(rows).toHaveLength(2)

    for (const [index, row] of rows.entries()) {
      const expectedReasoning = index === 0 ? '想A' : '想B'
      // 折叠面板内容常驻 DOM（Grid 0fr），所以按结构取，而不是按文本取
      const reasoningLine = row.querySelector('.trace-reasoning .disclosure')
      expect(reasoningLine).not.toBeNull()
      expect(row.querySelector('.trace-reasoning .count')?.textContent).toContain(expectedReasoning)

      const card = row.querySelector('.tool-card')
      expect(card).not.toBeNull()

      // 思考在卡片之前（compareDocumentPosition：FOLLOWING 表示 card 在后）
      const position = (reasoningLine as Node).compareDocumentPosition(card as Node)
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      // 正文也在卡片之前
      const text = row.querySelector('.trace-text')
      expect(text).not.toBeNull()
      expect(text!.textContent).toContain(index === 0 ? '先看一眼' : '再改一下')
      expect(
        (text as Node).compareDocumentPosition(card as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it('默认展开，点标题可以收起，再点回来', async () => {
    const { container } = render(<StepTimeline steps={steps} streaming={false} />)
    const collapse = container.querySelector('.collapse')
    expect(collapse?.classList.contains('open')).toBe(true)

    const header = container.querySelector('.disclosure') as HTMLElement
    header.click()
    await Promise.resolve()
    expect(container.querySelector('.collapse')?.classList.contains('open')).toBe(false)

    ;(container.querySelector('.disclosure') as HTMLElement).click()
    await Promise.resolve()
    expect(container.querySelector('.collapse')?.classList.contains('open')).toBe(true)
  })

  it('思考行可单独展开，展开后显示全文', async () => {
    const { container } = render(<StepTimeline steps={steps} streaming={false} />)
    const line = container.querySelector('.trace-reasoning .disclosure') as HTMLElement
    expect(line).not.toBeNull()

    line.click()
    await Promise.resolve()
    const body = container.querySelector('.trace-reasoning .thinking-body')
    expect(body?.textContent).toBe('想A')
  })

  it('没有回合时不渲染', () => {
    const { container } = render(<StepTimeline steps={[]} streaming={false} />)
    expect(container.innerHTML).toBe('')
  })
})
