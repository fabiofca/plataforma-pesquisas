import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, GitBranch, Move, Plus, Trash2 } from 'lucide-react'

import { FLOW_END, FLOW_ON_ANSWER, getQuestionFlowValues, supportsQuestionFlow } from '@/lib/survey-flow'
import {
  getNodePosition,
  makeDefaultFlowLayout,
  sortIdsByFlowLayout,
} from '@/lib/survey-visual-flow'
import type { QuestionType, SurveyFlowLayout, SurveyQuestionFlowRule } from '@/types/domain'

type VisualQuestion = {
  id: string
  title: string
  description: string
  type: QuestionType
  required: boolean
  options: string[]
  flowRules: SurveyQuestionFlowRule[]
}

const questionTypes: Array<{ value: QuestionType; label: string }> = [
  { value: 'short_text', label: 'Texto curto' },
  { value: 'long_text', label: 'Texto longo' },
  { value: 'single_choice', label: 'Única escolha' },
  { value: 'multiple_choice', label: 'Múltipla escolha' },
  { value: 'yes_no', label: 'Sim / Não' },
  { value: 'rating_1_5', label: 'Nota de 1 a 5' },
  { value: 'nps', label: 'NPS' },
]

const questionTypeLabels = Object.fromEntries(questionTypes.map((item) => [item.value, item.label])) as Record<
  QuestionType,
  string
>

const NODE_WIDTH = 240
const NODE_HEADER_HEIGHT = 88
const NODE_FLOW_ROW_HEIGHT = 34
const NODE_BOTTOM_PADDING = 14
const START_X = 60
const START_Y = 90

function updateFlowRuleList(flowRules: SurveyQuestionFlowRule[], value: string, nextQuestionId: string) {
  const normalizedValue = value.trim()
  const nextRules = flowRules.filter((rule) => rule.value !== normalizedValue)

  if (!nextQuestionId) {
    return nextRules
  }

  return [...nextRules, { value: normalizedValue, nextQuestionId }]
}

type EdgeLine = {
  id: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  label: string
  tone: 'primary' | 'branch' | 'muted'
}

function getNodeFlowValues(question: Pick<VisualQuestion, 'type' | 'options'>) {
  return supportsQuestionFlow(question.type) ? getQuestionFlowValues(question) : []
}

function getNodeHeight(question: Pick<VisualQuestion, 'type' | 'options'>) {
  const rowCount = 1 + getNodeFlowValues(question).length
  return NODE_HEADER_HEIGHT + rowCount * NODE_FLOW_ROW_HEIGHT + NODE_BOTTOM_PADDING
}

function getNodeAnchorY(
  question: Pick<VisualQuestion, 'type' | 'options'>,
  positionY: number,
  rowIndex: number,
) {
  return positionY + NODE_HEADER_HEIGHT + rowIndex * NODE_FLOW_ROW_HEIGHT + NODE_FLOW_ROW_HEIGHT / 2
}

function getFlowTargetLabel(questions: VisualQuestion[], targetId?: string | null, fallback = 'Próxima pergunta') {
  if (!targetId) {
    return fallback
  }

  if (targetId === FLOW_END) {
    return 'Encerrar pesquisa'
  }

  return questions.find((question) => question.id === targetId)?.title?.trim() || 'Pergunta sem título'
}

function buildPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const deltaX = Math.max(60, Math.abs(to.x - from.x) * 0.45)
  return `M ${from.x} ${from.y} C ${from.x + deltaX} ${from.y}, ${to.x - deltaX} ${to.y}, ${to.x} ${to.y}`
}

