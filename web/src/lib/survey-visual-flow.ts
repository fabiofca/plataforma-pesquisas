import type { SurveyFlowLayout, SurveyFlowNodeLayout } from '@/types/domain'

const DEFAULT_X = 80
const DEFAULT_Y = 140
const GAP_X = 360
const GAP_Y = 300

function getSafeNodes(layout: SurveyFlowLayout | undefined): SurveyFlowNodeLayout[] {
  if (!Array.isArray(layout?.nodes)) {
    return []
  }

  return layout.nodes.filter(
    (node): node is SurveyFlowNodeLayout =>
      Boolean(
        node &&
          typeof node === 'object' &&
          typeof node.id === 'string' &&
          Number.isFinite(node.x) &&
          Number.isFinite(node.y),
      ),
  )
}

export function makeDefaultFlowLayout(questionIds: string[], nodeHeights?: number[]): SurveyFlowLayout {
  return {
    version: 1,
    nodes: questionIds.map((id, index) => ({
      id,
      x: DEFAULT_X + index * GAP_X,
      y: DEFAULT_Y,
    })),
  }
}

export function mergeFlowLayout(questionIds: string[], current?: SurveyFlowLayout): SurveyFlowLayout {
  const currentNodes = getSafeNodes(current)
  const mergedNodes: SurveyFlowNodeLayout[] = []

  questionIds.forEach((id, index) => {
    const existing = currentNodes.find((node) => node.id === id)

    if (existing) {
      mergedNodes.push(existing)
      return
    }

    mergedNodes.push({
      id,
      x: DEFAULT_X + index * GAP_X,
      y: DEFAULT_Y,
    })
  })

  return {
    version: 1,
    viewport: current?.viewport,
    nodes: mergedNodes,
  }
}

export function updateNodePosition(
  layout: SurveyFlowLayout | undefined,
  nodeId: string,
  position: { x: number; y: number },
): SurveyFlowLayout {
  const baseLayout = layout ?? { version: 1, nodes: [] }
  const baseNodes = getSafeNodes(baseLayout)

  return {
    ...baseLayout,
    nodes: baseNodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            x: Math.max(24, Math.round(position.x)),
            y: Math.max(24, Math.round(position.y)),
          }
        : node,
    ),
  }
}

export function getNodePosition(layout: SurveyFlowLayout | undefined, nodeId: string, index: number) {
  const existing = getSafeNodes(layout).find((node) => node.id === nodeId)

  if (existing) {
    return existing
  }

  return {
    id: nodeId,
    x: DEFAULT_X + index * GAP_X,
    y: DEFAULT_Y,
  }
}

export function sortIdsByFlowLayout(questionIds: string[], layout: SurveyFlowLayout | undefined) {
  const safeNodes = getSafeNodes(layout)

  return [...questionIds].sort((leftId, rightId) => {
    const left = safeNodes.find((node) => node.id === leftId)
    const right = safeNodes.find((node) => node.id === rightId)

    if (left && right) {
      if (left.y !== right.y) {
        return left.y - right.y
      }

      if (left.x !== right.x) {
        return left.x - right.x
      }
    }

    if (left && !right) {
      return -1
    }

    if (!left && right) {
      return 1
    }

    return questionIds.indexOf(leftId) - questionIds.indexOf(rightId)
  })
}
