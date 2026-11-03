/**
 * The agent's intermediate turns.
 *
 * An answer that took five model turns and a dozen tool calls should not look
 * like one paragraph of text: the steps are the evidence. They stay collapsed
 * when everything went fine and open themselves while the run is in progress.
 *
 * The *final* turn's text is rendered by the message itself (as Markdown), so it
 * is excluded here — otherwise the answer would appear twice.
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { useT } from '@/i18n'
import { MarkdownText } from '@/components/markdown/MarkdownText'
import { ToolCard } from './ToolCard'
import type { AgentStep } from '@/core/types'

export function StepTimeline({
  steps,
  streaming,
}: {
  steps: AgentStep[]
  streaming: boolean
}) {
  const t = useT()
  const [manual, setManual] = useState<boolean | null>(null)

  // 上层已经把「答案那一步」剔除了，这里照单全收。
  const timeline = steps
  if (timeline.length === 0) return null

  const toolCount = timeline.reduce((sum, step) => sum + step.toolCalls.length, 0)
  // Open while running; folded afterwards unless the user says otherwise.
  const open = manual ?? streaming

  return (
    <div className="steps">
      <div
        className="disclosure"
        onClick={() => setManual(!open)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setManual(!open)
        }}
      >
        <Icon name="layers" size={13} />
        <span>
          {t('agent.timeline')}
          <span className="count">
            {' · '}
            {timeline.length} {t('agent.stepsUnit')}
            {toolCount > 0 ? ` · ${toolCount} ${t('agent.toolsUnit')}` : ''}
          </span>
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
      </div>

      <div className={`collapse${open ? ' open' : ''}`}>
        <div className="steps-list">
          {timeline.map((step) => (
          <div className="step" key={step.index}>
            <div className="step-head">
              <span className="step-index">#{step.index + 1}</span>
              <span>
                {step.toolCalls.length > 0
                  ? `${step.toolCalls.length} ${t('agent.toolsUnit')}`
                  : t('agent.step', { n: step.index + 1 })}
              </span>
            </div>
            <div className="step-body">
              {step.content.trim().length > 0 && (
                <MarkdownText content={step.content} />
              )}
              {step.toolCalls.map((call) => (
                <ToolCard key={call.id} call={call} />
              ))}
            </div>
          </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Progress list written by the model via `todo_write`. */
export function TodoPanel({ todos }: { todos: Array<{ content: string; status: string }> }) {
  const t = useT()
  if (todos.length === 0) return null

  return (
    <div className="todos">
      <div className="todos-head">
        <Icon name="list" size={12} />
        {t('agent.todos')}
        <span className="faint">
          {todos.filter((todo) => todo.status === 'completed').length}/{todos.length}
        </span>
      </div>
      {todos.map((todo, index) => (
        <div key={index} className={`todo-item ${todo.status}`}>
          <span className="todo-mark">{todo.status === 'completed' ? '✓' : ''}</span>
          <span>{todo.content}</span>
        </div>
      ))}
    </div>
  )
}
