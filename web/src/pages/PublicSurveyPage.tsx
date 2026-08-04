import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, Download, Gift, MessageCircle, Trophy, Sparkles, PartyPopper, MapPin, Clock, ExternalLink, Instagram, Star, X, Frown, AlertTriangle, ArrowLeft, MousePointerClick } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { PrizeWheel, getSegmentTargetRotation, type PrizeWheelSegment } from '@/components/public/PrizeWheel'
import { getBrowserCookieId, getBrowserFingerprint } from '@/lib/browser-identity'
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

function getDaysInBirthMonth(month: number) {
  if (!month || month < 1 || month > 12) {
    return 31
  }

  if (month === 2) {
    return 29
  }

  if ([4, 6, 9, 11].includes(month)) {
    return 30
  }

  return 31
}

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
  landedSegmentId?: string
  itemImageUrl?: string
  couponCode?: string
  awardedAt?: string
  redemptionExpiresAt?: string
  pickupAddress?: string
  contactWhatsApp?: string
  redemptionMethod?: 'address_only' | 'address_and_whatsapp'
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

type PublicRewardPreviewItem = {
  id: string
  title: string
  wheelLabel?: string
  imageUrl?: string
  outcomeRole?: 'prize' | 'no_prize' | 'showcase'
  showOnWheel?: boolean
  quantityTotal?: number
  quantityAwarded?: number
  sortOrder?: number
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

function hexToRgba(hex: string, alpha: number) {
  const cleanHex = hex.replace('#', '')
  const bigint = parseInt(cleanHex, 16)
  const red = (bigint >> 16) & 255
  const green = (bigint >> 8) & 255
  const blue = bigint & 255

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
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

function formatDatePtBr(value: string) {
  const normalized = value.trim().replace(' ', 'T')
  const parsed = new Date(normalized.includes('T') ? normalized : `${normalized}T00:00:00`)

  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed)
}

function getRewardProofExpiresAt(input: {
  awardedAt?: string
  redemptionExpiresAt?: string
  redemptionExpirationDays?: number
}) {
  if (input.redemptionExpiresAt) {
    return input.redemptionExpiresAt
  }

  if (!input.awardedAt) {
    return ''
  }

  const parsed = new Date(input.awardedAt)

  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  parsed.setDate(parsed.getDate() + Math.max(1, input.redemptionExpirationDays ?? 15))
  return parsed.toISOString()
}

function getRewardRedemptionInstruction(input: {
  redemptionMethod?: 'address_only' | 'address_and_whatsapp'
  hasWhatsApp: boolean
}) {
  if (input.redemptionMethod === 'address_and_whatsapp' && input.hasWhatsApp) {
    return 'Salve o comprovante e apresente na loja ou clique em Resgatar pelo WhatsApp.'
  }

  return 'Salve o comprovante e apresente na loja dentro do prazo informado.'
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

function getRetryTaskTypeIcon(type: RewardRetryTask['type']) {
  if (type === 'google_review') {
    return Star
  }

  if (type === 'instagram_follow') {
    return Instagram
  }

  return ExternalLink
}

function getRetryTaskTypeColor(type: RewardRetryTask['type']) {
  if (type === 'google_review') {
    return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: 'text-amber-500' }
  }

  if (type === 'instagram_follow') {
    return { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700', icon: 'text-pink-500' }
  }

  return { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', icon: 'text-sky-500' }
}

function RetryTaskInstructions({ currentStep }: { currentStep: number }) {
  const steps = [
    {
      label: 'Abrir tarefa',
      description: 'Clique no botão para ir até a tarefa.',
      icon: MousePointerClick,
    },
    {
      label: 'Voltar pelo navegador',
      description: 'Use o botão voltar do navegador para retornar.',
      icon: ArrowLeft,
    },
    {
      label: 'Roleta liberada',
      description: 'A roleta será desbloqueada automaticamente.',
      icon: Gift,
    },
  ]

  return (
    <div className="space-y-3">
      {steps.map((step, index) => {
        const stepNumber = index + 1
        const isActive = stepNumber === currentStep
        const isCompleted = stepNumber < currentStep
        const Icon = step.icon

        return (
          <div
            key={step.label}
            className={`flex items-start gap-3 rounded-[14px] border p-3 text-left transition ${
              isCompleted
                ? 'border-emerald-200 bg-emerald-50'
                : isActive
                  ? 'border-sky-200 bg-sky-50 ring-1 ring-sky-100'
                  : 'border-slate-200 bg-slate-50'
            }`}
          >
            <div
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9 ${
                isCompleted
                  ? 'bg-emerald-500 text-white'
                  : isActive
                    ? 'bg-sky-500 text-white'
                    : 'bg-white text-slate-400 shadow-sm'
              }`}
            >
              {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </div>
            <div>
              <p
                className={`text-sm font-semibold ${
                  isCompleted ? 'text-emerald-800' : isActive ? 'text-sky-800' : 'text-slate-600'
                }`}
              >
                {stepNumber}. {step.label}
              </p>
              <p
                className={`mt-0.5 text-xs ${
                  isCompleted ? 'text-emerald-700' : isActive ? 'text-sky-700' : 'text-slate-500'
                }`}
              >
                {step.description}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function buildPrizeWheelSegments(
  items: PublicRewardPreviewItem[],
  wheelMode: 'standard' | 'advanced' | undefined,
) {
  if (wheelMode === 'advanced') {
    const visibleItems = items
      .filter((item) => item.showOnWheel !== false)
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
      .slice(0, 12)
      .map((item) => ({
        id: item.id,
        label: item.wheelLabel?.trim() || item.title,
        kind:
          item.outcomeRole === 'no_prize'
            ? ('neutral' as const)
            : item.outcomeRole === 'showcase'
              ? ('showcase' as const)
              : ('reward' as const),
      }))

    if (!visibleItems.length) {
      return neutralWheelLabels.map((label, index) => ({
        id: `neutral-${index}`,
        label,
        kind: 'neutral' as const,
      }))
    }

    const missingSlots = Math.max(0, 6 - visibleItems.length)
    const fallbackSegments = Array.from({ length: missingSlots }, (_, index) => ({
      id: `neutral-${index}`,
      label: neutralWheelLabels[index % neutralWheelLabels.length],
      kind: 'neutral' as const,
    }))

    return [...visibleItems, ...fallbackSegments]
  }

  const rewardItems = items
    .filter((item) => item.outcomeRole === 'prize')
    .slice(0, 3)
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
        label: rewardItems[rewardIndex].wheelLabel?.trim() || rewardItems[rewardIndex].title,
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
  const autoConfirmTriggeredRef = useRef<Record<string, boolean>>({})
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
          reward_wheel_mode?: 'standard' | 'advanced' | null
          reward_final_spin_mode?: 'allow_no_prize' | 'guaranteed_prize' | null
          reward_pickup_address?: string | null
          reward_contact_whatsapp?: string | null
          reward_redemption_method?: 'address_only' | 'address_and_whatsapp' | null
          reward_redemption_expiration_days?: number | null
          reward_retry_unlock_enabled?: boolean
          reward_retry_tasks?: RewardRetryTask[]
          reward_items?: Array<{
            id: string
            title: string
            wheel_label?: string | null
            image_url?: string | null
            outcome_role?: 'prize' | 'no_prize' | 'showcase'
            show_on_wheel?: boolean
            quantity_total?: number
            quantity_awarded?: number
            sort_order?: number
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
  const wheelSegments = useMemo(
    () => buildPrizeWheelSegments(survey?.rewardPreviewItems ?? [], survey?.rewardWheelMode),
    [survey?.rewardPreviewItems, survey?.rewardWheelMode],
  )
  const retryTasks = rewardResult?.retryTasks ?? survey?.rewardRetryTasks ?? []
  const canCloseWheelModal =
    !wheelSpinning &&
    Boolean(
      rewardResult &&
        (rewardResult.won || (rewardResult.finalAttempt && !rewardResult.retryAvailable && !canSpinReward)),
    )
  const rewardPickupAddress = rewardResult?.pickupAddress ?? survey?.rewardPickupAddress
  const rewardRedemptionMethod = rewardResult?.redemptionMethod ?? survey?.rewardRedemptionMethod ?? 'address_and_whatsapp'
  const rewardProofExpiresAt = getRewardProofExpiresAt({
    awardedAt: rewardResult?.awardedAt,
    redemptionExpiresAt: rewardResult?.redemptionExpiresAt,
    redemptionExpirationDays: survey?.rewardRedemptionExpirationDays,
  })
  const rewardContactWhatsAppUrl =
    rewardResult?.won && rewardRedemptionMethod === 'address_and_whatsapp' && rewardResult.contactWhatsApp
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
  const rewardInstructionText = getRewardRedemptionInstruction({
    redemptionMethod: rewardRedemptionMethod,
    hasWhatsApp: Boolean(rewardContactWhatsAppUrl),
  })
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
        const restoredSegment = session.rewardResult?.landedSegmentId
          ? wheelSegments.find((segment) => segment.id === session.rewardResult?.landedSegmentId)
          : session.rewardResult?.landedLabel
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
          browserCookieId: getBrowserCookieId(),
          fingerprint: getBrowserFingerprint(),
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
        const realRewardSegments = wheelSegments.filter((segment) => segment.kind === 'reward')
        const neutralSegments = wheelSegments.filter((segment) => segment.kind === 'neutral')
        const showcaseSegments = wheelSegments.filter((segment) => segment.kind === 'showcase')
        const previewCompletedTaskIds = Array.from(new Set(completedRetryTaskIds))
        const previewRemainingRetryTasks = (survey.rewardRetryTasks ?? []).filter(
          (task) => !previewCompletedTaskIds.includes(task.id),
        )
        const previewMaxAttempts = 1 + (survey.rewardRetryTasks?.length ?? 0)
        const previewSpinAttempt = previewCompletedTaskIds.length + 1
        const previewIsFinalAttempt = previewSpinAttempt >= previewMaxAttempts
        const guaranteedPrize = survey.rewardFinalSpinMode === 'guaranteed_prize'
        const shouldWin =
          previewIsFinalAttempt && realRewardSegments.length > 0
            ? guaranteedPrize || Math.random() < 0.45
            : realRewardSegments.length > 0 && Math.random() < 0.2
        // Perdeu: prefere cair em segmentos neutros (sem premio). Se nao houver,
        // usa vitrine como fallback visual, nunca como premio real.
        const losingPool =
          neutralSegments.length > 0
            ? neutralSegments
            : showcaseSegments.length > 0
              ? showcaseSegments
              : wheelSegments
        const selectedSegment = shouldWin
          ? pickRandomItem(realRewardSegments)
          : pickRandomItem(losingPool)

        return {
          won: shouldWin,
          item: shouldWin ? selectedSegment.label : undefined,
          landedLabel: selectedSegment.label,
          landedSegmentId: selectedSegment.id,
          couponCode: shouldWin ? makePreviewCouponCode() : undefined,
          awardedAt: shouldWin ? new Date().toISOString() : undefined,
          redemptionExpiresAt: shouldWin
            ? getRewardProofExpiresAt({
                awardedAt: new Date().toISOString(),
                redemptionExpirationDays: survey.rewardRedemptionExpirationDays,
              })
            : undefined,
          contactWhatsApp: shouldWin ? survey.rewardContactWhatsApp : undefined,
          redemptionMethod: shouldWin ? survey.rewardRedemptionMethod : undefined,
          retryAvailable: !shouldWin && !previewIsFinalAttempt && previewRemainingRetryTasks.length > 0,
          retryUnlocked: false,
          retryTasks: survey.rewardRetryTasks ?? [],
          completedTaskIds: previewCompletedTaskIds,
          spinAttempt: previewSpinAttempt,
          maxAttempts: previewMaxAttempts,
          finalAttempt: previewIsFinalAttempt,
          pickupAddress: shouldWin ? survey.rewardPickupAddress ?? 'Retire no balcão informado pela campanha.' : undefined,
          itemImageUrl: shouldWin
            ? survey.rewardPreviewItems?.find((item) => item.id === selectedSegment.id)?.imageUrl
            : undefined,
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
        landedSegmentId?: string
        itemImageUrl?: string
        couponCode?: string
        awardedAt?: string
        redemptionExpiresAt?: string
        pickupAddress?: string
        contactWhatsApp?: string
        redemptionMethod?: 'address_only' | 'address_and_whatsapp'
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
      const rewardIndex = result.landedSegmentId
        ? Math.max(wheelSegments.findIndex((segment) => segment.id === result.landedSegmentId), 0)
        : result.landedLabel
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
    : currentRetryTaskIsLoading
      ? 'Confirmando...'
      : !currentRetryTaskProgress
        ? 'Pendente'
        : !currentRetryTaskReturned
          ? 'Volte para a página'
          : currentRetryTaskCanConfirm
            ? 'Pronto para girar'
            : 'Verificando tarefa'
  const currentRetryTaskButtonLabel = !currentRetryTask
    ? ''
    : currentRetryTaskIsLoading
      ? 'Liberando roleta...'
      : !currentRetryTaskProgress
        ? 'Ir para a tarefa'
        : !currentRetryTaskReturned
          ? 'Volte para esta página'
          : currentRetryTaskCanConfirm
            ? 'Liberar roleta'
            : `Aguarde ${currentRetryTaskRemainingSeconds}s`
  const showRetryTaskOverlay = Boolean(rewardResult?.retryAvailable && currentRetryTask && !canSpinReward && !wheelSpinning)

  useEffect(() => {
    if (!currentRetryTask || !currentRetryTaskReturned || !currentRetryTaskCanConfirm) {
      return
    }

    if (autoConfirmTriggeredRef.current[currentRetryTask.id]) {
      return
    }

    if (retryTaskClickMutation.isPending) {
      return
    }

    autoConfirmTriggeredRef.current[currentRetryTask.id] = true
    void retryTaskClickMutation.mutateAsync(currentRetryTask)
  }, [
    currentRetryTask,
    currentRetryTaskReturned,
    currentRetryTaskCanConfirm,
    retryTaskClickMutation,
  ])

  function openRetryTaskLink(task: RewardRetryTask) {
    window.location.assign(task.url)
  }

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

    openRetryTaskLink(task)
  }

  function handleRetryTaskCardClick(input: {
    task: RewardRetryTask
    taskProgress?: { startedAt: number; returnedAt: number | null }
    canConfirm: boolean
    isLoading: boolean
  }) {
    if (input.isLoading || input.canConfirm) {
      return
    }

    if (input.taskProgress) {
      openRetryTaskLink(input.task)
      return
    }

    startRetryTask(input.task)
  }

  function getRetryTaskProgress(taskId: string) {
    return retryTaskProgressMap[taskId]
  }

  function getRetryTaskRemainingSeconds(taskId: string) {
    const progress = getRetryTaskProgress(taskId)

    if (!progress) {
      return 0
    }

    if (!progress.returnedAt) {
      return Math.ceil(RETRY_TASK_MIN_WAIT_MS / 1000)
    }

    return Math.max(0, Math.ceil((progress.returnedAt + RETRY_TASK_MIN_WAIT_MS - retryTaskNow) / 1000))
  }

  function canConfirmRetryTask(taskId: string) {
    const progress = getRetryTaskProgress(taskId)

    if (!progress?.returnedAt) {
      return false
    }

    return retryTaskNow - progress.returnedAt >= RETRY_TASK_MIN_WAIT_MS
  }

  async function handleDownloadRewardProof() {
    if (!rewardResult?.won) {
      return
    }

    setSavingRewardProof(true)

    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1080
      canvas.height = rewardPickupAddress ? 1280 : 1080
      const context = canvas.getContext('2d')

      if (!context) {
        throw new Error('Não foi possível gerar a imagem do comprovante.')
      }

      const primaryHex = survey?.primaryColor && /^#([0-9A-Fa-f]{6})$/.test(survey.primaryColor) ? survey.primaryColor : '#0f172a'
      const pagePadding = 64
      const contentWidth = canvas.width - pagePadding * 2

      // Fundo com gradiente na cor primária
      const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
      gradient.addColorStop(0, '#ffffff')
      gradient.addColorStop(0.55, '#ffffff')
      gradient.addColorStop(0.85, hexToRgba(primaryHex, 0.16))
      gradient.addColorStop(1, hexToRgba(primaryHex, 0.28))
      context.fillStyle = gradient
      context.fillRect(0, 0, canvas.width, canvas.height)

      // Cartão principal
      context.shadowColor = 'rgba(15,23,42,0.08)'
      context.shadowBlur = 36
      context.shadowOffsetY = 14
      context.fillStyle = '#ffffff'
      fillRoundedRect(context, pagePadding, pagePadding, contentWidth, canvas.height - pagePadding * 2, 28)
      context.shadowColor = 'transparent'
      context.shadowBlur = 0
      context.shadowOffsetY = 0

      let currentY = pagePadding + 56

      // Troféu
      context.fillStyle = primaryHex
      context.font = '700 56px Arial'
      context.textBaseline = 'middle'
      context.fillText('🏆', canvas.width / 2, currentY + 4)
      context.textBaseline = 'alphabetic'

      // Prêmio confirmado
      currentY += 68
      context.textAlign = 'center'
      context.fillStyle = '#64748b'
      context.font = '800 16px Arial'
      context.letterSpacing = '2px'
      context.fillText('PRÊMIO CONFIRMADO', canvas.width / 2, currentY)
      context.letterSpacing = '0px'

      // Parabéns
      currentY += 38
      context.fillStyle = '#0f172a'
      context.font = '700 30px Arial'
      context.fillText(`Parabéns, ${participantName || 'você'}!`, canvas.width / 2, currentY)

      // Prêmio
      currentY += 50
      context.fillStyle = '#64748b'
      context.font = '500 18px Arial'
      context.fillText('Você ganhou:', canvas.width / 2, currentY)

      currentY += 42
      context.fillStyle = primaryHex
      context.font = '900 48px Arial'
      const prizeLines = wrapCanvasText(context, rewardResult.item || rewardResult.landedLabel || 'Prêmio confirmado', 880)
      for (const line of prizeLines.slice(0, 3)) {
        context.fillText(line, canvas.width / 2, currentY)
        currentY += 60
      }

      currentY += 10

      // Protocolo / Cupom
      if (rewardResult.couponCode) {
        const codeBoxY = currentY
        const codeBoxHeight = 164
        const codeBoxX = pagePadding + 40
        const codeBoxW = contentWidth - 80

        // Corpo branco com bordas arredondadas
        context.fillStyle = '#ffffff'
        fillRoundedRect(context, codeBoxX, codeBoxY, codeBoxW, codeBoxHeight, 16)

        // Faixa superior colorida
        context.fillStyle = primaryHex
        fillRoundedRect(context, codeBoxX, codeBoxY, codeBoxW, 56, 16)
        context.fillRect(codeBoxX, codeBoxY + 40, codeBoxW, 20)

        context.textAlign = 'center'
        context.fillStyle = '#ffffff'
        context.font = '800 14px Arial'
        context.letterSpacing = '2px'
        context.fillText('PROTOCOLO / CUPOM', canvas.width / 2, codeBoxY + 36)
        context.letterSpacing = '0px'

        context.textAlign = 'center'
        context.fillStyle = '#0f172a'
        context.font = '900 42px Arial'
        context.fillText(rewardResult.couponCode, canvas.width / 2, codeBoxY + 124)

        currentY += codeBoxHeight + 22
      }

      // Válido até
      if (rewardProofExpiresAt) {
        const infoBoxY = currentY
        const infoBoxHeight = 92
        context.fillStyle = '#f8fafc'
        fillRoundedRect(context, pagePadding + 40, infoBoxY, contentWidth - 80, infoBoxHeight, 16)

        // Ícone de relógio
        const iconCenterY = infoBoxY + infoBoxHeight / 2
        context.fillStyle = hexToRgba(primaryHex, 0.12)
        context.beginPath()
        context.arc(pagePadding + 84, iconCenterY, 24, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = primaryHex
        context.font = '700 26px Arial'
        context.textBaseline = 'middle'
        context.fillText('🕐', pagePadding + 84, iconCenterY + 6)
        context.textBaseline = 'alphabetic'

        context.textAlign = 'left'
        context.fillStyle = '#64748b'
        context.font = '800 13px Arial'
        context.letterSpacing = '1px'
        context.fillText('VÁLIDO ATÉ:', pagePadding + 124, infoBoxY + 40)
        context.letterSpacing = '0px'

        context.fillStyle = '#0f172a'
        context.font = '800 26px Arial'
        context.fillText(formatDatePtBr(rewardProofExpiresAt), pagePadding + 124, infoBoxY + 72)

        currentY += infoBoxHeight + 16
      }

      // Retirada
      if (rewardPickupAddress) {
        const addressBoxY = currentY
        const addressLines = wrapCanvasText(context, rewardPickupAddress, contentWidth - 200)
        const addressBoxHeight = Math.max(110, 58 + addressLines.slice(0, 4).length * 28)

        context.fillStyle = '#f8fafc'
        fillRoundedRect(context, pagePadding + 40, addressBoxY, contentWidth - 80, addressBoxHeight, 16)

        // Ícone de localização
        const iconCenterY = addressBoxY + 42
        context.fillStyle = hexToRgba(primaryHex, 0.12)
        context.beginPath()
        context.arc(pagePadding + 84, iconCenterY, 24, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = primaryHex
        context.font = '700 26px Arial'
        context.textBaseline = 'middle'
        context.fillText('📍', pagePadding + 84, iconCenterY + 6)
        context.textBaseline = 'alphabetic'

        context.textAlign = 'left'
        context.fillStyle = '#64748b'
        context.font = '800 13px Arial'
        context.letterSpacing = '1px'
        context.fillText('RETIRADA:', pagePadding + 124, addressBoxY + 36)
        context.letterSpacing = '0px'

        context.fillStyle = '#334155'
        context.font = '600 20px Arial'
        let addressY = addressBoxY + 64
        for (const line of addressLines.slice(0, 4)) {
          context.fillText(line, pagePadding + 124, addressY)
          addressY += 28
        }

        currentY += addressBoxHeight + 16
      }

      // Rodapé
      context.textAlign = 'center'
      const footerY = canvas.height - pagePadding - 34
      context.fillStyle = '#94a3b8'
      context.font = '500 14px Arial'
      context.fillText(`Emitido em ${new Date().toLocaleDateString('pt-BR')} • Comprovante oficial de prêmio.`, canvas.width / 2, footerY)

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
      <div className="min-h-screen bg-slate-50 px-3 py-4 sm:px-4 sm:py-6">
        <div className="mx-auto max-w-4xl border border-slate-200 bg-white p-6 text-center shadow-card sm:p-10" style={{ borderRadius: 8 }}>
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
      <div className="min-h-screen bg-slate-50 px-3 py-4 sm:px-4 sm:py-6">
        <div className="mx-auto max-w-4xl border border-slate-200 bg-white p-6 text-center shadow-card sm:p-10" style={{ borderRadius: 8 }}>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Pesquisa indisponível</p>
          <h1 className="mt-4 font-display text-4xl text-slate-950">Não foi possível abrir esta pesquisa agora</h1>
          <p className="mt-4 text-sm text-slate-600">{errorMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-3 sm:px-4 sm:py-6 lg:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <div className="overflow-hidden border border-slate-200 bg-white p-4 shadow-card sm:p-6 lg:p-8" style={{ borderRadius: 8 }}>
          {previewMode ? (
            <div className="mb-5 flex flex-col gap-3 border border-sky-200 bg-sky-50 px-3 py-3 text-sky-950 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-4" style={{ borderRadius: 8 }}>
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

          {survey.bannerUrl ? (
            <div className="mb-5 overflow-hidden sm:-mx-6 sm:-mt-8 lg:-mx-8 lg:-mt-8" style={{ borderRadius: '8px 8px 0 0' }}>
              <img src={survey.bannerUrl} alt="" className="h-40 w-full object-cover sm:h-52" />
            </div>
          ) : null}

          <header className="border-b border-slate-100 pb-4 sm:pb-5">
            <div className="flex items-start gap-4">
              {survey.logoUrl ? (
                <img src={survey.logoUrl} alt={survey.brandName || survey.title} className="h-12 w-12 shrink-0 rounded-lg object-cover sm:h-14 sm:w-14" />
              ) : null}
              <div className="min-w-0 flex-1">
                {survey.brandName ? (
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{survey.brandName}</p>
                ) : null}
                <h1 className="font-display text-2xl leading-tight sm:text-4xl lg:text-5xl" style={{ color: survey.primaryColor || '#0f172a' }}>
                  {survey.title}
                </h1>
                <p className="mt-3 max-w-2xl text-sm text-slate-600 sm:text-[15px] lg:text-base">
                  {survey.description || 'Responda os campos abaixo para concluir sua participação.'}
                </p>
              </div>
            </div>
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
              <section className="grid gap-4 border border-slate-200 bg-white p-4 sm:p-5 md:grid-cols-2" style={{ borderRadius: 8 }}>
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
                    placeholder="21989988988"
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
                    <span className="text-slate-600">Mês</span>
                    <select
                      aria-label="Mês do aniversário"
                      className="admin-select"
                      value={birthMonth}
                      onChange={(event) => {
                        const nextMonth = event.target.value
                        setBirthMonth(nextMonth)
                        if (birthDay) {
                          const maxDay = getDaysInBirthMonth(Number(nextMonth))
                          if (Number(birthDay) > maxDay) {
                            setBirthDay('')
                          }
                        }
                      }}
                    >
                      <option value="">Selecione o mês</option>
                      {birthdayMonths.map((month) => (
                        <option key={month.value} value={month.value}>
                          {month.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-2 text-sm">
                    <span className="text-slate-600">Dia</span>
                    <select
                      aria-label="Dia do aniversário"
                      className="admin-select"
                      value={birthDay}
                      disabled={!birthMonth}
                      onChange={(event) => setBirthDay(event.target.value)}
                    >
                      <option value="">{birthMonth ? 'Selecione o dia' : 'Escolha o mês primeiro'}</option>
                      {Array.from({ length: getDaysInBirthMonth(Number(birthMonth)) }, (_, index) => (
                        <option key={index + 1} value={index + 1}>
                          {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              {visibleQuestions.map((question, questionIndex) => {
                const currentAnswer = answers[question.id]
                const isOptionSelected = (option: string) =>
                  question.type === 'single_choice'
                    ? currentAnswer === option
                    : Array.isArray(currentAnswer) && currentAnswer.includes(option)

                return (
                  <section key={question.id} className="border border-slate-200 bg-white p-4 sm:p-5" style={{ borderRadius: 8 }}>
                    <div className="mb-4 flex items-start gap-3">
                      <span
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: survey.primaryColor || '#334155' }}
                      >
                        {questionIndex + 1}
                      </span>
                      <div className="min-w-0">
                        <h2 className="font-semibold text-slate-950">
                          {question.title}
                          {question.required ? <span className="ml-1 text-rose-500">*</span> : null}
                        </h2>
                        {question.description ? (
                          <p className="mt-1 text-sm text-slate-500">{question.description}</p>
                        ) : null}
                      </div>
                    </div>

                    {question.type === 'long_text' ? (
                      <textarea
                        className="admin-input min-h-28 w-full bg-white"
                        value={String(currentAnswer ?? '')}
                        onChange={(event) => setSingleAnswer(question.id, event.target.value)}
                      />
                    ) : question.type === 'multiple_choice' || question.type === 'single_choice' ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {question.options?.map((option) => {
                          const selected = isOptionSelected(option)
                          return (
                            <label
                              key={option}
                              className={`flex cursor-pointer items-center gap-3 rounded-[8px] border px-4 py-3 text-sm transition ${
                                selected
                                  ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                              }`}
                              style={selected && survey.primaryColor ? { borderColor: survey.primaryColor, backgroundColor: survey.primaryColor } : undefined}
                            >
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
                                className={selected ? 'accent-white' : undefined}
                              />
                              {option}
                            </label>
                          )
                        })}
                      </div>
                    ) : question.type === 'yes_no' ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {['Sim', 'Não'].map((option) => {
                          const selected = currentAnswer === option
                          return (
                            <label
                              key={option}
                              className={`flex cursor-pointer items-center gap-3 rounded-[8px] border px-4 py-3 text-sm transition ${
                                selected
                                  ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                              }`}
                              style={selected && survey.primaryColor ? { borderColor: survey.primaryColor, backgroundColor: survey.primaryColor } : undefined}
                            >
                              <input
                                type="radio"
                                name={question.id}
                                checked={currentAnswer === option}
                                onChange={() => setSingleAnswer(question.id, option)}
                                className={selected ? 'accent-white' : undefined}
                              />
                              {option}
                            </label>
                          )
                        })}
                      </div>
                    ) : question.type === 'rating_1_5' ? (
                      <div className="flex flex-wrap gap-3">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setSingleAnswer(question.id, value)}
                            className={`h-12 w-12 border text-sm font-semibold transition ${
                              currentAnswer === value
                                ? 'border-slate-950 bg-slate-950 text-white'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
                            }`}
                            style={currentAnswer === value && survey.primaryColor ? { borderColor: survey.primaryColor, backgroundColor: survey.primaryColor } : undefined}
                            aria-label={`Nota ${value}`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    ) : question.type === 'nps' ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Pouco provável</span>
                          <span>Muito provável</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11">
                          {Array.from({ length: 11 }, (_, value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setSingleAnswer(question.id, value)}
                              aria-label={`NPS nota ${value}`}
                              className={`h-14 border text-sm font-semibold transition ${
                                currentAnswer === value
                                  ? 'border-slate-950 bg-slate-950 text-white'
                                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
                              }`}
                              style={currentAnswer === value && survey.primaryColor ? { borderColor: survey.primaryColor, backgroundColor: survey.primaryColor, borderRadius: 8 } : { borderRadius: 8 }}
                            >
                              <span className="block text-base leading-none">{value}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <input
                        className="admin-input w-full bg-white"
                        value={String(currentAnswer ?? '')}
                        onChange={(event) => setSingleAnswer(question.id, event.target.value)}
                      />
                    )}
                  </section>
                )
              })}

              {visibleQuestions.length > 1 ? (
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{visibleQuestions.length} {visibleQuestions.length === 1 ? 'pergunta' : 'perguntas'}</span>
                  <span>{Object.keys(answers).filter((id) => visibleQuestions.some((q) => q.id === id)).length} respondidas</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitMutation.isPending}
                className="w-full justify-center border px-6 py-3 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60"
                style={{ borderRadius: 8, backgroundColor: survey.primaryColor || '#0f172a' }}
              >
                {submitMutation.isPending ? 'Enviando...' : 'Enviar pesquisa'}
              </button>
            </form>
          ) : (
            <section className="mt-6 border border-slate-200 bg-white p-6 text-center shadow-card sm:p-8" style={{ borderRadius: 8 }}>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-[0_8px_24px_rgba(16,185,129,0.22)] sm:h-20 sm:w-20">
                <CheckCircle2 className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={1.5} />
              </div>
              <h2 className="mt-5 font-display text-3xl text-slate-950 sm:text-4xl">Obrigado por participar</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm text-slate-600 sm:text-base">
                {submitMessage || 'Sua resposta foi registrada com sucesso.'}
              </p>

              {survey.rewardEnabled ? (
                <div className="mt-7 overflow-hidden rounded-[20px] border border-amber-200 bg-amber-50 p-5 text-center shadow-[0_12px_32px_rgba(245,158,11,0.12)] sm:p-6">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-amber-500 shadow-sm">
                    <Gift className="h-6 w-6" />
                  </div>
                  <p className="mt-3 text-base font-semibold text-slate-900">
                    {canSpinReward
                      ? 'Sua vez de girar a roleta!'
                      : rewardResult?.won
                        ? 'Você ganhou um prêmio!'
                        : rewardResult
                          ? 'Seu resultado está disponível.'
                          : 'A roleta está disponível.'}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {canSpinReward
                      ? 'Toque abaixo para descobrir se ganhou.'
                      : rewardResult?.won
                        ? 'Toque abaixo para ver os detalhes do prêmio.'
                        : rewardResult
                          ? 'Toque abaixo para ver o resultado do seu giro.'
                          : 'Toque abaixo para abrir a roleta.'}
                  </p>
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setWheelModalOpen(true)}
                      className="admin-button-primary w-full justify-center px-6"
                      style={{ backgroundColor: survey.primaryColor || '#0f172a' }}
                    >
                      {canSpinReward ? 'Girar roleta' : rewardResult?.won ? 'Ver meu prêmio' : 'Ver roleta'}
                    </button>
                  </div>
                </div>
              ) : null}

              {previewMode ? (
                <div className="mt-5 flex justify-center">
                  <button
                    type="button"
                    onClick={resetPreviewSession}
                    className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
                  >
                    Responder novamente
                  </button>
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>

      {survey.rewardEnabled && wheelModalOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex h-full w-full flex-col bg-white px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-100 pb-3 sm:pb-4">
                <p className="max-w-2xl text-sm text-slate-600 sm:text-base">
                  {canSpinReward
                    ? 'Gire a roleta.'
                    : wheelSpinning
                      ? 'A roleta está girando.'
                      : rewardResult?.won
                        ? rewardInstructionText
                        : 'Seu resultado já está disponível.'}
                </p>

                {canCloseWheelModal ? (
                  <button
                    type="button"
                    onClick={() => setWheelModalOpen(false)}
                    className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50"
                  >
                    <X className="h-4 w-4" />
                    Fechar
                  </button>
                ) : null}
              </div>

              <div className="flex flex-1 flex-col justify-center py-4 sm:py-6">
                <div className="mx-auto w-full max-w-[820px]">
                  <div className="relative isolate flex min-h-[56svh] items-center justify-center rounded-[28px] bg-white px-1 py-3 sm:min-h-[60svh] sm:px-3 sm:py-5">
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
                      <div className="absolute inset-0 z-[80] flex flex-col bg-slate-50 p-3 animate-fade-in sm:p-5">
                        <div className="mx-auto flex h-full w-full max-w-[540px] flex-col">
                          <div className="flex flex-1 flex-col justify-between overflow-hidden text-center">
                            <div className="flex flex-col items-center justify-center">
                              <div
                                className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-[0_8px_24px_rgba(0,0,0,0.1)] sm:h-12 sm:w-12"
                                style={{ color: survey?.primaryColor || '#0f172a' }}
                              >
                                <Trophy className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.5} />
                              </div>

                              <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 sm:text-xs">Prêmio confirmado</p>
                              <p className="mt-0.5 text-sm font-semibold text-slate-900 sm:text-lg">
                                {participantName ? `Parabéns, ${participantName}!` : 'Parabéns!'}
                              </p>

                              <div className="mt-1">
                                <p className="text-[10px] text-slate-500 sm:text-xs">Você ganhou:</p>
                                <p className="font-display text-base font-bold text-slate-950 sm:text-2xl">{rewardResult.item}</p>
                              </div>

                              {rewardInstructionText ? (
                                <p className="mx-auto mt-1 max-w-[260px] text-[10px] leading-snug text-slate-500 sm:text-xs">{rewardInstructionText}</p>
                              ) : null}
                            </div>

                            <div className="mt-1.5 flex w-full flex-col gap-1.5 sm:gap-2">
                              {rewardResult.couponCode ? (
                                <div className="w-full rounded-xl border border-slate-200 bg-white p-2 text-left shadow-sm">
                                  <p className="text-center text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">Protocolo / Cupom</p>
                                  <div className="mt-1 flex items-center justify-between gap-2">
                                    <p className="flex-1 break-all text-left text-base font-black tracking-widest text-slate-950 sm:text-lg">{rewardResult.couponCode}</p>
                                    <button
                                      type="button"
                                      onClick={() => void navigator.clipboard.writeText(rewardResult.couponCode ?? '')}
                                      className="flex-shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-95 sm:text-xs"
                                      style={{ backgroundColor: survey?.primaryColor || '#0f172a' }}
                                    >
                                      Copiar
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              {rewardProofExpiresAt ? (
                                <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-sm">
                                  <div
                                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full sm:h-8 sm:w-8"
                                    style={{ backgroundColor: `${survey?.primaryColor || '#0f172a'}15` }}
                                  >
                                    <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" style={{ color: survey?.primaryColor || '#0f172a' }} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Válido até</p>
                                    <p className="text-xs font-semibold text-slate-900 sm:text-sm">{formatDatePtBr(rewardProofExpiresAt)}</p>
                                  </div>
                                </div>
                              ) : null}

                              {rewardPickupAddress ? (
                                <div className="flex w-full items-start gap-2 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-sm">
                                  <div
                                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full sm:h-8 sm:w-8"
                                    style={{ backgroundColor: `${survey?.primaryColor || '#0f172a'}15` }}
                                  >
                                    <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4" style={{ color: survey?.primaryColor || '#0f172a' }} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Retirada</p>
                                    <p className="text-[10px] leading-snug text-slate-700 sm:text-xs">{rewardPickupAddress}</p>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex w-full flex-col gap-1.5 pt-2 sm:gap-2 sm:pt-3">
                            {rewardContactWhatsAppUrl ? (
                              <a
                                href={rewardContactWhatsAppUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:opacity-90 active:scale-95 sm:text-sm"
                                style={{ backgroundColor: survey?.primaryColor || '#22c55e' }}
                              >
                                <MessageCircle className="h-4 w-4" />
                                Resgatar pelo WhatsApp
                              </a>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void handleDownloadRewardProof()}
                              disabled={savingRewardProof}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-900 bg-white px-4 py-2.5 text-xs font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 active:scale-95 sm:text-sm"
                            >
                              <Download className="h-4 w-4" />
                              {savingRewardProof ? 'Gerando comprovante...' : 'Salvar comprovante'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {showRetryTaskOverlay && currentRetryTask ? (
                      <div className="absolute inset-0 z-[80] flex items-center justify-center p-3 sm:p-5 animate-fade-in">
                        <div className="absolute inset-0 rounded-[inherit] bg-white/85 backdrop-blur-[3px]" />
                        <div className="relative w-full max-w-[min(94vw,520px)] rounded-[28px] border border-sky-200 bg-white px-5 py-6 text-center shadow-[0_24px_80px_rgba(14,165,233,0.18)] sm:px-8 sm:py-9 animate-fade-in-scale">
                          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-sky-600 shadow-[0_8px_24px_rgba(14,165,233,0.24)] sm:h-16 sm:w-16">
                            <PartyPopper className="h-7 w-7 sm:h-8 sm:w-8" />
                          </div>
                          <p className="mt-4 text-xs font-bold uppercase tracking-[0.24em] text-sky-600">Mais uma chance</p>
                          <p className="mt-2 text-base font-semibold text-slate-900 sm:text-lg">
                            Você não ganhou neste giro.
                          </p>
                          <p className="mt-1 text-sm text-slate-500">Complete a tarefa abaixo para girar novamente.</p>

                          {!currentRetryTaskReturned ? (
                            <>
                              <div className="mt-5">
                                <RetryTaskInstructions
                                  currentStep={currentRetryTaskProgress ? 2 : 1}
                                />
                              </div>

                              <div
                                className={`mt-5 rounded-[20px] border px-5 py-4 text-left transition ${
                                  currentRetryTaskIsLoading
                                    ? 'border-slate-200 bg-slate-50'
                                    : `${getRetryTaskTypeColor(currentRetryTask.type).border} ${getRetryTaskTypeColor(currentRetryTask.type).bg} cursor-pointer hover:shadow-md`
                                }`}
                                role="button"
                                tabIndex={currentRetryTaskIsLoading ? -1 : 0}
                                onClick={() =>
                                  handleRetryTaskCardClick({
                                    task: currentRetryTask,
                                    taskProgress: currentRetryTaskProgress ?? undefined,
                                    canConfirm: currentRetryTaskCanConfirm,
                                    isLoading: currentRetryTaskIsLoading,
                                  })
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    handleRetryTaskCardClick({
                                      task: currentRetryTask,
                                      taskProgress: currentRetryTaskProgress ?? undefined,
                                      canConfirm: currentRetryTaskCanConfirm,
                                      isLoading: currentRetryTaskIsLoading,
                                    })
                                  }
                                }}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white shadow-sm ${getRetryTaskTypeColor(currentRetryTask.type).icon}`}>
                                    {(() => {
                                      const Icon = getRetryTaskTypeIcon(currentRetryTask.type)
                                      return <Icon className="h-5 w-5" />
                                    })()}
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Tarefa atual</p>
                                    <p className="mt-1 text-lg font-semibold text-slate-950 sm:text-xl">{currentRetryTask.title}</p>
                                    <p className={`mt-1 text-xs font-semibold uppercase tracking-[0.16em] ${getRetryTaskTypeColor(currentRetryTask.type).text}`}>
                                      {getRetryTaskTypeLabel(currentRetryTask.type)}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <div className="mt-4 flex items-center justify-center">
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                                  {currentRetryTaskStatusLabel}
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="mt-5 flex gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-left">
                              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                              <div>
                                <p className="text-sm font-semibold text-amber-900">Atenção</p>
                                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                                  Se você ganhar o prêmio, será necessário apresentar comprovantes de que cumpriu a tarefa (print da tela, por exemplo) no momento da retirada.
                                </p>
                              </div>
                            </div>
                          )}

                          {currentRetryTaskReturned ? (
                            <div className="mt-4">
                              <div className="flex items-center justify-between text-xs text-slate-600">
                                <span className="font-medium">Aguarde, a roleta já será liberada</span>
                                <span className="font-mono font-semibold">{currentRetryTaskRemainingSeconds}s</span>
                              </div>
                              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full bg-sky-500 transition-all duration-300"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      ((retryTaskNow - currentRetryTaskProgress.startedAt) / RETRY_TASK_MIN_WAIT_MS) * 100,
                                    )}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ) : null}

                          <div className="mt-5 flex items-center justify-center">
                            {currentRetryTaskReturned ? (
                              <button
                                type="button"
                                disabled={!currentRetryTaskCanConfirm || currentRetryTaskIsLoading}
                                onClick={() => void retryTaskClickMutation.mutateAsync(currentRetryTask)}
                                className="admin-button-primary w-full justify-center px-6 py-3 text-sm"
                                style={{ backgroundColor: survey.primaryColor || '#0f172a' }}
                              >
                                {currentRetryTaskIsLoading ? 'Liberando roleta...' : 'Girar roleta novamente'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={currentRetryTaskIsLoading || Boolean(currentRetryTaskProgress)}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  if (currentRetryTaskProgress) {
                                    openRetryTaskLink(currentRetryTask)
                                    return
                                  }
                                  startRetryTask(currentRetryTask)
                                }}
                                className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <ExternalLink className="h-4 w-4" />
                                {currentRetryTaskProgress ? 'Reabrir tarefa' : 'Ir para a tarefa'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {rewardResult && !rewardResult.won && !showRetryTaskOverlay && !wheelSpinning && !canSpinReward ? (
                      <div className="absolute inset-0 z-[80] flex items-center justify-center p-3 sm:p-5 animate-fade-in">
                        <div className="absolute inset-0 rounded-[inherit] bg-white/85 backdrop-blur-[3px]" />
                        <div className="relative w-full max-w-[min(94vw,520px)] rounded-[28px] border border-slate-200 bg-white px-5 py-6 text-center shadow-[0_24px_80px_rgba(15,23,42,0.14)] sm:px-8 sm:py-9 animate-fade-in-scale">
                          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500 shadow-[0_8px_24px_rgba(15,23,42,0.12)] sm:h-16 sm:w-16">
                            <Frown className="h-7 w-7 sm:h-8 sm:w-8" />
                          </div>
                          <p className="mt-4 text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Não foi dessa vez</p>
                          <p className="mt-2 text-base font-semibold text-slate-900 sm:text-lg">
                            Você não ganhou desta vez.
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {rewardResult.finalAttempt
                              ? 'Suas tentativas desta experiência já foram usadas.'
                              : 'Não desanime, continue participando das próximas campanhas.'}
                          </p>
                          <p className="mt-3 text-sm font-semibold text-slate-700">Obrigado por participar!</p>

                          {rewardResult.spinAttempt && rewardResult.maxAttempts ? (
                            <div className="mt-5">
                              <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                                <span>Progresso</span>
                                <span>
                                  Tentativa {rewardResult.spinAttempt} de {rewardResult.maxAttempts}
                                </span>
                              </div>
                              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full bg-slate-400 transition-all duration-500"
                                  style={{
                                    width: `${Math.min(100, ((rewardResult.spinAttempt - 1) / (rewardResult.maxAttempts - 1 || 1)) * 100)}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ) : null}

                          <div className="mt-6 flex flex-col gap-3">
                            <button
                              type="button"
                              onClick={() => setWheelModalOpen(false)}
                              className="admin-button-primary w-full justify-center"
                              style={{ backgroundColor: survey?.primaryColor }}
                            >
                              Entendi
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {!showRetryTaskOverlay && !rewardResult?.won && !wheelSpinning ? (
                    <div className="mt-4 animate-fade-in-up">
                      {rewardResult?.retryAvailable && canSpinReward ? (
                        <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-5 py-5 text-center shadow-[0_12px_32px_rgba(16,185,129,0.12)]">
                          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                            <Sparkles className="h-5 w-5" />
                          </div>
                          <p className="mt-2 text-base font-bold text-emerald-800">Sua próxima tentativa está liberada!</p>
                          <p className="mt-1 text-sm text-emerald-700">Gire a roleta novamente para tentar ganhar.</p>
                        </div>
                      ) : rewardResult ? (
                        <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-5 py-5 text-center shadow-[0_12px_32px_rgba(245,158,11,0.12)]">
                          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                            <Star className="h-5 w-5" />
                          </div>
                          {rewardResult.landedLabel ? (
                            <p className="mt-2 text-sm text-amber-800">
                              A roleta parou em <span className="font-bold text-amber-900">{rewardResult.landedLabel}</span>
                            </p>
                          ) : null}
                          <p className="mt-1 text-base font-bold text-amber-900">
                            {rewardResult.message || 'Não foi dessa vez, mas não desanime!'}
                          </p>
                          {rewardResult.finalAttempt ? (
                            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                              Suas tentativas desta experiência foram usadas
                            </p>
                          ) : rewardResult.maxAttempts ? (
                            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                              Tentativa {rewardResult.spinAttempt} de {rewardResult.maxAttempts}
                            </p>
                          ) : null}
                        </div>
                      ) : !canSpinReward ? (
                        <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-center">
                          <p className="text-sm font-semibold text-slate-700">Aguardando resultado</p>
                        </div>
                      ) : null}
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
