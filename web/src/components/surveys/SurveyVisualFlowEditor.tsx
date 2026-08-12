import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, GitBranch, GripHorizontal, Move, Play, Plus, Save, Trash2 } from 'lucide-react'

import { FLOW_END, FLOW_ON_ANSWER, getQuestionFlowValues, supportsQuestionFlow } from '@/lib/survey-flow'
import {
  getNodePosition,
  sortIdsByFlowLayout,
} from '@/lib/survey-visual-flow'
import type { BusinessMetric, QuestionType, SurveyFlowLayout, SurveyQuestionFlowRule } from '@/types/domain'

type VisualQuestion = {
  id: string
  title: string
  description: string
  type: QuestionType
  required: boolean
  options: string[]
  flowRules: SurveyQuestionFlowRule[]
  businessMetric?: BusinessMetric | null
  linkedQuestionId?: string | null
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
const NODE_HEADER_HEIGHT = 68
const NODE_FLOW_ROW_HEIGHT = 30
const NODE_BOTTOM_PADDING = 12

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
  sourceId: string
  ruleValue: string
  targetId: string
  editable: boolean
  from: { x: number; y: number }
  to: { x: number; y: number }
  mid: { x: number; y: number }
  label: string
  tone: 'primary' | 'branch' | 'muted'
}

type DragConnection = {
  sourceId: string
  ruleValue: string
  label: string
  tone: EdgeLine['tone']
  from: { x: number; y: number }
  to: { x: number; y: number }
}

function getNodeFlowValues(question: Pick<VisualQuestion, 'type' | 'options'>) {
  return supportsQuestionFlow(question.type) ? getQuestionFlowValues(question) : []
}

function getNodeHeight(question: Pick<VisualQuestion, 'type' | 'options'>) {
  const flowValuesCount = getNodeFlowValues(question).length
  const rowCount = flowValuesCount > 0 ? flowValuesCount + 1 : 1
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

function getEdgeMidpoint(from: { x: number; y: number }, to: { x: number; y: number }) {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
  }
}

