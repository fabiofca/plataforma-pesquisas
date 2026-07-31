import type { SurveyFlowLayout, SurveyFlowNodeLayout } from '@/types/domain'

const DEFAULT_X = 80
const DEFAULT_Y = 140
const GAP_X = 360
const GAP_Y = 300

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
  const currentNodes = current?.nodes ?? []
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

  return {
    ...baseLayout,
    nodes: baseLayout.nodes.map((node) =>
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
  const existing = layout?.nodes.find((node) => node.id === nodeId)

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
  return [...questionIds].sort((leftId, rightId) => {
    const left = layout?.nodes.find((node) => node.id === leftId)
    const right = layout?.nodes.find((node) => node.id === rightId)

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
