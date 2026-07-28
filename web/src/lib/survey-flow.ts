import type { QuestionType, SurveyFlowTarget, SurveyQuestion, SurveyQuestionFlowRule } from '@/types/domain'

export const FLOW_END = '__end__' as const

type SurveyAnswerValue = string | string[] | number | boolean | undefined

type FlowQuestion = Pick<SurveyQuestion, 'id' | 'type' | 'options' | 'flowRules'>

export function supportsQuestionFlow(type: QuestionType) {
  return type === 'yes_no' || type === 'single_choice'
}

export function getQuestionFlowValues(question: Pick<SurveyQuestion, 'type' | 'options'>) {
  if (question.type === 'yes_no') {
    return ['Sim', 'Não']
  }

  if (question.type === 'single_choice') {
    return Array.from(new Set((question.options ?? []).map((option) => option.trim()).filter(Boolean)))
  }

  return []
}

export function normalizeFlowRules(question: FlowQuestion): SurveyQuestionFlowRule[] {
  const allowedValues = new Set(getQuestionFlowValues(question))

  return (question.flowRules ?? []).filter(
    (rule) => rule.value.trim() && allowedValues.has(rule.value) && rule.nextQuestionId.trim() !== '',
  )
}

export function isQuestionAnswered(question: Pick<SurveyQuestion, 'type'>, answer: SurveyAnswerValue) {
  if (question.type === 'multiple_choice') {
    return Array.isArray(answer) && answer.length > 0
  }

  if (question.type === 'rating_1_5' || question.type === 'nps') {
    return typeof answer === 'number'
  }

  if (typeof answer === 'boolean') {
    return true
  }

  if (Array.isArray(answer)) {
    return answer.length > 0
  }

  return typeof answer === 'string' ? answer.trim().length > 0 : false
}

function resolveFlowTarget(question: FlowQuestion, answer: SurveyAnswerValue): SurveyFlowTarget | null {
  if (!supportsQuestionFlow(question.type) || typeof answer !== 'string') {
    return null
  }

  const normalizedAnswer = answer.trim()
  if (!normalizedAnswer) {
    return null
  }

  const rule = normalizeFlowRules(question).find((entry) => entry.value === normalizedAnswer)
  return rule?.nextQuestionId ?? null
}

export function getVisibleSurveyQuestions(
  questions: SurveyQuestion[],
  answers: Record<string, string | string[] | number | boolean>,
) {
  if (!questions.length) {
    return []
  }

  const questionsById = new Map(questions.map((question) => [question.id, question]))
  const orderedQuestions = [...questions]
  const visibleQuestions: SurveyQuestion[] = []
  const visited = new Set<string>()
  let currentQuestion: SurveyQuestion | undefined = orderedQuestions[0]

  while (currentQuestion && !visited.has(currentQuestion.id)) {
    visited.add(currentQuestion.id)
    visibleQuestions.push(currentQuestion)

    const answer = answers[currentQuestion.id]
    if (!isQuestionAnswered(currentQuestion, answer)) {
      break
    }

    const flowTarget = resolveFlowTarget(currentQuestion, answer)
    if (flowTarget === FLOW_END) {
      break
    }

    if (flowTarget) {
      currentQuestion = questionsById.get(flowTarget)
      continue
    }

    const currentIndex = orderedQuestions.findIndex((question) => question.id === currentQuestion?.id)
    currentQuestion = currentIndex >= 0 ? orderedQuestions[currentIndex + 1] : undefined
  }

  return visibleQuestions
}