export function SurveyVisualFlowEditor({
  primaryColor,
  questions,
  flowLayout,
  hasUnsavedChanges,
  isSaving,
  selectedQuestionId,
  onSelectQuestion,
  onAddQuestion,
  onRemoveQuestion,
  onUpdateQuestion,
  onUpdateFlowLayout,
  onSaveFlow,
  onDiscardFlow,
}: {
  primaryColor: string
  questions: VisualQuestion[]
  flowLayout: SurveyFlowLayout
  hasUnsavedChanges: boolean
  isSaving: boolean
  selectedQuestionId?: string
  onSelectQuestion: (questionId: string) => void
  onAddQuestion: () => void
  onRemoveQuestion: (questionId: string) => void
  onUpdateQuestion: (questionId: string, updater: (question: VisualQuestion) => VisualQuestion) => void
  onUpdateFlowLayout: (layout: SurveyFlowLayout) => void
  onSaveFlow: () => void
  onDiscardFlow: () => void
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [draggingNode, setDraggingNode] = useState<{
    id: string
    offsetX: number
    offsetY: number
  } | null>(null)
  const [dragConnection, setDragConnection] = useState<DragConnection | null>(null)
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

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

  // Auto-scroll canvas to center the selected question when it changes
  useEffect(() => {
    if (!selectedQuestionId || !canvasRef.current) return

    const canvas = canvasRef.current
    const selectedNode = nodes.find((node) => node.id === selectedQuestionId)
    if (!selectedNode) return

    const canvasWidth = canvas.clientWidth
    const canvasHeight = canvas.clientHeight
    const nodeCenterX = selectedNode.position.x + NODE_WIDTH / 2
    const nodeCenterY = selectedNode.position.y + selectedNode.height / 2

    // Only scroll if the node is outside the visible area
    const isVisible =
      nodeCenterX >= canvas.scrollLeft &&
      nodeCenterX <= canvas.scrollLeft + canvasWidth &&
      nodeCenterY >= canvas.scrollTop &&
      nodeCenterY <= canvas.scrollTop + canvasHeight

    if (!isVisible) {
      canvas.scrollTo({
        left: Math.max(0, nodeCenterX - canvasWidth / 2),
        top: Math.max(0, nodeCenterY - canvasHeight / 2),
        behavior: 'smooth',
      })
    }
  }, [selectedQuestionId, nodes])

  function getCanvasPoint(clientX: number, clientY: number) {
    const canvas = canvasRef.current

    if (!canvas) {
      return null
    }

    const rect = canvas.getBoundingClientRect()
    return {
      x: clientX - rect.left + canvas.scrollLeft,
      y: clientY - rect.top + canvas.scrollTop,
    }
  }

  function getTargetNodeIdAtPoint(point: { x: number; y: number }, sourceId: string) {
    const targetNode = nodes.find(
      (node) =>
        node.id !== sourceId &&
        point.x >= node.position.x &&
        point.x <= node.position.x + NODE_WIDTH &&
        point.y >= node.position.y &&
        point.y <= node.position.y + node.height,
    )

    return targetNode?.id ?? null
  }

  const selectedQuestion = questions.find((question) => question.id === selectedQuestionId) ?? questions[0] ?? null
  const firstNode = nodes.find((node) => questions[0]?.id === node.id)
  const startNodeX = firstNode ? Math.max(16, firstNode.position.x - 100) : 80
  const startNodeY = firstNode
    ? Math.max(16, firstNode.position.y + firstNode.height / 2 - 22)
    : 160

  const maxX = Math.max(...nodes.map((node) => node.position.x + NODE_WIDTH), NODE_WIDTH + 160)
  const maxY = Math.max(...nodes.map((node) => node.position.y + node.height), 420)

  const edges = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]))
    const edgeLines: EdgeLine[] = []

    nodes.forEach((node) => {
      const genericRule = node.flowRules.find((rule) => rule.value === FLOW_ON_ANSWER)
      const genericRowIndex = node.flowValues.length

      if (genericRule && genericRule.nextQuestionId !== FLOW_END) {
        const targetNode = nodeMap.get(genericRule.nextQuestionId)
        const from = {
          x: node.position.x + NODE_WIDTH,
          y: getNodeAnchorY(node, node.position.y, genericRowIndex),
        }
        const to = {
          x: targetNode?.position.x ?? node.position.x + NODE_WIDTH + 120,
          y: targetNode
            ? targetNode.position.y + targetNode.height / 2
            : getNodeAnchorY(node, node.position.y, genericRowIndex),
        }

        edgeLines.push({
          id: `${node.id}-answer-${genericRule.nextQuestionId}`,
          sourceId: node.id,
          ruleValue: FLOW_ON_ANSWER,
          targetId: genericRule.nextQuestionId,
          editable: true,
          from,
          to,
          mid: getEdgeMidpoint(from, to),
          label: node.flowValues.length ? 'Próxima' : 'Após responder',
          tone: 'primary',
        })
      }

      node.flowValues.forEach((flowValue, flowIndex) => {
        const specificRule = node.flowRules.find((rule) => rule.value === flowValue)

        if (!specificRule || specificRule.nextQuestionId === FLOW_END) {
          return
        }

        const targetNode = nodeMap.get(specificRule.nextQuestionId)
        const from = {
          x: node.position.x + NODE_WIDTH,
          y: getNodeAnchorY(node, node.position.y, flowIndex),
        }
        const to = {
          x: targetNode?.position.x ?? node.position.x + NODE_WIDTH + 120,
          y: targetNode
            ? targetNode.position.y + targetNode.height / 2
            : getNodeAnchorY(node, node.position.y, flowIndex),
        }

        edgeLines.push({
          id: `${node.id}-${flowValue}-${specificRule.nextQuestionId}`,
          sourceId: node.id,
          ruleValue: flowValue,
          targetId: specificRule.nextQuestionId,
          editable: true,
          from,
          to,
          mid: getEdgeMidpoint(from, to),
          label: flowValue,
          tone: 'branch',
        })
      })
    })

    return edgeLines
  }, [nodes])

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

  useEffect(() => {
    if (!dragConnection) {
      setHoveredTargetId(null)
      return
    }

    function handleMouseMove(event: MouseEvent) {
      const point = getCanvasPoint(event.clientX, event.clientY)

      if (!point) {
        return
      }

      setDragConnection((current) => (current ? { ...current, to: point } : current))
      setHoveredTargetId(getTargetNodeIdAtPoint(point, dragConnection.sourceId))
    }

    function handleMouseUp(event: MouseEvent) {
      const point = getCanvasPoint(event.clientX, event.clientY)
      const targetId = point ? getTargetNodeIdAtPoint(point, dragConnection.sourceId) : null

      if (targetId) {
        onUpdateQuestion(dragConnection.sourceId, (current) => ({
          ...current,
          flowRules: updateFlowRuleList(current.flowRules, dragConnection.ruleValue, targetId),
        }))
        onSelectQuestion(targetId)
      }

      setDragConnection(null)
      setHoveredTargetId(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragConnection, onSelectQuestion, onUpdateQuestion])

  useEffect(() => {
    if (selectedEdgeId && !edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null)
    }
  }, [edges, selectedEdgeId])

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
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                isSaving
                  ? 'border border-sky-200 bg-sky-50 text-sky-700'
                  : hasUnsavedChanges
                    ? 'border border-amber-200 bg-amber-50 text-amber-700'
                    : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              {isSaving ? 'Salvando...' : hasUnsavedChanges ? 'Fluxo com alterações' : 'Fluxo salvo'}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
              {questions.length} {questions.length === 1 ? 'pergunta' : 'perguntas'}
            </span>
            <button type="button" onClick={onAddQuestion} className="admin-button-primary px-3 py-2 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Nova pergunta
            </button>
            <button
              type="button"
              onClick={onDiscardFlow}
              disabled={!hasUnsavedChanges || isSaving}
              className="admin-button px-3 py-2 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Descartar
            </button>
            <button
              type="button"
              onClick={onSaveFlow}
              disabled={isSaving}
              className="admin-button-primary px-3 py-2 text-xs"
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? 'Salvando...' : 'Salvar fluxo'}
            </button>
          </div>
        </div>

        <div
          ref={canvasRef}
          className="relative h-[calc(100vh-200px)] min-h-[640px] select-none overflow-auto bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px] md:min-h-[720px]"
        >
          <div className="relative" style={{ width: Math.max(1180, maxX + 180), height: Math.max(760, maxY + 200) }}>
            <svg className="absolute inset-0 h-full w-full">
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
                <marker id="flow-arrow-start" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#059669" />
                </marker>
              </defs>

              {edges.map((edge) => {
                const stroke =
                  edge.tone === 'primary' ? primaryColor || '#0b5cff' : edge.tone === 'branch' ? '#7c3aed' : '#94a3b8'

                return (
                  <g
                    key={edge.id}
                    className={edge.editable ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}
                    onClick={
                      edge.editable
                        ? (event) => {
                            event.stopPropagation()
                            setSelectedEdgeId((current) => (current === edge.id ? null : edge.id))
                          }
                        : undefined
                    }
                  >
                    <path
                      d={buildPath(edge.from, edge.to)}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={selectedEdgeId === edge.id ? 3.5 : edge.tone === 'muted' ? 2 : 2.5}
                      strokeDasharray={edge.tone === 'muted' ? '6 6' : undefined}
                      markerEnd={`url(#flow-arrow-${edge.tone})`}
                    />
                    <rect
                      x={edge.mid.x - 42}
                      y={edge.mid.y - 12}
                      width="84"
                      height="24"
                      rx="12"
                      fill="white"
                      stroke={stroke}
                      strokeOpacity={selectedEdgeId === edge.id ? '0.45' : '0.18'}
                    />
                    <text
                      x={edge.mid.x}
                      y={edge.mid.y + 4}
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

              {firstNode ? (
                <g className="pointer-events-none">
                  <path
                    d={buildPath(
                      { x: startNodeX + 44, y: startNodeY + 22 },
                      { x: firstNode.position.x, y: firstNode.position.y + firstNode.height / 2 },
                    )}
                    fill="none"
                    stroke="#059669"
                    strokeWidth="2.5"
                    markerEnd="url(#flow-arrow-start)"
                  />
                </g>
              ) : null}

              {dragConnection ? (
                <g className="pointer-events-none">
                  <path
                    d={buildPath(dragConnection.from, dragConnection.to)}
                    fill="none"
                    stroke={dragConnection.tone === 'branch' ? '#7c3aed' : primaryColor || '#0b5cff'}
                    strokeWidth="2.5"
                    strokeDasharray="6 6"
                    markerEnd={`url(#flow-arrow-${dragConnection.tone === 'branch' ? 'branch' : 'primary'})`}
                  />
                </g>
              ) : null}
            </svg>

            {selectedEdgeId ? (
              <div
                className="absolute z-20"
                style={{
                  left: (edges.find((edge) => edge.id === selectedEdgeId)?.mid.x ?? 0) + 50,
                  top: (edges.find((edge) => edge.id === selectedEdgeId)?.mid.y ?? 0) - 16,
                }}
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-600 shadow-sm"
                  onClick={() => {
                    const edge = edges.find((entry) => entry.id === selectedEdgeId)

                    if (!edge) {
                      return
                    }

                    onUpdateQuestion(edge.sourceId, (current) => ({
                      ...current,
                      flowRules: current.flowRules.filter((rule) => rule.value !== edge.ruleValue),
                    }))
                    setSelectedEdgeId(null)
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                  Excluir ligação
                </button>
              </div>
            ) : null}

            {firstNode ? (
              <div
                className="pointer-events-none absolute z-10 flex items-center gap-1.5 rounded-full border-2 border-emerald-300 bg-emerald-600 px-3 py-2 shadow-md"
                style={{ left: startNodeX, top: startNodeY }}
              >
                <Play className="h-3.5 w-3.5 fill-white text-white" />
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white">Início</span>
              </div>
            ) : null}

            {nodes.map((node) => {
              const isSelected = selectedQuestion?.id === node.id

              return (
                <div
                  key={node.id}
                  onClick={() => onSelectQuestion(node.id)}
                  className={`absolute flex w-[240px] flex-col rounded-[16px] border bg-white p-3 text-left shadow-sm transition ${
                    hoveredTargetId === node.id
                      ? 'border-violet-400 ring-2 ring-violet-100'
                      : isSelected
                        ? 'border-sky-400 ring-2 ring-sky-100'
                        : 'border-slate-200 hover:border-sky-200'
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
                    className="grid gap-1.5 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        {questionTypeLabels[node.type]}
                      </span>
                      {questions[0]?.id === node.id ? (
                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                          Início
                        </span>
                      ) : null}
                      {node.required ? (
                        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700">
                          Obrig.
                        </span>
                      ) : null}
                      <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                        <Move className="h-3 w-3" />
                      </span>
                    </div>
                    <p className="line-clamp-2 text-[13px] font-semibold leading-tight text-slate-900">
                      {node.title || 'Sem título ainda'}
                    </p>
                  </button>

                  <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                    {node.flowValues.map((flowValue, flowIndex) => (
                      <div
                        key={`${node.id}-${flowValue}`}
                        className="group flex cursor-grab items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-violet-50 active:cursor-grabbing"
                        title={`Arraste para conectar ${flowValue} a outro bloco`}
                        onMouseDown={(event) => {
                          event.stopPropagation()
                          const point = getCanvasPoint(event.clientX, event.clientY)

                          if (!point) {
                            return
                          }

                          setSelectedEdgeId(null)
                          setDragConnection({
                            sourceId: node.id,
                            ruleValue: flowValue,
                            label: flowValue,
                            tone: 'branch',
                            from: {
                              x: node.position.x + NODE_WIDTH,
                              y: getNodeAnchorY(node, node.position.y, flowIndex),
                            },
                            to: point,
                          })
                        }}
                      >
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-violet-700 transition group-hover:bg-violet-200">
                          {flowValue}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                          {getFlowTargetLabel(
                            questions,
                            node.flowRules.find((rule) => rule.value === flowValue)?.nextQuestionId,
                            '—',
                          )}
                        </span>
                        <GripHorizontal className="h-3 w-3 shrink-0 text-slate-300 transition group-hover:text-violet-400" />
                      </div>
                    ))}

                    <div
                      className="group flex cursor-grab items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-sky-50 active:cursor-grabbing"
                      title="Arraste para conectar ao próximo bloco"
                      onMouseDown={(event) => {
                        event.stopPropagation()
                        const point = getCanvasPoint(event.clientX, event.clientY)

                        if (!point) {
                          return
                        }

                        setSelectedEdgeId(null)
                        setDragConnection({
                          sourceId: node.id,
                          ruleValue: FLOW_ON_ANSWER,
                          label: node.flowValues.length ? 'Próxima' : 'Após responder',
                          tone: 'primary',
                          from: {
                            x: node.position.x + NODE_WIDTH,
                            y: getNodeAnchorY(node, node.position.y, node.flowValues.length),
                          },
                          to: point,
                        })
                      }}
                    >
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-sky-700 transition group-hover:bg-sky-200">
                        {node.flowValues.length ? 'Próx.' : 'Próx.'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                        {getFlowTargetLabel(
                          questions,
                          node.flowRules.find((rule) => rule.value === FLOW_ON_ANSWER)?.nextQuestionId,
                          '—',
                        )}
                      </span>
                      <GripHorizontal className="h-3 w-3 shrink-0 text-slate-300 transition group-hover:text-sky-400" />
                    </div>
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

                      // Validate metric compatibility with new type
                      let nextBusinessMetric = current.businessMetric
                      let nextLinkedQuestionId = current.linkedQuestionId

                      if (current.businessMetric === 'missing_product' && type !== 'short_text' && type !== 'long_text') {
                        nextBusinessMetric = null
                        nextLinkedQuestionId = null
                      }

                      if (current.businessMetric === 'attendant_name' && type !== 'short_text' && type !== 'long_text') {
                        nextBusinessMetric = null
                        nextLinkedQuestionId = null
                      }

                      if (current.businessMetric === 'attendant_rating' && type !== 'rating_1_5' && type !== 'nps') {
                        nextBusinessMetric = null
                        nextLinkedQuestionId = null
                      }

                      return {
                        ...current,
                        type,
                        options: needsOptions ? (current.options.length ? current.options : ['']) : [],
                        flowRules:
                          type === 'yes_no' || type === 'single_choice' || type === 'multiple_choice'
                            ? current.flowRules
                            : current.flowRules.filter((rule) => rule.value === FLOW_ON_ANSWER),
                        businessMetric: nextBusinessMetric,
                        linkedQuestionId: nextLinkedQuestionId,
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

            {/* Business metric dropdown */}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="text-slate-600">Métrica de negócio</span>
                <select
                  className="admin-select"
                  value={selectedQuestion.businessMetric ?? ''}
                  onChange={(event) =>
                    onUpdateQuestion(selectedQuestion.id, (current) => ({
                      ...current,
                      businessMetric: (event.target.value as BusinessMetric) || null,
                      linkedQuestionId: null,
                    }))
                  }
                >
                  <option value="">Nenhuma</option>
                  <option value="missing_product">Produto em falta</option>
                  <option value="attendant_name">Nome do atendente</option>
                  <option value="attendant_rating">Nota do atendente</option>
                </select>
              </label>

              {selectedQuestion.businessMetric === 'attendant_rating' ? (
                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Pergunta de nome vinculada</span>
                  <select
                    className="admin-select"
                    value={selectedQuestion.linkedQuestionId ?? ''}
                    onChange={(event) =>
                      onUpdateQuestion(selectedQuestion.id, (current) => ({
                        ...current,
                        linkedQuestionId: event.target.value || null,
                      }))
                    }
                  >
                    <option value="">Selecione...</option>
                    {questions
                      .filter((q) => q.id !== selectedQuestion.id && (q.type === 'short_text' || q.type === 'long_text'))
                      .map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.title || 'Pergunta sem título'}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
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
