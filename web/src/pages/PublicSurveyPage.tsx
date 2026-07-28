import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, Gift, Meh, MessageCircle, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { PrizeWheel, getSegmentTargetRotation, type PrizeWheelSegment } from '@/components/public/PrizeWheel'
import { ApiError, apiRequest } from '@/lib/api-client'
import { mapApiSurvey } from '@/lib/mappers'
import type { SurveyShareSource } from '@/lib/public-survey'
import { FLOW_END, getVisibleSurveyQuestions, isQuestionAnswered } from '@/lib/survey-flow'
import type { SurveyQuestion } from '@/types/domain'

function sanitizePhone(value: string) {
  return value.replace(/\D/g, '')
}

function isValidPhone(value: string) {
  return /^\d{10,11}$/.test(value)
}

const birthdayMonths = [
  { value: 1, label: 'Janeiro' },
  { value: 2, label: 'Fevereiro' },
  { value: 3, label: 'Março' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Maio' },
  { value: 6, label: 'Junho' },
  { value: 7, label: 'Julho' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Setembro' },
  { value: 10, label: 'Outubro' },
  { value: 11, label: 'Novembro' },
  { value: 12, label: 'Dezembro' },
]

const neutralWheelLabels = [
  'Valeu!',
  'Quase!',
  'Não foi dessa vez',
  'Você não teve sorte',
  'Que Pena!',
  'Obrigado',
]

type RewardRetryTask = {
  id: string
  type: 'google_review' | 'instagram_follow' | 'custom_link'
  title: string
  url: string
}

type SurveyAnswerMap = Record<string, string | string[] | number>
type RewardResultState = {
  won: boolean
  item?: string
  landedLabel?: string
  couponCode?: string
  pickupAddress?: string
  contactWhatsApp?: string
  retryAvailable?: boolean
  retryUnlocked?: boolean
  retryTasks?: RewardRetryTask[]
  completedTaskIds?: string[]
  spinAttempt?: number
  maxAttempts?: number
  finalAttempt?: boolean
  message?: string
}

type RetryTaskProgressMap = Record<
  string,
  {
    startedAt: number
    returnedAt: number | null
  }
>

type PersistedPublicSurveySession = {
  participantName: string
  participantPhone: string
  submitted: boolean
  submitMessage: string
  responseId: string
  canSpinReward: boolean
  rewardResult: RewardResultState | null
  wheelRotation: number
  activeWheelSegmentId: string
  completedRetryTaskIds: string[]
  wheelModalOpen: boolean
  retryTaskProgressMap: RetryTaskProgressMap
  activeRetryTaskId: string | null
}

const RETRY_TASK_MIN_WAIT_MS = 12000
const PUBLIC_SURVEY_SESSION_KEY_PREFIX = 'public-survey-session'

function getPublicSurveySessionStorageKey(previewVariant: string, surveyStorageId: string) {
  return `${PUBLIC_SURVEY_SESSION_KEY_PREFIX}:${previewVariant}:${surveyStorageId}`
}

function readPersistedSurveySessionSnapshot(storageKey: string) {
  try {
    const localSnapshot = window.localStorage.getItem(storageKey)

    if (localSnapshot) {
      return localSnapshot
    }
  } catch {
    // Ignore localStorage access issues and fall back to sessionStorage.
  }

  try {
    return window.sessionStorage.getItem(storageKey)
  } catch {
    return null
  }
}

function writePersistedSurveySessionSnapshot(storageKey: string, value: string) {
  try {
    window.localStorage.setItem(storageKey, value)
  } catch {
    // Ignore localStorage access issues and keep the shorter-lived fallback below.
  }

  try {
    window.sessionStorage.setItem(storageKey, value)
  } catch {
    // Ignore sessionStorage access issues.
  }
}

function removePersistedSurveySessionSnapshot(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // Ignore localStorage access issues.
  }

  try {
    window.sessionStorage.removeItem(storageKey)
  } catch {
    // Ignore sessionStorage access issues.
  }
}

function buildVisibleQuestionSet(questions: SurveyQuestion[], answers: SurveyAnswerMap) {
  return new Set(getVisibleSurveyQuestions(questions, answers).map((question) => question.id))
}

function pruneAnswerMapToVisibleQuestions(questions: SurveyQuestion[], nextAnswers: SurveyAnswerMap) {
  const nextVisibleIds = buildVisibleQuestionSet(questions, nextAnswers)

  return Object.fromEntries(Object.entries(nextAnswers).filter(([questionId]) => nextVisibleIds.has(questionId)))
}

function pruneAnswersForCurrentFlow(
  questions: SurveyQuestion[],
  currentAnswers: SurveyAnswerMap,
  sourceQuestionId: string,
  nextValue: string | string[] | number,
) {
  const nextAnswers = { ...currentAnswers, [sourceQuestionId]: nextValue }
  return pruneAnswerMapToVisibleQuestions(questions, nextAnswers)
}

function formatRewardProofFileName(title: string) {
  const normalized = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `comprovante-premio-${normalized || 'roleta'}.png`
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word

    if (context.measureText(nextLine).width <= maxWidth || !currentLine) {
      currentLine = nextLine
      continue
    }

    lines.push(currentLine)
    currentLine = word
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
  context.fill()
}

function pickRandomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function makePreviewCouponCode() {
  return `${Date.now()}${Math.floor(100 + Math.random() * 900)}`
}

function buildRewardWhatsAppUrl(input: {
  contactPhone?: string
  participantName?: string
  participantPhone?: string
  item?: string
  protocol?: string
  brandName?: string
  surveyTitle?: string
}) {
  const contactPhone = sanitizePhone(input.contactPhone ?? '')

  if (!contactPhone) {
    return null
  }

  const lines = [
    `Olá! Ganhei um prêmio${input.brandName ? ` na campanha ${input.brandName}` : input.surveyTitle ? ` na pesquisa ${input.surveyTitle}` : ''}.`,
    input.participantName ? `Nome: ${input.participantName}` : null,
    input.participantPhone ? `WhatsApp: ${input.participantPhone}` : null,
    input.item ? `Prêmio: ${input.item}` : null,
    input.protocol ? `Protocolo: ${input.protocol}` : null,
  ].filter(Boolean)

  return `https://wa.me/${contactPhone}?text=${encodeURIComponent(lines.join('\n'))}`
}

function getRetryTaskTypeLabel(type: RewardRetryTask['type']) {
  if (type === 'google_review') {
    return 'Google'
  }

  if (type === 'instagram_follow') {
    return 'Instagram'
  }

  return 'Link personalizado'
}

function buildPrizeWheelSegments(items: Array<{ id: string; title: string }>) {
  const rewardItems = items.slice(0, 3)
  if (!rewardItems.length) {
    return neutralWheelLabels.map((label, index) => ({
        id: `neutral-${index}`,
        label,
        kind: 'neutral' as const,
    }))
  }

  const totalSegments = rewardItems.length === 1 ? 6 : rewardItems.length === 2 ? 8 : 9
  const rewardPositions = new Set(
    rewardItems.map((_, index) => Math.floor((index * totalSegments) / rewardItems.length)),
  )
  const segments: PrizeWheelSegment[] = []
  let rewardIndex = 0
  let neutralIndex = 0

  for (let index = 0; index < totalSegments; index += 1) {
    if (rewardPositions.has(index) && rewardItems[rewardIndex]) {
      segments.push({
        id: rewardItems[rewardIndex].id,
        label: rewardItems[rewardIndex].title,
        kind: 'reward',
      })
      rewardIndex += 1
      continue
    }

    segments.push({
      id: `neutral-${neutralIndex}`,
      label: neutralWheelLabels[neutralIndex % neutralWheelLabels.length],
      kind: 'neutral',
    })
    neutralIndex += 1
  }

  return segments
}

export function PublicSurveyPage() {
  const { slug, id, token } = useParams()
  const previewVariant = id ? 'internal' : token ? 'shared' : 'public'
  const previewMode = previewVariant !== 'public'
  const sharedPreviewMode = previewVariant === 'shared'
  const surveyStorageId = id ?? token ?? slug ?? 'unknown'
  const surveySessionStorageKey = getPublicSurveySessionStorageKey(previewVariant, surveyStorageId)
  const [searchParams] = useSearchParams()
  const [sessionStateReady, setSessionStateReady] = useState(false)
  const [participantName, setParticipantName] = useState('')
  const [participantPhone, setParticipantPhone] = useState('')
  const [participantEmail, setParticipantEmail] = useState('')
  const [birthDay, setBirthDay] = useState('')
  const [birthMonth, setBirthMonth] = useState('')
  const [answers, setAnswers] = useState<Record<string, string | string[] | number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [responseId, setResponseId] = useState('')
  const [canSpinReward, setCanSpinReward] = useState(false)
  const [rewardResult, setRewardResult] = useState<RewardResultState | null>(null)
  const [eligibilityMessage, setEligibilityMessage] = useState('')
  const [wheelRotation, setWheelRotation] = useState(0)
  const [wheelSpinning, setWheelSpinning] = useState(false)
  const [activeWheelSegmentId, setActiveWheelSegmentId] = useState('')
  const [completedRetryTaskIds, setCompletedRetryTaskIds] = useState<string[]>([])
  const [celebrationKey, setCelebrationKey] = useState(0)
  const [wheelModalOpen, setWheelModalOpen] = useState(false)
  const [savingRewardProof, setSavingRewardProof] = useState(false)
  const [retryTaskProgressMap, setRetryTaskProgressMap] = useState<RetryTaskProgressMap>({})
  const [activeRetryTaskId, setActiveRetryTaskId] = useState<string | null>(null)
  const [retryTaskNow, setRetryTaskNow] = useState(() => Date.now())
  const trackedVisitKeyRef = useRef('')
  const sessionHydratedRef = useRef(false)
  const rewardSessionRestoreKeyRef = useRef('')
  const spinTimeoutRef = useRef<number | null>(null)
  const rewardProofRef = useRef<HTMLDivElement | null>(null)
  const source = searchParams.get('src')
  const trackedSource: SurveyShareSource | null = source === 'link' || source === 'qr' ? source : null

  const surveyQuery = useQuery({
    queryKey: ['public-survey', previewVariant, id ?? token ?? slug],
    queryFn: async () => {
      const response = await apiRequest<{
        survey: {
          id: string
          title: string
          slug?: string | null
          status?: string
          description?: string | null
          participation_mode: string
          brand_name?: string
          logo_url?: string | null
          primary_color: string
          banner_url?: string | null
          closing_message?: string | null
          reward_enabled: boolean
          reward_contact_whatsapp?: string | null
          reward_retry_unlock_enabled?: boolean
          reward_retry_tasks?: RewardRetryTask[]
          reward_items?: Array<{
            id: string
            title: string
          }>
          questions: Array<{
            id: string
            title: string
            description?: string | null
            type: string
            is_required: boolean
            options?: string[]
            settings_json?: {
              flowRules?: Array<{
                value: string
                nextQuestionId: string
              }>
            }
          }>
        }
      }>(
        previewVariant === 'internal'
          ? `/surveys/${id}/preview`
          : previewVariant === 'shared'
            ? `/public/preview/${token}`
            : `/public/surveys/${slug}`,
      )

      return mapApiSurvey({
        ...response.survey,
        slug: response.survey.slug ?? slug ?? `preview-${id ?? 'sem-slug'}`,
        status: response.survey.status ?? (previewMode ? 'draft' : 'published'),
      })
    },
    enabled: Boolean(previewVariant === 'internal' ? id : previewVariant === 'shared' ? token : slug),
    retry: 0,
  })

  const survey = surveyQuery.data
  const visibleQuestions = useMemo(
    () => getVisibleSurveyQuestions(survey?.questions ?? [], answers),
    [answers, survey?.questions],
  )
  const wheelSegments = useMemo(() => buildPrizeWheelSegments(survey?.rewardPreviewItems ?? []), [survey?.rewardPreviewItems])
  const showWheelArea = canSpinReward || wheelSpinning || Boolean(rewardResult)
  const retryTasks = rewardResult?.retryTasks ?? survey?.rewardRetryTasks ?? []
  const canCloseWheelModal =
    !wheelSpinning &&
    Boolean(
      rewardResult &&
        (rewardResult.won || (rewardResult.finalAttempt && !rewardResult.retryAvailable && !canSpinReward)),
    )
  const rewardContactWhatsAppUrl =
    rewardResult?.won && rewardResult.contactWhatsApp
      ? buildRewardWhatsAppUrl({
          contactPhone: rewardResult.contactWhatsApp,
          participantName,
          participantPhone,
          item: rewardResult.item,
          protocol: rewardResult.couponCode,
          brandName: survey?.brandName,
          surveyTitle: survey?.title,
        })
      : null
  const currentRetryTask = useMemo(() => {
    if (!rewardResult?.retryAvailable) {
      return null
    }

    const completedIds = rewardResult.completedTaskIds ?? completedRetryTaskIds
    return retryTasks.find((task) => !completedIds.includes(task.id)) ?? null
  }, [completedRetryTaskIds, retryTasks, rewardResult?.completedTaskIds, rewardResult?.retryAvailable])

  function clearPersistedSurveySession() {
    removePersistedSurveySessionSnapshot(surveySessionStorageKey)
  }

  function persistSurveySessionSnapshot(overrides?: Partial<PersistedPublicSurveySession>) {
    const snapshot: PersistedPublicSurveySession = {
      participantName,
      participantPhone,
      submitted,
      submitMessage,
      responseId,
      canSpinReward,
      rewardResult,
      wheelRotation,
      activeWheelSegmentId,
      completedRetryTaskIds,
      wheelModalOpen,
      retryTaskProgressMap,
      activeRetryTaskId,
      ...overrides,
    }

    const hasMeaningfulSession =
      snapshot.submitted ||
      Boolean(snapshot.responseId) ||
      Boolean(snapshot.rewardResult) ||
      Boolean(snapshot.canSpinReward) ||
      Object.keys(snapshot.retryTaskProgressMap).length > 0

    if (!hasMeaningfulSession) {
      clearPersistedSurveySession()
      return
    }

    writePersistedSurveySessionSnapshot(surveySessionStorageKey, JSON.stringify(snapshot))
  }

  useEffect(() => {
    if (sessionHydratedRef.current) {
      return
    }

    sessionHydratedRef.current = true

    const rawSession = readPersistedSurveySessionSnapshot(surveySessionStorageKey)

    if (!rawSession) {
      setSessionStateReady(true)
      return
    }

    try {
      const parsed = JSON.parse(rawSession) as PersistedPublicSurveySession
      const nextRetryTaskProgressMap = { ...(parsed.retryTaskProgressMap ?? {}) }
      let nextActiveRetryTaskId = parsed.activeRetryTaskId ?? null

      if (nextActiveRetryTaskId && nextRetryTaskProgressMap[nextActiveRetryTaskId] && !nextRetryTaskProgressMap[nextActiveRetryTaskId].returnedAt) {
        nextRetryTaskProgressMap[nextActiveRetryTaskId] = {
          ...nextRetryTaskProgressMap[nextActiveRetryTaskId],
          returnedAt: Date.now(),
        }
        nextActiveRetryTaskId = null
      }

      setParticipantName(parsed.participantName ?? '')
      setParticipantPhone(parsed.participantPhone ?? '')
      setSubmitted(Boolean(parsed.submitted))
      setSubmitMessage(parsed.submitMessage ?? '')
      setResponseId(parsed.responseId ?? '')
      setCanSpinReward(Boolean(parsed.canSpinReward))
      setRewardResult(parsed.rewardResult ?? null)
      setWheelRotation(parsed.wheelRotation ?? 0)
      setWheelSpinning(false)
      setActiveWheelSegmentId(parsed.activeWheelSegmentId ?? '')
      setCompletedRetryTaskIds(parsed.completedRetryTaskIds ?? [])
      setWheelModalOpen(Boolean(parsed.wheelModalOpen))
      setRetryTaskProgressMap(nextRetryTaskProgressMap)
      setActiveRetryTaskId(nextActiveRetryTaskId)
      setRetryTaskNow(Date.now())
    } catch {
      clearPersistedSurveySession()
    } finally {
      setSessionStateReady(true)
    }
  }, [surveySessionStorageKey])

  useEffect(() => {
    if (!sessionStateReady) {
      return
    }

    persistSurveySessionSnapshot()
  }, [
    activeRetryTaskId,
    activeWheelSegmentId,
    canSpinReward,
    completedRetryTaskIds,
    participantName,
    participantPhone,
    responseId,
    retryTaskProgressMap,
    rewardResult,
    sessionStateReady,
    submitted,
    submitMessage,
    surveySessionStorageKey,
    wheelModalOpen,
    wheelRotation,
  ])

  useEffect(() => {
    if (previewMode || !survey || !sessionStateReady || !responseId) {
      return
    }

    const restoreKey = `${survey.slug}:${responseId}`

    if (rewardSessionRestoreKeyRef.current === restoreKey) {
      return
    }

    rewardSessionRestoreKeyRef.current = restoreKey
    let cancelled = false

    void apiRequest<{
      responseId: string
      participantName: string
      participantPhone: string
      submitMessage?: string | null
      canSpinReward: boolean
      completedTaskIds: string[]
      rewardResult: RewardResultState | null
    }>(`/public/surveys/${survey.slug}/reward-session?responseId=${encodeURIComponent(responseId)}`)
      .then((session) => {
        if (cancelled) {
          return
        }

        const nextCompletedTaskIds = session.completedTaskIds ?? []
        const restoredSegment = session.rewardResult?.landedLabel
          ? wheelSegments.find((segment) => segment.label === session.rewardResult?.landedLabel)
          : null

        setParticipantName((current) => current || session.participantName || '')
        setParticipantPhone((current) => current || session.participantPhone || '')
        setSubmitted(true)
        setSubmitMessage(
          session.submitMessage ??
            (session.canSpinReward
              ? 'Sua resposta foi registrada. Agora a roleta pode mostrar o resultado desta campanha.'
              : 'Sua resposta foi registrada com sucesso.'),
        )
        setWheelSpinning(false)
        setCompletedRetryTaskIds(nextCompletedTaskIds)
        setCanSpinReward(Boolean(session.canSpinReward))
        setRewardResult(session.rewardResult ?? null)
        setWheelModalOpen(Boolean(survey.rewardEnabled && (session.canSpinReward || session.rewardResult)))
        setRetryTaskProgressMap((current) => {
          if (!session.rewardResult?.retryAvailable) {
            return {}
          }

          return Object.fromEntries(
            Object.entries(current).filter(([taskId]) => !nextCompletedTaskIds.includes(taskId)),
          )
        })

        if (restoredSegment) {
          setActiveWheelSegmentId(restoredSegment.id)
        }

        if (!session.rewardResult?.retryAvailable) {
          setActiveRetryTaskId(null)
        }

        setRetryTaskNow(Date.now())
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        rewardSessionRestoreKeyRef.current = ''

        if (!(error instanceof ApiError) || error.status !== 404) {
          return
        }

        clearPersistedSurveySession()
        setSubmitted(false)
        setSubmitMessage('')
        setResponseId('')
        setCanSpinReward(false)
        setRewardResult(null)
        setWheelRotation(0)
        setWheelSpinning(false)
        setActiveWheelSegmentId('')
        setCompletedRetryTaskIds([])
        setWheelModalOpen(false)
        setRetryTaskProgressMap({})
        setActiveRetryTaskId(null)
      })

    return () => {
      cancelled = true
    }
  }, [previewMode, responseId, sessionStateReady, survey, wheelSegments])

  useEffect(() => {
    if (!survey) {
      return
    }

    const visibleQuestionIds = new Set(visibleQuestions.map((question) => question.id))

    setAnswers((current) => {
      const nextEntries = Object.entries(current).filter(([questionId]) => visibleQuestionIds.has(questionId))

      if (nextEntries.length === Object.keys(current).length) {
        return current
      }

      return Object.fromEntries(nextEntries)
    })
  }, [survey, visibleQuestions])

  useEffect(() => {
    if (previewMode || !slug || !trackedSource) {
      return
    }

    const visitKey = `${slug}:${trackedSource}`
    if (trackedVisitKeyRef.current === visitKey) {
      return
    }

    trackedVisitKeyRef.current = visitKey

    void apiRequest<{ ok: boolean }>(`/public/surveys/${slug}/visit`, {
      method: 'POST',
      body: JSON.stringify({ source: trackedSource }),
      keepalive: true,
    }).catch(() => undefined)
  }, [previewMode, slug, trackedSource])

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) {
        window.clearTimeout(spinTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!rewardResult?.retryAvailable) {
      return
    }

    const intervalId = window.setInterval(() => {
      setRetryTaskNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [rewardResult?.retryAvailable])

  useEffect(() => {
    if (!activeRetryTaskId) {
      return
    }

    const markTaskAsReturned = () => {
      if (document.visibilityState === 'hidden') {
        return
      }

      setRetryTaskProgressMap((current) => {
        const currentTask = current[activeRetryTaskId]

        if (!currentTask || currentTask.returnedAt) {
          return current
        }

        return {
          ...current,
          [activeRetryTaskId]: {
            ...currentTask,
            returnedAt: Date.now(),
          },
        }
      })
      setRetryTaskNow(Date.now())
      setActiveRetryTaskId(null)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markTaskAsReturned()
      }
    }

    window.addEventListener('focus', markTaskAsReturned)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', markTaskAsReturned)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [activeRetryTaskId])

  useEffect(() => {
    if (!wheelModalOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && canCloseWheelModal) {
        setWheelModalOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [canCloseWheelModal, wheelModalOpen])

  function resetPreviewSession() {
    setSubmitted(false)
    setSubmitMessage('')
    setResponseId('')
    setCanSpinReward(false)
    setRewardResult(null)
    setEligibilityMessage('')
    setWheelRotation(0)
    setWheelSpinning(false)
    setActiveWheelSegmentId('')
    setCompletedRetryTaskIds([])
    setWheelModalOpen(false)
    setRetryTaskProgressMap({})
    setActiveRetryTaskId(null)
    clearPersistedSurveySession()
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!survey) {
        throw new Error('A pesquisa não está disponível agora.')
      }

      const normalizedName = participantName.trim()
      const normalizedPhone = sanitizePhone(participantPhone)
      const normalizedEmail = participantEmail.trim().toLowerCase()
      const normalizedBirthDay = Number(birthDay)
      const normalizedBirthMonth = Number(birthMonth)

      if (normalizedName.length < 3) {
        throw new Error('Informe o nome completo para continuar.')
      }

      if (!isValidPhone(normalizedPhone)) {
        throw new Error('Informe um telefone válido no formato 21996336092.')
      }

      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error('Informe um e-mail válido ou deixe este campo em branco.')
      }

      if (!normalizedBirthDay || normalizedBirthDay < 1 || normalizedBirthDay > 31) {
        throw new Error('Selecione o dia do aniversário.')
      }

      if (!normalizedBirthMonth || normalizedBirthMonth < 1 || normalizedBirthMonth > 12) {
        throw new Error('Selecione o mês do aniversário.')
      }

      for (const question of visibleQuestions) {
        const currentAnswer = answers[question.id]

        if (question.required && !isQuestionAnswered(question, currentAnswer)) {
          throw new Error(`Preencha a pergunta "${question.title}" para continuar.`)
        }
      }

      if (previewMode) {
        return {
          responseId: 'preview-response',
          rewardEnabled: survey.rewardEnabled,
          rewardEligible: survey.rewardEnabled,
          rewardMessage: survey.rewardEnabled
            ? 'Sua resposta foi registrada. Agora a roleta pode mostrar o resultado desta campanha.'
            : 'Sua resposta foi registrada com sucesso.',
        }
      }

      return apiRequest<{
        responseId: string
        rewardEnabled: boolean
        rewardEligible: boolean
        rewardMessage?: string | null
      }>(`/public/surveys/${survey.slug}/respond`, {
        method: 'POST',
        body: JSON.stringify({
          participant: {
            name: normalizedName,
            phone: normalizedPhone,
            email: normalizedEmail,
            birthDay: normalizedBirthDay,
            birthMonth: normalizedBirthMonth,
          },
          browserCookieId: 'local-browser-cookie',
          fingerprint: 'local-browser-fingerprint',
          answers: visibleQuestions.map((question) => ({
            questionId: question.id,
            value: answers[question.id] ?? '',
          })),
        }),
      })
    },
    onSuccess: (result) => {
      setEligibilityMessage('')
      setResponseId(result.responseId)
      setCanSpinReward(result.rewardEnabled && result.rewardEligible)
      setCompletedRetryTaskIds([])
      setRewardResult(null)
      setActiveWheelSegmentId('')
      setWheelRotation(0)
      setRetryTaskProgressMap({})
      setActiveRetryTaskId(null)
      setSubmitMessage(
        result.rewardMessage ||
          (result.rewardEligible
            ? 'Sua resposta foi registrada. Agora a roleta pode mostrar o resultado desta campanha.'
            : 'Sua resposta foi registrada com sucesso.'),
      )
      setSubmitted(true)
      setWheelModalOpen(result.rewardEnabled)
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Não foi possível registrar sua resposta agora.'
      setRewardResult(null)
      setResponseId('')
      setSubmitMessage('')
      setCompletedRetryTaskIds([])
      setCanSpinReward(false)
      setSubmitted(false)
      setRetryTaskProgressMap({})
      setActiveRetryTaskId(null)
      setEligibilityMessage(message)
    },
  })

  const spinMutation = useMutation({
    mutationFn: async () => {
      if (!survey) {
        throw new Error('A pesquisa não está disponível agora.')
      }

      if (previewMode) {
        const rewardSegments = wheelSegments.filter((segment) => segment.kind === 'reward')
        const neutralSegments = wheelSegments.filter((segment) => segment.kind !== 'reward')
        const previewCompletedTaskIds = Array.from(new Set(completedRetryTaskIds))
        const previewRemainingRetryTasks = (survey.rewardRetryTasks ?? []).filter(
          (task) => !previewCompletedTaskIds.includes(task.id),
        )
        const previewMaxAttempts = 1 + (survey.rewardRetryTasks?.length ?? 0)
        const previewSpinAttempt = previewCompletedTaskIds.length + 1
        const previewIsFinalAttempt = previewSpinAttempt >= previewMaxAttempts
        const shouldWin = previewIsFinalAttempt && rewardSegments.length > 0 && Math.random() < 0.45
        const selectedSegment = shouldWin
          ? pickRandomItem(rewardSegments)
          : pickRandomItem(neutralSegments.length ? neutralSegments : wheelSegments)

        return {
          won: shouldWin,
          item: shouldWin ? selectedSegment.label : undefined,
          landedLabel: selectedSegment.label,
          couponCode: shouldWin ? makePreviewCouponCode() : undefined,
          contactWhatsApp: shouldWin ? survey.rewardContactWhatsApp : undefined,
          retryAvailable: !shouldWin && !previewIsFinalAttempt && previewRemainingRetryTasks.length > 0,
          retryUnlocked: false,
          retryTasks: survey.rewardRetryTasks ?? [],
          completedTaskIds: previewCompletedTaskIds,
          spinAttempt: previewSpinAttempt,
          maxAttempts: previewMaxAttempts,
          finalAttempt: previewIsFinalAttempt,
          pickupAddress: shouldWin ? 'Retire no balcão informado pela campanha.' : undefined,
          message: shouldWin
            ? 'Parabéns! O resultado foi definido com segurança e o local de retirada já está indicado abaixo.'
            : previewIsFinalAttempt
              ? 'Você não teve sorte desta vez. As tentativas desta experiência já foram usadas.'
              : previewRemainingRetryTasks.length > 0
                ? 'Conclua a próxima tarefa para liberar sua próxima chance.'
                : 'Continue participando para liberar sua próxima chance.',
        }
      }

      return apiRequest<{
        won: boolean
        item?: string
        landedLabel?: string
        couponCode?: string
        pickupAddress?: string
        contactWhatsApp?: string
        retryAvailable?: boolean
        retryUnlocked?: boolean
        retryTasks?: RewardRetryTask[]
        completedTaskIds?: string[]
        spinAttempt?: number
        maxAttempts?: number
        finalAttempt?: boolean
        message?: string
      }>(`/public/surveys/${survey.slug}/spin`, {
        method: 'POST',
        body: JSON.stringify({ responseId }),
      })
    },
    onSuccess: (result) => {
      const rewardIndex = result.landedLabel
        ? Math.max(wheelSegments.findIndex((segment) => segment.label === result.landedLabel), 0)
        : 0
      const selectedSegment = wheelSegments[rewardIndex]
      const nextRotation = getSegmentTargetRotation(wheelRotation, wheelSegments.length, rewardIndex)

      if (spinTimeoutRef.current) {
        window.clearTimeout(spinTimeoutRef.current)
      }

      setWheelSpinning(true)
      setRewardResult(null)
      setActiveWheelSegmentId('')
      setWheelRotation(nextRotation)
      spinTimeoutRef.current = window.setTimeout(() => {
        setWheelSpinning(false)
        setCompletedRetryTaskIds(result.completedTaskIds ?? [])
        setCanSpinReward(Boolean(result.retryUnlocked))
        setActiveWheelSegmentId(selectedSegment?.id ?? '')
        if (result.won) {
          setCelebrationKey((current) => current + 1)
        }
        setRewardResult(result)
      }, 5400)
    },
    onError: (error) => {
      setWheelSpinning(false)
      setRewardResult({
        won: false,
        message: error instanceof Error ? error.message : 'Não foi possível girar a roleta agora.',
      })
    },
  })

  const retryTaskClickMutation = useMutation({
    mutationFn: async (task: RewardRetryTask) => {
      if (!survey || !responseId) {
        throw new Error('A participação ainda não está pronta para liberar a chance extra.')
      }

      if (previewMode) {
        const currentCompletedTaskIds = rewardResult?.completedTaskIds ?? completedRetryTaskIds
        const nextCompletedTaskIds = Array.from(new Set([...currentCompletedTaskIds, task.id]))

        return {
          ok: true,
          unlocked: true,
          completedTaskIds: nextCompletedTaskIds,
          remainingTasks: Math.max((survey.rewardRetryTasks?.length ?? 0) - nextCompletedTaskIds.length, 0),
        }
      }

      const result = await apiRequest<{
        ok: boolean
        unlocked: boolean
        completedTaskIds: string[]
        remainingTasks: number
      }>(`/public/surveys/${survey.slug}/retry-task-click`, {
        method: 'POST',
        body: JSON.stringify({
          responseId,
          taskId: task.id,
        }),
      })

      return result
    },
    onSuccess: (result, task) => {
      setCompletedRetryTaskIds(result.completedTaskIds)
      setCanSpinReward(result.unlocked)
      setRetryTaskProgressMap((current) => {
        const nextState = { ...current }
        delete nextState[task.id]
        return nextState
      })
      setRewardResult((current) =>
        current
          ? {
              ...current,
              retryUnlocked: result.unlocked,
              completedTaskIds: result.completedTaskIds,
              message: result.unlocked
                ? 'A tarefa foi registrada. Sua próxima chance já está liberada.'
                : current.message,
            }
          : current,
      )
    },
  })

  const currentRetryTaskProgress = currentRetryTask ? retryTaskProgressMap[currentRetryTask.id] : null
  const currentRetryTaskReturned = Boolean(currentRetryTaskProgress?.returnedAt)
  const currentRetryTaskCanConfirm = currentRetryTask ? canConfirmRetryTask(currentRetryTask.id) : false
  const currentRetryTaskRemainingSeconds = currentRetryTask ? getRetryTaskRemainingSeconds(currentRetryTask.id) : 0
  const currentRetryTaskIsLoading = currentRetryTask
    ? retryTaskClickMutation.isPending && retryTaskClickMutation.variables?.id === currentRetryTask.id
    : false
  const currentRetryTaskStatusLabel = !currentRetryTask
    ? ''
    : !currentRetryTaskProgress
      ? 'Pendente'
      : !currentRetryTaskReturned
        ? 'Volte para a página'
        : currentRetryTaskCanConfirm
          ? 'Pronto para confirmar'
          : `Aguarde ${currentRetryTaskRemainingSeconds}s`
  const currentRetryTaskButtonLabel = !currentRetryTask
    ? ''
    : !currentRetryTaskProgress
      ? 'Ir para a tarefa'
      : !currentRetryTaskReturned
        ? 'Volte para esta página'
        : currentRetryTaskCanConfirm
          ? 'Já concluí'
          : `Aguarde ${currentRetryTaskRemainingSeconds}s`
  const showRetryTaskOverlay = Boolean(rewardResult?.retryAvailable && currentRetryTask && !canSpinReward && !wheelSpinning)

  function startRetryTask(task: RewardRetryTask) {
    const nextRetryTaskProgressMap = {
      ...retryTaskProgressMap,
      [task.id]: {
        startedAt: Date.now(),
        returnedAt: null,
      },
    }

    setRetryTaskProgressMap(nextRetryTaskProgressMap)
    setRetryTaskNow(Date.now())
    setActiveRetryTaskId(task.id)
    persistSurveySessionSnapshot({
      retryTaskProgressMap: nextRetryTaskProgressMap,
      activeRetryTaskId: task.id,
      wheelModalOpen: true,
    })

    window.location.assign(task.url)
  }

  function getRetryTaskProgress(taskId: string) {
    return retryTaskProgressMap[taskId]
  }

  function getRetryTaskRemainingSeconds(taskId: string) {
    const progress = getRetryTaskProgress(taskId)

    if (!progress) {
      return 0
    }

    return Math.max(0, Math.ceil((progress.startedAt + RETRY_TASK_MIN_WAIT_MS - retryTaskNow) / 1000))
  }

  function canConfirmRetryTask(taskId: string) {
    const progress = getRetryTaskProgress(taskId)

    if (!progress?.returnedAt) {
      return false
    }

    return retryTaskNow - progress.startedAt >= RETRY_TASK_MIN_WAIT_MS
  }

  async function handleDownloadRewardProof() {
    if (!rewardResult?.won) {
      return
    }

    setSavingRewardProof(true)

    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1080
      canvas.height = 1350
      const context = canvas.getContext('2d')

      if (!context) {
        throw new Error('Não foi possível gerar a imagem do comprovante.')
      }

      const background = context.createLinearGradient(0, 0, 0, canvas.height)
      background.addColorStop(0, '#1e293b')
      background.addColorStop(0.45, '#0f172a')
      background.addColorStop(1, '#020617')
      context.fillStyle = background
      context.fillRect(0, 0, canvas.width, canvas.height)

      const glow = context.createRadialGradient(220, 180, 40, 220, 180, 460)
      glow.addColorStop(0, 'rgba(250,204,21,0.34)')
      glow.addColorStop(0.4, 'rgba(236,72,153,0.18)')
      glow.addColorStop(1, 'rgba(15,23,42,0)')
      context.fillStyle = glow
      context.fillRect(0, 0, canvas.width, canvas.height)

      context.fillStyle = 'rgba(255,255,255,0.08)'
      fillRoundedRect(context, 72, 72, 936, 1206, 36)

      context.fillStyle = '#fef3c7'
      context.font = '700 28px Arial'
      context.fillText('Comprovante do prêmio', 120, 152)

      const brandName = survey?.brandName || survey?.title || 'Campanha'
      context.fillStyle = '#e2e8f0'
      context.font = '500 24px Arial'
      context.fillText(brandName, 120, 196)

      context.fillStyle = '#86efac'
      context.font = '700 36px Arial'
      context.fillText(`Parabéns, ${participantName || 'participante'}!`, 120, 280)

      context.fillStyle = '#ffffff'
      context.font = '700 66px Arial'
      const prizeLines = wrapCanvasText(context, rewardResult.item || rewardResult.landedLabel || 'Prêmio confirmado', 840)
      let currentY = 370
      for (const line of prizeLines.slice(0, 3)) {
        context.fillText(line, 120, currentY)
        currentY += 78
      }

      context.fillStyle = 'rgba(15,23,42,0.82)'
      fillRoundedRect(context, 120, 500, 840, 140, 28)
      context.fillStyle = '#cbd5e1'
      context.font = '600 24px Arial'
      context.fillText('Protocolo', 156, 554)
      context.fillStyle = '#ffffff'
      context.font = '700 42px Arial'
      context.fillText(rewardResult.couponCode || 'Sem protocolo', 156, 610)

      context.fillStyle = 'rgba(15,23,42,0.72)'
      fillRoundedRect(context, 120, 684, 840, 236, 28)
      context.fillStyle = '#cbd5e1'
      context.font = '600 24px Arial'
      context.fillText('Orientação para resgate', 156, 738)

      context.fillStyle = '#ffffff'
      context.font = '600 32px Arial'
      const instructionLines = wrapCanvasText(
        context,
        'Salve o comprovante e apresente na loja ou clique em Resgatar pelo WhatsApp.',
        768,
      )
      let instructionY = 794
      for (const line of instructionLines.slice(0, 4)) {
        context.fillText(line, 156, instructionY)
        instructionY += 42
      }

      if (rewardResult.pickupAddress) {
        context.fillStyle = 'rgba(255,255,255,0.1)'
        fillRoundedRect(context, 120, 964, 840, 188, 28)
        context.fillStyle = '#fef3c7'
        context.font = '600 24px Arial'
        context.fillText('Endereço de retirada', 156, 1018)

        context.fillStyle = '#ffffff'
        context.font = '500 30px Arial'
        const addressLines = wrapCanvasText(context, rewardResult.pickupAddress, 768)
        let addressY = 1072
        for (const line of addressLines.slice(0, 4)) {
          context.fillText(line, 156, addressY)
          addressY += 38
        }
      }

      context.fillStyle = '#cbd5e1'
      context.font = '500 22px Arial'
      context.fillText('Guarde esta imagem para apresentar no resgate do prêmio.', 120, 1224)

      const link = document.createElement('a')
      link.href = canvas.toDataURL('image/png')
      link.download = formatRewardProofFileName(rewardResult.item || rewardResult.landedLabel || 'roleta')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Não foi possível salvar o comprovante agora.')
    } finally {
      setSavingRewardProof(false)
    }
  }

  function setSingleAnswer(questionId: string, value: string | number) {
    setAnswers((current) => pruneAnswersForCurrentFlow(survey?.questions ?? [], current, questionId, value))
  }

  function toggleOption(questionId: string, value: string) {
    setAnswers((current) => {
      const existing = current[questionId]
      const list = Array.isArray(existing) ? existing : []
      const nextList = list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

      return pruneAnswersForCurrentFlow(survey?.questions ?? [], current, questionId, nextList)
    })
  }

  if (surveyQuery.isLoading) {
    return (
      <div className="min-h-screen px-3 py-4 sm:px-4 sm:py-6" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)' }}>
        <div className="mx-auto max-w-4xl border border-slate-200 bg-white p-6 text-center shadow-card sm:p-10" style={{ borderRadius: 6 }}>
          <p className="text-sm text-slate-500">Carregando pesquisa...</p>
        </div>
      </div>
    )
  }

  if (surveyQuery.isError || !survey) {
    const errorMessage =
      surveyQuery.error instanceof Error
        ? surveyQuery.error.message
        : 'Verifique se o link está correto ou tente novamente mais tarde.'

    return (
      <div className="min-h-screen px-3 py-4 sm:px-4 sm:py-6" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)' }}>
        <div className="mx-auto max-w-4xl border border-slate-200 bg-white p-6 text-center shadow-card sm:p-10" style={{ borderRadius: 6 }}>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Pesquisa indisponível</p>
          <h1 className="mt-4 font-display text-4xl text-slate-950">Não foi possível abrir esta pesquisa agora</h1>
          <p className="mt-4 text-sm text-slate-600">{errorMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-2 py-3 sm:px-4 sm:py-6 lg:px-6" style={{ background: `linear-gradient(180deg, ${survey.primaryColor}12 0%, #f8fafc 24%, #e2e8f0 100%)` }}>
      <div className="mx-auto w-full max-w-6xl">
        <div className="overflow-hidden border border-slate-200 bg-white p-3 shadow-card sm:p-6 lg:p-8" style={{ borderRadius: 6 }}>
          {previewMode ? (
            <div className="mb-5 flex flex-col gap-3 border border-sky-200 bg-sky-50 px-3 py-3 text-sky-950 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-4" style={{ borderRadius: 6 }}>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-sky-700">
                  {sharedPreviewMode ? 'Link de teste' : 'Modo teste'}
                </p>
                <p className="mt-1 text-sm">
                  Esta pesquisa está em teste. O comportamento visual é o mesmo da versão pública, mas nada do que acontecer aqui será salvo em respostas, relatórios ou prêmios reais.
                </p>
              </div>
              {id ? (
                <Link to={`/app/pesquisas/${id}/editar`} className="admin-button self-start">
                  Voltar para o editor
                </Link>
              ) : (
                <div className="admin-badge self-start border-sky-300 bg-white text-sky-800">Link expira ao publicar</div>
              )}
            </div>
          ) : null}

          <header className="border-b border-slate-200 pb-4 sm:pb-5">
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
              <Sparkles className="h-4 w-4" />
              Pesquisa
            </p>
            <h1 className="mt-3 font-display text-2xl leading-tight text-slate-950 sm:text-4xl lg:text-5xl">{survey.title}</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-600 sm:text-[15px] lg:text-base">
              {survey.description || 'Responda os campos abaixo para concluir sua participação.'}
            </p>
          </header>

          {eligibilityMessage && !submitted ? (
            <div className="admin-alert mt-6 border-amber-200 bg-amber-50 text-amber-900">{eligibilityMessage}</div>
          ) : null}

          {!submitted ? (
            <form
              className="mt-5 space-y-4 sm:mt-6 sm:space-y-5"
              onSubmit={(event) => {
                event.preventDefault()
                void submitMutation.mutateAsync()
              }}
            >
              <section className="admin-panel grid gap-4 p-4 sm:p-5 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Nome completo</span>
                  <input
                    aria-label="Nome do participante"
                    className="admin-input"
                    value={participantName}
                    onChange={(event) => setParticipantName(event.target.value)}
                  />
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Telefone com WhatsApp</span>
                  <input
                    aria-label="Telefone do participante"
                    inputMode="numeric"
                    maxLength={11}
                    className="admin-input"
                    placeholder="21996336092"
                    value={participantPhone}
                    onChange={(event) => setParticipantPhone(sanitizePhone(event.target.value))}
                  />
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">E-mail (opcional)</span>
                  <input
                    aria-label="E-mail do participante"
                    type="email"
                    className="admin-input"
                    placeholder="cliente@email.com"
                    value={participantEmail}
                    onChange={(event) => setParticipantEmail(event.target.value)}
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2 text-sm">
                    <span className="text-slate-600">Dia do aniversário</span>
                    <select aria-label="Dia do aniversário" className="admin-select" value={birthDay} onChange={(event) => setBirthDay(event.target.value)}>
                      <option value="">Selecione</option>
                      {Array.from({ length: 31 }, (_, index) => (
                        <option key={index + 1} value={index + 1}>
                          {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-2 text-sm">
                    <span className="text-slate-600">Mês do aniversário</span>
                    <select aria-label="Mês do aniversário" className="admin-select" value={birthMonth} onChange={(event) => setBirthMonth(event.target.value)}>
                      <option value="">Selecione</option>
                      {birthdayMonths.map((month) => (
                        <option key={month.value} value={month.value}>
                          {month.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              {visibleQuestions.map((question, index) => {
                const currentAnswer = answers[question.id]

                return (
                  <section key={question.id} className="border border-slate-200 bg-white p-4 sm:p-5" style={{ borderRadius: 6 }}>
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Pergunta {index + 1}</p>
                        <h2 className="mt-2 font-semibold text-slate-950">{question.title}</h2>
                      </div>
                      <span className="admin-badge border-slate-900 bg-slate-950 text-white">
                        {question.required ? 'Obrigatória' : 'Opcional'}
                      </span>
                    </div>

                    {question.type === 'long_text' ? (
                      <textarea
                        className="admin-input min-h-28 w-full bg-slate-50"
                        value={String(currentAnswer ?? '')}
                        onChange={(event) => setSingleAnswer(question.id, event.target.value)}
                      />
                    ) : question.type === 'multiple_choice' || question.type === 'single_choice' ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {question.options?.map((option) => (
                          <label key={option} className="admin-subcard flex items-center gap-3 text-sm text-slate-700">
                            <input
                              type={question.type === 'single_choice' ? 'radio' : 'checkbox'}
                              name={question.id}
                              checked={
                                question.type === 'single_choice'
                                  ? currentAnswer === option
                                  : Array.isArray(currentAnswer) && currentAnswer.includes(option)
                              }
                              onChange={() =>
                                question.type === 'single_choice'
                                  ? setSingleAnswer(question.id, option)
                                  : toggleOption(question.id, option)
                              }
                            />
                            {option}
                          </label>
                        ))}
                      </div>
                    ) : question.type === 'yes_no' ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {['Sim', 'Não'].map((option) => (
                          <label key={option} className="admin-subcard flex items-center gap-3 text-sm text-slate-700">
                            <input
                              type="radio"
                              name={question.id}
                              checked={currentAnswer === option}
                              onChange={() => setSingleAnswer(question.id, option)}
                            />
                            {option}
                          </label>
                        ))}
                      </div>
                    ) : question.type === 'rating_1_5' ? (
                      <div className="flex flex-wrap gap-3">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setSingleAnswer(question.id, value)}
                            className={`h-12 w-12 border text-sm font-semibold ${
                              currentAnswer === value
                                ? 'border-slate-950 bg-slate-950 text-white'
                                : 'border-slate-200 bg-slate-50 text-slate-700'
                            }`}
                            style={{ borderRadius: 6 }}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    ) : question.type === 'nps' ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="flex items-center gap-2 border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800" style={{ borderRadius: 6 }}>
                            <ThumbsDown className="h-4 w-4" />
                            <span>0 a 6 😕</span>
                          </div>
                          <div className="flex items-center gap-2 border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800" style={{ borderRadius: 6 }}>
                            <Meh className="h-4 w-4" />
                            <span>7 e 8 🙂</span>
                          </div>
                          <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800" style={{ borderRadius: 6 }}>
                            <ThumbsUp className="h-4 w-4" />
                            <span>9 e 10 🤩</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11">
                          {Array.from({ length: 11 }, (_, value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setSingleAnswer(question.id, value)}
                              className={`h-14 border text-sm font-semibold ${
                                currentAnswer === value
                                  ? 'border-slate-950 bg-slate-950 text-white'
                                  : 'border-slate-200 bg-slate-50 text-slate-700'
                              }`}
                              style={{ borderRadius: 6 }}
                            >
                              <span className="block text-base leading-none">{value}</span>
                              <span className="mt-1 block text-[10px] opacity-80">
                                {value <= 6 ? '😕' : value <= 8 ? '🙂' : '🤩'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <input
                        className="admin-input w-full bg-slate-50"
                        value={String(currentAnswer ?? '')}
                        onChange={(event) => setSingleAnswer(question.id, event.target.value)}
                      />
                    )}
                  </section>
                )
              })}

              <div className="admin-alert border-amber-200 bg-amber-50 text-amber-900">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-4 w-4" />
                    Controle da campanha por identificadores
                </div>
                <p className="mt-2">
                    A pesquisa pode continuar recebendo respostas, mas a roleta só fica disponível uma vez por campanha para o mesmo cliente usando o mesmo WhatsApp ou e-mail.
                </p>
              </div>

              <button type="submit" disabled={submitMutation.isPending} className="admin-button-primary w-full justify-center">
                {submitMutation.isPending ? 'Enviando...' : 'Enviar respostas'}
              </button>
            </form>
          ) : (
            <section className="admin-panel mt-6 p-6 text-center">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Pesquisa finalizada</p>
              <h2 className="mt-3 font-display text-4xl text-slate-950">Obrigado por participar</h2>
              <p className="mt-4 text-sm text-slate-600">
                {submitMessage || 'Sua resposta foi registrada com sucesso e já pode alimentar os relatórios do painel.'}
              </p>

              {survey.rewardEnabled ? (
                <div className="mt-6 border border-slate-200 bg-slate-950 p-4 text-white sm:p-5" style={{ borderRadius: 6 }}>
                  <div className="flex items-center justify-center gap-2 font-semibold">
                    <Gift className="h-5 w-5" />
                    Roleta de prêmios
                  </div>

                  {showWheelArea ? (
                    <>
                      <p className="mt-2 text-sm text-slate-300">
                        {canSpinReward
                          ? 'Toque em girar para revelar o seu resultado.'
                          : 'A participação já foi concluída. Confira abaixo o resultado do giro.'}
                      </p>

                      <div className="mt-6">
                        <button
                          type="button"
                          onClick={() => setWheelModalOpen(true)}
                          className="admin-button-primary w-full justify-center"
                        >
                          Abrir roleta em tela cheia
                        </button>
                      </div>

                      {!rewardResult ? (
                        <p className="mt-5 text-center text-xs uppercase tracking-[0.18em] text-slate-400">
                          {wheelSpinning ? 'A sorte está girando na tela cheia...' : 'Abra a roleta para revelar o resultado'}
                        </p>
                      ) : null}

                      {rewardResult ? (
                        rewardResult.won ? (
                          <div className="mt-6 space-y-3 text-center">
                            <div
                              className="mx-auto max-w-2xl border border-amber-300/35 bg-[linear-gradient(180deg,rgba(250,204,21,0.2)_0%,rgba(236,72,153,0.16)_100%)] px-4 py-4 shadow-[0_16px_40px_rgba(250,204,21,0.16)]"
                              style={{ borderRadius: 6 }}
                            >
                              <p className="text-xs uppercase tracking-[0.24em] text-amber-100">Prêmio confirmado</p>
                              <p className="mt-2 text-sm font-semibold text-emerald-100">Parabéns! Você ganhou:</p>
                              <p className="mt-2 font-display text-3xl text-white sm:text-4xl">{rewardResult.item}</p>
                              {rewardResult.landedLabel ? (
                                <p className="mt-3 text-sm text-amber-50/90">
                                  A roleta parou em <span className="font-bold text-white">{rewardResult.landedLabel}</span>
                                </p>
                              ) : null}
                            </div>
                            <div className="mx-auto max-w-sm border border-white/10 bg-white/10 px-4 py-3" style={{ borderRadius: 6 }}>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Protocolo do prêmio</p>
                              <p className="mt-2 text-lg font-semibold text-white">{rewardResult.couponCode}</p>
                            </div>
                            <div className="flex flex-col justify-center gap-3 sm:flex-row">
                              <button
                                type="button"
                                onClick={() => void handleDownloadRewardProof()}
                                disabled={savingRewardProof}
                                className="admin-button-primary"
                              >
                                <Download className="h-4 w-4" />
                                {savingRewardProof ? 'Gerando comprovante...' : 'Salvar comprovante do prêmio'}
                              </button>
                              {rewardContactWhatsAppUrl ? (
                                <a
                                  href={rewardContactWhatsAppUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="admin-button w-full justify-center sm:w-auto"
                                >
                                  <MessageCircle className="h-4 w-4" />
                                  Entrar em contato pelo WhatsApp
                                </a>
                              ) : null}
                            </div>
                            {rewardResult.pickupAddress ? (
                              <div className="mx-auto max-w-xl border border-white/10 bg-white/10 px-4 py-3 text-left" style={{ borderRadius: 6 }}>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Retirada do prêmio</p>
                                <p className="mt-2 text-sm text-white">{rewardResult.pickupAddress}</p>
                              </div>
                            ) : null}
                            {rewardResult.message ? <p className="text-xs text-slate-400">{rewardResult.message}</p> : null}
                          </div>
                        ) : (
                          <div className="mt-6 space-y-3 text-center">
                            {rewardResult.landedLabel ? (
                              <p className="text-sm text-slate-200">
                                A roleta parou em: <span className="font-semibold text-white">{rewardResult.landedLabel}</span>
                              </p>
                            ) : null}
                            <div className="mx-auto max-w-xl border border-white/10 bg-white/5 px-4 py-4" style={{ borderRadius: 6 }}>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Mensagem da roleta</p>
                              <p className="mt-2 text-sm text-slate-200">{rewardResult.message || 'Desta vez não houve prêmio disponível.'}</p>
                            </div>
                            {rewardResult.retryAvailable ? (
                              <div className="mt-5 space-y-4 border border-white/10 bg-white/5 px-4 py-4 text-left" style={{ borderRadius: 6 }}>
                                <div>
                                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Mais uma chance</p>
                                  <p className="mt-2 text-sm text-slate-200">
                                    Abra cada tarefa, volte para esta página, aguarde alguns segundos e toque em "Já concluí" para liberar o segundo giro.
                                  </p>
                                </div>

                                <div className="space-y-3">
                                  {retryTasks.map((task) => {
                                    const completed = completedRetryTaskIds.includes(task.id)
                                    const taskProgress = getRetryTaskProgress(task.id)
                                    const hasReturned = Boolean(taskProgress?.returnedAt)
                                    const canConfirm = canConfirmRetryTask(task.id)
                                    const remainingSeconds = getRetryTaskRemainingSeconds(task.id)
                                    const isLoading =
                                      retryTaskClickMutation.isPending && retryTaskClickMutation.variables?.id === task.id
                                    const statusLabel = completed
                                      ? 'Registrado'
                                      : !taskProgress
                                        ? 'Pendente'
                                        : !hasReturned
                                          ? 'Volte para a página'
                                          : canConfirm
                                            ? 'Pronto para confirmar'
                                            : `Aguarde ${remainingSeconds}s`
                                    const buttonLabel = completed
                                      ? 'Registrado'
                                      : !taskProgress
                                        ? 'Ir para a tarefa'
                                        : !hasReturned
                                          ? 'Volte para esta página'
                                          : canConfirm
                                            ? 'Já concluí'
                                            : `Aguarde ${remainingSeconds}s`

                                    return (
                                      <div
                                        key={task.id}
                                        className="flex flex-col gap-3 border border-white/10 bg-white/5 px-4 py-4 md:flex-row md:items-center md:justify-between"
                                        style={{ borderRadius: 6 }}
                                      >
                                        <div className="min-w-0">
                                          <p className="text-sm font-semibold text-white">{task.title}</p>
                                          <p className="mt-1 text-xs text-slate-400">
                                            {task.type === 'google_review'
                                              ? 'Google'
                                              : task.type === 'instagram_follow'
                                                ? 'Instagram'
                                                : 'Link personalizado'}
                                          </p>
                                        </div>

                                        <div className="flex items-center gap-3">
                                          <span
                                            className={`admin-badge ${
                                              completed
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                : canConfirm
                                                  ? 'border-sky-200 bg-sky-50 text-sky-700'
                                                  : 'border-white/15 bg-white/10 text-white'
                                            }`}
                                          >
                                            {statusLabel}
                                          </span>
                                          <button
                                            type="button"
                                            disabled={completed || isLoading || (Boolean(taskProgress) && !canConfirm)}
                                            onClick={() =>
                                              taskProgress
                                                ? void retryTaskClickMutation.mutateAsync(task)
                                                : startRetryTask(task)
                                            }
                                            className="admin-button-primary disabled:opacity-60"
                                          >
                                            {isLoading ? 'Confirmando...' : buttonLabel}
                                          </button>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>

                                {rewardResult.retryUnlocked || canSpinReward ? (
                                  <div className="border border-emerald-300/20 bg-emerald-400/10 px-4 py-4 text-center" style={{ borderRadius: 6 }}>
                                    <p className="text-sm font-semibold text-emerald-100">Chance extra liberada</p>
                                    <p className="mt-2 text-xs text-emerald-200">
                                      Agora você já pode girar a roleta mais uma vez.
                                    </p>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      ) : null}
                    </>
                  ) : (
                    <div className="mt-5 border border-white/10 bg-white/5 px-4 py-5 text-center" style={{ borderRadius: 6 }}>
                      <p className="text-sm text-slate-200">
                        {submitMessage || 'Sua resposta foi registrada normalmente, mas esta campanha não está disponível para novo giro.'}
                      </p>
                    </div>
                  )}
                </div>
              ) : null}

              {previewMode ? (
                <div className="mt-5 flex justify-center">
                  <button type="button" onClick={resetPreviewSession} className="admin-button">
                    Responder novamente
                  </button>
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>

      {survey.rewardEnabled && wheelModalOpen ? (
        <div className="fixed inset-0 z-50 bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.22)_0%,rgba(15,23,42,0.92)_36%,rgba(2,6,23,0.98)_100%)]">
          <div className="absolute inset-0 overflow-y-auto p-1 sm:p-3 lg:px-6 lg:py-6">
            <div className="mx-auto flex min-h-[calc(100dvh-0.5rem)] w-full max-w-[1500px] flex-col justify-between rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.94)_0%,rgba(3,7,18,0.98)_100%)] p-3 shadow-[0_30px_100px_rgba(2,6,23,0.65)] sm:min-h-[calc(100dvh-1.5rem)] sm:rounded-[28px] sm:p-5 lg:p-8">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-2xl">
                  <p className="text-sm text-slate-300 sm:text-base">
                    {canSpinReward
                      ? 'Gire a roleta para descobrir seu resultado.'
                      : wheelSpinning
                        ? 'A roleta está girando.'
                        : rewardResult?.won
                          ? 'Salve o comprovante e apresente na loja ou clique em Resgatar pelo WhatsApp.'
                          : 'Seu resultado já está disponível.'}
                  </p>
                </div>

                <div className="flex items-center gap-3 self-start">
                  {canCloseWheelModal ? (
                    <button type="button" onClick={() => setWheelModalOpen(false)} className="admin-button px-4 py-3 text-white">
                      <X className="h-4 w-4" />
                      Fechar
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 grid flex-1 gap-3 xl:mt-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,420px)] xl:items-center 2xl:grid-cols-[minmax(0,1.3fr)_440px]">
                <div className="relative isolate flex min-h-[44svh] items-center rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.4)_0%,rgba(15,23,42,0.12)_100%)] px-1 py-2 sm:min-h-[52svh] sm:px-3 sm:py-5 xl:min-h-0 lg:rounded-[28px] lg:px-4 lg:py-6">
                  <PrizeWheel
                    segments={wheelSegments}
                    rotation={wheelRotation}
                    isSpinning={wheelSpinning}
                    primaryColor={survey.primaryColor}
                    activeSegmentId={activeWheelSegmentId}
                    showCelebration={Boolean(rewardResult?.won)}
                    celebrationKey={celebrationKey}
                    disabled={spinMutation.isPending || !responseId || !canSpinReward}
                    variant="fullscreen"
                    spinLabel="Girar agora"
                    onSpin={() => void spinMutation.mutateAsync()}
                  />

                  {rewardResult?.won ? (
                    <div className="absolute inset-0 z-[80] flex items-center justify-center p-3 sm:p-5">
                      <div className="absolute inset-0 rounded-[inherit] bg-slate-950/55 backdrop-blur-[3px]" />
                      <div className="relative w-full max-w-[min(92vw,560px)] rounded-[28px] border border-amber-300/35 bg-[linear-gradient(180deg,rgba(15,23,42,0.18)_0%,rgba(15,23,42,0.52)_8%,rgba(250,204,21,0.26)_28%,rgba(236,72,153,0.18)_100%)] px-5 py-6 text-center shadow-[0_26px_80px_rgba(15,23,42,0.45)] backdrop-blur-md sm:px-7 sm:py-8">
                        <p className="text-xs uppercase tracking-[0.26em] text-amber-100">Prêmio confirmado</p>
                        <p className="mt-3 text-base font-semibold text-emerald-100 sm:text-lg">Parabéns! Você ganhou:</p>
                        <p className="mt-3 font-display text-3xl leading-tight text-white sm:text-4xl">{rewardResult.item}</p>
                        {rewardResult.couponCode ? (
                          <div className="mt-5 rounded-[18px] border border-white/15 bg-slate-950/35 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Protocolo</p>
                            <p className="mt-2 text-lg font-bold text-white sm:text-xl">{rewardResult.couponCode}</p>
                          </div>
                        ) : null}
                        {rewardResult.pickupAddress ? (
                          <div className="mt-4 rounded-[18px] border border-white/15 bg-white/10 px-4 py-3 text-left">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Retirada na loja</p>
                            <p className="mt-2 text-sm text-white">{rewardResult.pickupAddress}</p>
                          </div>
                        ) : null}
                        <div className="mt-5 flex flex-col gap-3">
                          <p className="text-xs text-slate-100">
                            Salve o comprovante e apresente na loja ou clique em Resgatar pelo WhatsApp.
                          </p>
                          {rewardContactWhatsAppUrl ? (
                            <a
                              href={rewardContactWhatsAppUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="admin-button-primary w-full justify-center"
                            >
                              <MessageCircle className="h-4 w-4" />
                              Resgatar pelo WhatsApp
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {showRetryTaskOverlay && currentRetryTask ? (
                    <div className="absolute inset-0 z-[80] flex items-center justify-center p-3 sm:p-5">
                      <div className="absolute inset-0 rounded-[inherit] bg-slate-950/58 backdrop-blur-[3px]" />
                      <div className="relative w-full max-w-[min(92vw,560px)] rounded-[28px] border border-sky-300/30 bg-[linear-gradient(180deg,rgba(15,23,42,0.22)_0%,rgba(15,23,42,0.78)_12%,rgba(59,130,246,0.18)_56%,rgba(15,23,42,0.98)_100%)] px-5 py-6 text-center shadow-[0_26px_80px_rgba(15,23,42,0.48)] backdrop-blur-md sm:px-7 sm:py-8">
                        <p className="text-xs uppercase tracking-[0.26em] text-sky-100">Mais uma chance</p>
                        <p className="mt-3 text-base font-semibold text-white sm:text-lg">
                          {rewardResult?.landedLabel ? `A roleta parou em ${rewardResult.landedLabel}.` : 'Você não ganhou neste giro.'}
                        </p>
                        <p className="mt-3 text-sm text-slate-200 sm:text-base">
                          Conclua esta tarefa, volte para a página e confirme aqui na frente da roleta para liberar o próximo giro.
                        </p>

                        <div className="mt-5 rounded-[20px] border border-white/12 bg-slate-950/35 px-4 py-4 text-left">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Tarefa atual</p>
                          <p className="mt-2 text-lg font-semibold text-white">{currentRetryTask.title}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                            {getRetryTaskTypeLabel(currentRetryTask.type)}
                          </p>
                        </div>

                        <div className="mt-4 flex items-center justify-center">
                          <span
                            className={`admin-badge ${
                              currentRetryTaskCanConfirm
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : 'border-white/15 bg-white/10 text-white'
                            }`}
                          >
                            {currentRetryTaskStatusLabel}
                          </span>
                        </div>

                        <div className="mt-5 flex flex-col gap-3">
                          <button
                            type="button"
                            disabled={currentRetryTaskIsLoading || (Boolean(currentRetryTaskProgress) && !currentRetryTaskCanConfirm)}
                            onClick={() =>
                              currentRetryTaskProgress
                                ? void retryTaskClickMutation.mutateAsync(currentRetryTask)
                                : startRetryTask(currentRetryTask)
                            }
                            className="admin-button-primary w-full justify-center disabled:opacity-60"
                          >
                            {currentRetryTaskIsLoading ? 'Confirmando...' : currentRetryTaskButtonLabel}
                          </button>
                          <p className="text-xs text-slate-200">
                            A roleta continua aberta. Assim que confirmar esta etapa, o botão de girar será liberado aqui mesmo.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4 xl:max-w-[440px]">
                  {!rewardResult ? (
                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-5 text-center">
                      <p className="mt-3 text-lg font-semibold text-white">
                        {wheelSpinning ? 'A sorte está girando...' : canSpinReward ? 'Pronta para girar' : 'Aguardando resultado'}
                      </p>
                      {wheelSpinning ? <p className="mt-2 text-sm text-slate-300">Segure esse momento.</p> : null}
                    </div>
                  ) : rewardResult.won ? (
                    <div ref={rewardProofRef} className="rounded-[24px] border border-amber-300/25 bg-[linear-gradient(180deg,rgba(250,204,21,0.22)_0%,rgba(236,72,153,0.16)_52%,rgba(15,23,42,0.96)_100%)] p-5 shadow-[0_22px_70px_rgba(250,204,21,0.14)]">
                      <p className="text-xs uppercase tracking-[0.24em] text-amber-100">Comprovante do prêmio</p>
                      <p className="mt-3 text-sm font-semibold text-emerald-100">Parabéns, {participantName || 'participante'}!</p>
                      <p className="mt-3 font-display text-3xl leading-tight text-white sm:text-4xl">{rewardResult.item}</p>
                      {rewardResult.couponCode ? (
                        <div className="mt-5 rounded-[18px] border border-white/15 bg-slate-950/35 px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Protocolo</p>
                          <p className="mt-2 text-xl font-bold text-white">{rewardResult.couponCode}</p>
                        </div>
                      ) : null}
                      {rewardResult.pickupAddress ? (
                        <div className="mt-4 rounded-[18px] border border-white/10 bg-white/10 px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Retirada</p>
                          <p className="mt-2 text-sm text-white">{rewardResult.pickupAddress}</p>
                        </div>
                      ) : null}
                      <p className="mt-4 text-xs uppercase tracking-[0.18em] text-amber-50/80">{survey.brandName || survey.title}</p>
                      <div className="mt-5 flex flex-col gap-3">
                        <button
                          type="button"
                          onClick={() => void handleDownloadRewardProof()}
                          disabled={savingRewardProof}
                          className="admin-button-primary w-full justify-center"
                        >
                          <Download className="h-4 w-4" />
                          {savingRewardProof ? 'Gerando comprovante...' : 'Salvar comprovante'}
                        </button>
                        {rewardContactWhatsAppUrl ? (
                          <a
                            href={rewardContactWhatsAppUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="admin-button w-full justify-center"
                          >
                            <MessageCircle className="h-4 w-4" />
                            Entrar em contato para receber o prêmio
                          </a>
                        ) : null}
                        <p className="text-center text-xs text-slate-300">
                            Salve no celular para apresentar no resgate do prêmio.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Resultado</p>
                      {rewardResult.landedLabel ? (
                        <p className="mt-3 text-sm text-slate-200">
                          A roleta parou em <span className="font-semibold text-white">{rewardResult.landedLabel}</span>
                        </p>
                      ) : null}
                      <p className="mt-3 text-lg font-semibold text-white">{rewardResult.message || 'Desta vez não houve prêmio disponível.'}</p>
                      {rewardResult.retryAvailable && currentRetryTask ? (
                        <p className="mt-3 text-sm text-slate-300">
                          A próxima etapa é <span className="font-semibold text-white">{currentRetryTask.title}</span>. Ela aparece na frente da roleta.
                        </p>
                      ) : null}
                    </div>
                  )}

                  {rewardResult?.retryAvailable ? (
                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-5 text-left">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Mais uma chance</p>
                      {canSpinReward ? (
                        <div className="mt-4 rounded-[18px] border border-emerald-300/25 bg-emerald-500/10 px-4 py-4">
                          <p className="text-sm font-semibold text-emerald-100">Nova tentativa liberada</p>
                          <p className="mt-2 text-sm text-slate-200">
                            A tarefa atual já foi confirmada. Agora você pode girar a roleta novamente.
                          </p>
                        </div>
                      ) : currentRetryTask ? (
                        <div className="mt-4 rounded-[18px] border border-white/10 bg-slate-950/30 px-4 py-4">
                          <p className="text-sm font-semibold text-white">{currentRetryTask.title}</p>
                          <p className="mt-1 text-xs text-slate-400">{getRetryTaskTypeLabel(currentRetryTask.type)}</p>
                          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <span
                              className={`admin-badge ${
                                currentRetryTaskCanConfirm
                                  ? 'border-sky-200 bg-sky-50 text-sky-700'
                                  : 'border-white/15 bg-white/10 text-white'
                              }`}
                            >
                              {currentRetryTaskStatusLabel}
                            </span>
                            <button
                              type="button"
                              disabled={currentRetryTaskIsLoading || (Boolean(currentRetryTaskProgress) && !currentRetryTaskCanConfirm)}
                              onClick={() =>
                                currentRetryTaskProgress
                                  ? void retryTaskClickMutation.mutateAsync(currentRetryTask)
                                  : startRetryTask(currentRetryTask)
                              }
                              className="admin-button-primary justify-center disabled:opacity-60"
                            >
                              {currentRetryTaskIsLoading ? 'Confirmando...' : currentRetryTaskButtonLabel}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-[18px] border border-white/10 bg-slate-950/30 px-4 py-4">
                          <p className="text-sm text-slate-200">Todas as tarefas configuradas para esta participação já foram usadas.</p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