export function SurveyVisualFlowEditor({
  primaryColor,
  questions,
  flowLayout,
  selectedQuestionId,
  onSelectQuestion,
  onAddQuestion,
  onRemoveQuestion,
  onUpdateQuestion,
  onUpdateFlowLayout,
}: {
  primaryColor: string
  questions: VisualQuestion[]
  flowLayout: SurveyFlowLayout
  selectedQuestionId?: string
  onSelectQuestion: (questionId: string) => void
  onAddQuestion: () => void
  onRemoveQuestion: (questionId: string) => void
  onUpdateQuestion: (questionId: string, updater: (question: VisualQuestion) => VisualQuestion) => void
  onUpdateFlowLayout: (layout: SurveyFlowLayout) => void
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [draggingNode, setDraggingNode] = useState<{
    id: string
    offsetX: number
    offsetY: number
  } | null>(null)

  useEffect(() => {
    if (!selectedQuestionId && questions[0]?.id) {
      onSelectQuestion(questions[0].id)
    }
  }, [onSelectQuestion, questions, selectedQuestionId])

  const orderedQuestionIds = useMemo(
    () => sortIdsByFlowLayout(questions.map((question) => question.id), flowLayout),
    [flowLayout, questions],
  )

  const nodes = useMemo(
    () =>
      questions.map((question, index) => {
        const flowValues = getNodeFlowValues(question)

        return {
          ...question,
          flowValues,
          height: getNodeHeight(question),
          position: getNodePosition(flowLayout, question.id, index),
        }
      }),
    [flowLayout, questions],
  )

  const selectedQuestion = questions.find((question) => question.id === selectedQuestionId) ?? questions[0] ?? null
  const maxX = Math.max(...nodes.map((node) => node.position.x + NODE_WIDTH), START_X + NODE_WIDTH + 80)
  const maxY = Math.max(...nodes.map((node) => node.position.y + node.height), START_Y + 420)

  const edges = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]))
    const edgeLines: EdgeLine[] = []

    nodes.forEach((node) => {
      const currentIndex = orderedQuestionIds.indexOf(node.id)
      const genericRule = node.flowRules.find((rule) => rule.value === FLOW_ON_ANSWER)
      const fallbackTargetId = orderedQuestionIds[currentIndex + 1] ?? FLOW_END
      const genericTargetId = genericRule?.nextQuestionId ?? fallbackTargetId

      if (genericTargetId && genericTargetId !== FLOW_END) {
        const targetNode = nodeMap.get(genericTargetId)

        edgeLines.push({
          id: `${node.id}-generic-${genericTargetId}`,
          from: {
            x: node.position.x + NODE_WIDTH,
            y: getNodeAnchorY(node, node.position.y, 0),
          },
          to: {
            x: targetNode?.position.x ?? node.position.x + NODE_WIDTH + 120,
            y: targetNode ? targetNode.position.y + targetNode.height / 2 : getNodeAnchorY(node, node.position.y, 0),
          },
          label: genericRule ? 'Após responder' : 'Sequência',
          tone: genericRule ? 'primary' : 'muted',
        })
      }

      if (node.flowValues.length) {
        node.flowValues.forEach((flowValue, flowIndex) => {
          const specificRule = node.flowRules.find((rule) => rule.value === flowValue)

          if (!specificRule) {
            return
          }

          if (specificRule.nextQuestionId === FLOW_END) {
            return
          }

          const targetNode = nodeMap.get(specificRule.nextQuestionId)

          edgeLines.push({
            id: `${node.id}-${flowValue}-${specificRule.nextQuestionId}`,
            from: {
              x: node.position.x + NODE_WIDTH,
              y: getNodeAnchorY(node, node.position.y, flowIndex + 1),
            },
            to: {
              x: targetNode?.position.x ?? node.position.x + NODE_WIDTH + 120,
              y: targetNode
                ? targetNode.position.y + targetNode.height / 2
                : getNodeAnchorY(node, node.position.y, flowIndex + 1),
            },
            label: flowValue,
            tone: 'branch',
          })
        })
      }
    })

    return edgeLines
  }, [nodes, orderedQuestionIds])

  useEffect(() => {
    if (!draggingNode) {
      return
    }

    function handleMouseMove(event: MouseEvent) {
      const canvas = canvasRef.current

      if (!canvas) {
        return
      }

      const rect = canvas.getBoundingClientRect()
      const nextX = event.clientX - rect.left + canvas.scrollLeft - draggingNode.offsetX
      const nextY = event.clientY - rect.top + canvas.scrollTop - draggingNode.offsetY

      onUpdateFlowLayout({
        ...flowLayout,
        nodes: flowLayout.nodes.map((node) =>
          node.id === draggingNode.id
            ? {
                ...node,
                x: Math.max(24, Math.round(nextX)),
                y: Math.max(24, Math.round(nextY)),
              }
            : node,
        ),
      })
    }

    function handleMouseUp() {
      setDraggingNode(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [draggingNode, flowLayout, onUpdateFlowLayout])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="admin-panel overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Fluxo visual</p>
            <p className="mt-1 text-sm text-slate-600">
              Arraste os blocos e use as saídas para montar a sequência.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
              {questions.length} {questions.length === 1 ? 'pergunta' : 'perguntas'}
            </span>
            <button
              type="button"
              onClick={() => onUpdateFlowLayout(makeDefaultFlowLayout(orderedQuestionIds))}
              className="admin-button px-3 py-2 text-xs"
            >
              <Move className="h-3.5 w-3.5" />
              Organizar
            </button>
            <button type="button" onClick={onAddQuestion} className="admin-button-primary px-3 py-2 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Nova pergunta
            </button>
          </div>
        </div>

        <div
          ref={canvasRef}
          className="relative h-[calc(100vh-200px)] min-h-[640px] overflow-auto bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px] md:min-h-[720px]"
        >
          <div className="relative" style={{ width: Math.max(1180, maxX + 180), height: Math.max(760, maxY + 200) }}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              <defs>
                <marker id="flow-arrow-primary" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={primaryColor || '#0b5cff'} />
                </marker>
                <marker id="flow-arrow-branch" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#7c3aed" />
                </marker>
                <marker id="flow-arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                </marker>
              </defs>

              {edges.map((edge) => {
                const stroke =
                  edge.tone === 'primary' ? primaryColor || '#0b5cff' : edge.tone === 'branch' ? '#7c3aed' : '#94a3b8'

                return (
                  <g key={edge.id}>
                    <path
                      d={buildPath(edge.from, edge.to)}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={edge.tone === 'muted' ? 2 : 2.5}
                      strokeDasharray={edge.tone === 'muted' ? '6 6' : undefined}
                      markerEnd={`url(#flow-arrow-${edge.tone})`}
                    />
                    <rect
                      x={(edge.from.x + edge.to.x) / 2 - 42}
                      y={(edge.from.y + edge.to.y) / 2 - 12}
                      width="84"
                      height="24"
                      rx="12"
                      fill="white"
                      stroke={stroke}
                      strokeOpacity="0.18"
                    />
                    <text
                      x={(edge.from.x + edge.to.x) / 2}
                      y={(edge.from.y + edge.to.y) / 2 + 4}
                      fontSize="11"
                      fontWeight="600"
                      fill={stroke}
                      textAnchor="middle"
                    >
                      {edge.label}
                    </text>
                  </g>
                )
              })}
            </svg>

            <div
              className="absolute flex h-[136px] w-[240px] flex-col justify-between rounded-[20px] border border-emerald-200 bg-emerald-50 p-4 shadow-sm"
              style={{ left: START_X, top: START_Y }}
            >
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Início</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">Entrada</p>
              </div>
              <p className="text-sm text-slate-600">Primeiro passo do fluxo.</p>
            </div>

            {nodes.map((node) => {
              const isSelected = selectedQuestion?.id === node.id

              return (
                <div
                  key={node.id}
                  onClick={() => onSelectQuestion(node.id)}
                  className={`absolute flex min-h-[136px] w-[240px] flex-col justify-between rounded-[20px] border bg-white p-4 text-left shadow-sm transition ${
                    isSelected ? 'border-sky-400 ring-2 ring-sky-100' : 'border-slate-200 hover:border-sky-200'
                  }`}
                  style={{ left: node.position.x, top: node.position.y, height: node.height }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectQuestion(node.id)}
                    onMouseDown={(event) => {
                      const rect = event.currentTarget.parentElement?.getBoundingClientRect()
                      if (!rect) {
                        return
                      }

                      setDraggingNode({
                        id: node.id,
                        offsetX: event.clientX - rect.left,
                        offsetY: event.clientY - rect.top,
                      })
                    }}
                    className="grid gap-2 text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Pergunta
                          </p>
                          {orderedQuestionIds[0] === node.id ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                              Início
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-950">
                          {node.title || 'Sem título ainda'}
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                        {questionTypeLabels[node.type]}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{node.required ? 'Obrigatória' : 'Opcional'}</span>
                      <span className="inline-flex items-center gap-1">
                        <Move className="h-3.5 w-3.5" />
                        Arraste
                      </span>
                    </div>
                  </button>

                  <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                    <div className="grid gap-1">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                          Padrão
                        </span>
                        {isSelected ? (
                          <select
                            className="admin-select h-8 min-w-0 flex-1 py-1 text-xs"
                            value={node.flowRules.find((rule) => rule.value === FLOW_ON_ANSWER)?.nextQuestionId ?? ''}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              onUpdateQuestion(node.id, (current) => ({
                                ...current,
                                flowRules: updateFlowRuleList(current.flowRules, FLOW_ON_ANSWER, event.target.value),
                              }))
                            }
                          >
                            <option value="">Próxima pergunta</option>
                            <option value={FLOW_END}>Encerrar pesquisa</option>
                            {orderedQuestionIds
                              .filter((id) => id !== node.id)
                              .map((questionId) => {
                                const targetQuestion = questions.find((question) => question.id === questionId)
                                return (
                                  <option key={`${node.id}-default-${questionId}`} value={questionId}>
                                    {targetQuestion?.title || 'Pergunta sem título'}
                                  </option>
                                )
                              })}
                          </select>
                        ) : (
                          <span className="truncate text-xs text-slate-600">
                            {getFlowTargetLabel(
                              questions,
                              node.flowRules.find((rule) => rule.value === FLOW_ON_ANSWER)?.nextQuestionId,
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {node.flowValues.map((flowValue) => (
                      <div key={`${node.id}-${flowValue}`} className="flex items-center gap-2">
                        <span className="min-w-0 rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                          {flowValue}
                        </span>
                        {isSelected ? (
                          <select
                            className="admin-select h-8 min-w-0 flex-1 py-1 text-xs"
                            value={node.flowRules.find((rule) => rule.value === flowValue)?.nextQuestionId ?? ''}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              onUpdateQuestion(node.id, (current) => ({
                                ...current,
                                flowRules: updateFlowRuleList(current.flowRules, flowValue, event.target.value),
                              }))
                            }
                          >
                            <option value="">Usar saída padrão</option>
                            <option value={FLOW_END}>Encerrar pesquisa</option>
                            {orderedQuestionIds
                              .filter((id) => id !== node.id)
                              .map((questionId) => {
                                const targetQuestion = questions.find((question) => question.id === questionId)
                                return (
                                  <option key={`${node.id}-${flowValue}-${questionId}`} value={questionId}>
                                    {targetQuestion?.title || 'Pergunta sem título'}
                                  </option>
                                )
                              })}
                          </select>
                        ) : (
                          <span className="truncate text-xs text-slate-600">
                            {getFlowTargetLabel(
                              questions,
                              node.flowRules.find((rule) => rule.value === flowValue)?.nextQuestionId,
                              'Usa saída padrão',
                            )}
                          </span>
                        )}
                      </div>
                    ))}

                    <div className="flex items-center gap-2 pt-1 text-xs text-slate-500">
                      <GitBranch className="h-3.5 w-3.5" />
                      {node.flowRules.length ? `${node.flowRules.length} regra(s) ativas` : 'Sem desvio extra'}
                    </div>

                    {node.flowRules.some((rule) => rule.nextQuestionId === FLOW_END) ? (
                      <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-medium text-slate-500">
                        Este bloco pode encerrar a pesquisa.
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="admin-panel grid gap-4 p-4 xl:sticky xl:top-24 xl:self-start">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Bloco</p>
            <h3 className="mt-1 text-sm font-semibold text-slate-950">
              {selectedQuestion ? 'Editar pergunta' : 'Selecione uma pergunta'}
            </h3>
          </div>
          {selectedQuestion ? (
            <button
              type="button"
              onClick={() => onRemoveQuestion(selectedQuestion.id)}
              className="admin-button-danger px-3 py-2 text-xs"
              disabled={questions.length <= 1}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remover
            </button>
          ) : null}
        </div>

        {selectedQuestion ? (
          <>
            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Título da pergunta</span>
              <input
                className="admin-input"
                value={selectedQuestion.title}
                placeholder="Ex.: Como você avalia o atendimento?"
                onChange={(event) =>
                  onUpdateQuestion(selectedQuestion.id, (current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Descrição de apoio</span>
              <textarea
                className="admin-input min-h-24"
                value={selectedQuestion.description}
                placeholder="Use esse texto para orientar a resposta do cliente."
                onChange={(event) =>
                  onUpdateQuestion(selectedQuestion.id, (current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="text-slate-600">Tipo</span>
                <select
                  className="admin-select"
                  value={selectedQuestion.type}
                  onChange={(event) =>
                    onUpdateQuestion(selectedQuestion.id, (current) => {
                      const type = event.target.value as QuestionType
                      const needsOptions = type === 'single_choice' || type === 'multiple_choice'

                      return {
                        ...current,
                        type,
                        options: needsOptions ? (current.options.length ? current.options : ['']) : [],
                        flowRules:
                          type === 'yes_no' || type === 'single_choice'
                            ? current.flowRules
                            : current.flowRules.filter((rule) => rule.value === FLOW_ON_ANSWER),
                      }
                    })
                  }
                >
                  {questionTypes.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-subcard flex items-center gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedQuestion.required}
                  onChange={(event) =>
                    onUpdateQuestion(selectedQuestion.id, (current) => ({
                      ...current,
                      required: event.target.checked,
                    }))
                  }
                />
                Obrigatória
              </label>
            </div>

            {selectedQuestion.type === 'single_choice' || selectedQuestion.type === 'multiple_choice' ? (
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-950">Opções de resposta</p>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateQuestion(selectedQuestion.id, (current) => ({
                        ...current,
                        options: [...current.options, ''],
                      }))
                    }
                    className="admin-button px-3 py-2 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Nova opção
                  </button>
                </div>

                <div className="space-y-2">
                  {selectedQuestion.options.map((option, optionIndex) => (
                    <div key={`${selectedQuestion.id}-${optionIndex}`} className="flex gap-2">
                      <input
                        className="admin-input flex-1"
                        value={option}
                        placeholder={`Opção ${optionIndex + 1}`}
                        onChange={(event) =>
                          onUpdateQuestion(selectedQuestion.id, (current) => {
                            const previousValue = current.options[optionIndex] ?? ''
                            const nextValue = event.target.value

                            return {
                              ...current,
                              options: current.options.map((item, index) => (index === optionIndex ? nextValue : item)),
                              flowRules: current.flowRules.map((rule) =>
                                rule.value === previousValue ? { ...rule, value: nextValue } : rule,
                              ),
                            }
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateQuestion(selectedQuestion.id, (current) => ({
                            ...current,
                            options: current.options.length > 1 ? current.options.filter((_, index) => index !== optionIndex) : current.options,
                            flowRules:
                              current.options.length > 1
                                ? current.flowRules.filter((rule) => rule.value !== current.options[optionIndex])
                                : current.flowRules,
                          }))
                        }
                        className="admin-button-danger px-3 py-2 text-xs"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3 flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold text-slate-950">Saída padrão</p>
              </div>

              <label className="grid gap-2 text-sm">
                <span className="text-slate-600">Depois que o cliente responder</span>
                <select
                  className="admin-select"
                  value={selectedQuestion.flowRules.find((rule) => rule.value === FLOW_ON_ANSWER)?.nextQuestionId ?? ''}
                  onChange={(event) =>
                    onUpdateQuestion(selectedQuestion.id, (current) => ({
                      ...current,
                      flowRules: updateFlowRuleList(current.flowRules, FLOW_ON_ANSWER, event.target.value),
                    }))
                  }
                >
                  <option value="">Seguir sequência normal do canvas</option>
                  <option value={FLOW_END}>Encerrar pesquisa após esta resposta</option>
                  {orderedQuestionIds
                    .filter((id) => id !== selectedQuestion.id)
                    .map((questionId) => {
                      const targetQuestion = questions.find((question) => question.id === questionId)
                      return (
                        <option key={questionId} value={questionId}>
                          {targetQuestion?.title || 'Pergunta sem título'}
                        </option>
                      )
                    })}
                </select>
              </label>
            </div>

            {supportsQuestionFlow(selectedQuestion.type) ? (
              <div className="rounded-[16px] border border-violet-200 bg-violet-50 p-3">
                <div className="mb-3 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-violet-600" />
                  <p className="text-sm font-semibold text-violet-950">Fluxo por resposta</p>
                </div>

                <div className="space-y-3">
                  {getQuestionFlowValues(selectedQuestion).map((flowValue) => (
                    <label key={`${selectedQuestion.id}-${flowValue}`} className="grid gap-2 text-sm">
                      <span className="text-slate-600">Se responder "{flowValue}", ir para</span>
                      <select
                        className="admin-select"
                        value={selectedQuestion.flowRules.find((rule) => rule.value === flowValue)?.nextQuestionId ?? ''}
                        onChange={(event) =>
                          onUpdateQuestion(selectedQuestion.id, (current) => ({
                            ...current,
                            flowRules: updateFlowRuleList(current.flowRules, flowValue, event.target.value),
                          }))
                        }
                      >
                        <option value="">Usar saída padrão</option>
                        <option value={FLOW_END}>Encerrar pesquisa</option>
                        {orderedQuestionIds
                          .filter((id) => id !== selectedQuestion.id)
                          .map((questionId) => {
                            const targetQuestion = questions.find((question) => question.id === questionId)
                            return (
                              <option key={`${flowValue}-${questionId}`} value={questionId}>
                                {targetQuestion?.title || 'Pergunta sem título'}
                              </option>
                            )
                          })}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-[16px] border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                O fluxo visual já está ligado ao motor atual da pesquisa. Ao salvar, as regras continuam compatíveis com a experiência pública.
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-[16px] border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
            Selecione um bloco no canvas para editar os detalhes.
          </div>
        )}
      </div>
    </div>
  )
}
