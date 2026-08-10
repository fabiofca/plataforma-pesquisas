import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, Download, Gift, Loader2, MessageCircle, Trophy, Sparkles, PartyPopper, MapPin, Clock, ExternalLink, Instagram, Star, X, Frown, AlertTriangle } from 'lucide-react'
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

const winnerConfettiPalette = ['#facc15', '#fb7185', '#38bdf8', '#8b5cf6', '#22c55e', '#f97316', '#ffffff']
const winnerConfettiRainPieces = Array.from({ length: 28 }, (_, index) => ({
  left: `${4 + ((index * 9) % 92)}%`,
  delay: `${index * 80}ms`,
  duration: `${2200 + (index % 5) * 220}ms`,
  drift: `${index % 2 === 0 ? -(10 + (index % 4) * 5) : 10 + (index % 4) * 5}px`,
  rotate: `${index % 2 === 0 ? -190 : 190}deg`,
  color: winnerConfettiPalette[index % winnerConfettiPalette.length],
  width: `${6 + (index % 3) * 3}px`,
  height: `${12 + (index % 4) * 4}px`,
  radius: index % 4 === 0 ? '999px' : '3px',
}))

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

const RETRY_TASK_MIN_WAIT_MS = 5000
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

function strokeRoundedRect(
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
  context.stroke()
}

function drawProofTrophyIcon(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  color: string,
) {
  context.save()
  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = 4
  context.lineCap = 'round'
  context.lineJoin = 'round'

  context.beginPath()
  context.moveTo(centerX - 16, centerY - 14)
  context.lineTo(centerX + 16, centerY - 14)
  context.lineTo(centerX + 12, centerY + 2)
  context.quadraticCurveTo(centerX, centerY + 14, centerX - 12, centerY + 2)
  context.closePath()
  context.stroke()

  context.beginPath()
  context.moveTo(centerX - 8, centerY + 6)
  context.lineTo(centerX + 8, centerY + 6)
  context.moveTo(centerX, centerY + 6)
  context.lineTo(centerX, centerY + 16)
  context.moveTo(centerX - 12, centerY + 20)
  context.lineTo(centerX + 12, centerY + 20)
  context.stroke()

  context.beginPath()
  context.arc(centerX - 19, centerY - 8, 8, Math.PI * 0.5, Math.PI * 1.5, true)
  context.stroke()

  context.beginPath()
  context.arc(centerX + 19, centerY - 8, 8, Math.PI * 1.5, Math.PI * 0.5, true)
  context.stroke()

  context.restore()
}

function drawProofClockIcon(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  color: string,
) {
  context.save()
  context.strokeStyle = color
  context.lineWidth = 4
  context.lineCap = 'round'
  context.lineJoin = 'round'

  context.beginPath()
  context.arc(centerX, centerY, 13, 0, Math.PI * 2)
  context.stroke()

  context.beginPath()
  context.moveTo(centerX, centerY)
  context.lineTo(centerX, centerY - 7)
  context.moveTo(centerX, centerY)
  context.lineTo(centerX + 6, centerY + 4)
  context.stroke()

  context.restore()
}

function extractCalendarDateParts(value: string) {
  const trimmed = value.trim()
  const matchedDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (matchedDate) {
    return {
      year: Number(matchedDate[1]),
      month: Number(matchedDate[2]),
      day: Number(matchedDate[3]),
    }
  }

  const normalized = trimmed.replace(' ', 'T')
  const parsed = new Date(normalized.includes('T') ? normalized : `${normalized}T00:00:00`)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  }
}

type PublicSurveyValidationState = {
  target: string
  message: string
}

function formatDatePtBr(value: string) {
  const parts = extractCalendarDateParts(value)

  if (!parts) {
    return ''
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)))
}

function buildRewardProofExpirationIsoDate(input: {
  awardedAt?: string
  redemptionExpiresAt?: string
  redemptionExpirationDays?: number
}) {
  const baseParts = extractCalendarDateParts(input.redemptionExpiresAt ?? input.awardedAt ?? '')

  if (!baseParts) {
    return ''
  }

  const date = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day))

  if (!input.redemptionExpiresAt) {
    date.setUTCDate(date.getUTCDate() + Math.max(1, input.redemptionExpirationDays ?? 15))
  }

  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getRewardProofExpiresAt(input: {
  awardedAt?: string
  redemptionExpiresAt?: string
  redemptionExpirationDays?: number
}) {
  return buildRewardProofExpirationIsoDate(input)
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
  const [validationState, setValidationState] = useState<PublicSurveyValidationState | null>(null)
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
  const [wheelTransitionReady, setWheelTransitionReady] = useState(false)
  const [attendantSuggestions, setAttendantSuggestions] = useState<string[]>([])
  const trackedVisitKeyRef = useRef('')
  const sessionHydratedRef = useRef(false)
  const rewardSessionRestoreKeyRef = useRef('')
  const spinTimeoutRef = useRef<number | null>(null)
  const rewardProofRef = useRef<HTMLDivElement | null>(null)
  const validationElementRefs = useRef<Record<string, HTMLElement | null>>({})
  const autoConfirmTriggeredRef = useRef<Record<string, boolean>>({})
  const previousVisibleQuestionIdsRef = useRef<string[]>([])
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
          allow_multiple_responses?: boolean
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
  const rewardProofExpiresAtRaw = getRewardProofExpiresAt({
    awardedAt: rewardResult?.awardedAt,
    redemptionExpiresAt: rewardResult?.redemptionExpiresAt,
    redemptionExpirationDays: survey?.rewardRedemptionExpirationDays,
  })
  const rewardProofExpiresAt = rewardProofExpiresAtRaw || (rewardResult?.won ? new Date(Date.now() + Math.max(1, survey?.rewardRedemptionExpirationDays ?? 15) * 86400000).toISOString() : '')
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

  // Fetch attendant suggestions when survey loads
  useEffect(() => {
    if (!survey?.slug || previewMode) {
      setAttendantSuggestions([])
      return
    }

    let cancelled = false

    apiRequest<Array<{ id: string; name: string }>>(`/public/surveys/${survey.slug}/attendants`)
      .then((attendants) => {
        if (!cancelled) {
          setAttendantSuggestions(attendants.map((a) => a.name))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAttendantSuggestions([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [survey?.slug, previewMode])

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
      setWheelTransitionReady(false)
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setWheelTransitionReady(true)
      })
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [sessionStateReady])

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
            : wheelSegments.find((segment) => segment.kind === 'neutral')
            ?? null

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
        setRewardResult(
          session.rewardResult ??
            (!session.canSpinReward && session.submitMessage
              ? { won: false, message: session.submitMessage }
              : null),
        )
        setWheelModalOpen(
          Boolean(
            survey.rewardEnabled &&
              session.canSpinReward,
          ),
        )
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
    const currentVisibleQuestionIds = visibleQuestions.map((question) => question.id)
    const previousVisibleQuestionIds = previousVisibleQuestionIdsRef.current

    if (!previousVisibleQuestionIds.length) {
      previousVisibleQuestionIdsRef.current = currentVisibleQuestionIds
      return
    }

    const newlyVisibleQuestionIds = currentVisibleQuestionIds.filter((questionId) => !previousVisibleQuestionIds.includes(questionId))
    previousVisibleQuestionIdsRef.current = currentVisibleQuestionIds

    if (!newlyVisibleQuestionIds.length) {
      return
    }

    const targetQuestionId = newlyVisibleQuestionIds[newlyVisibleQuestionIds.length - 1]

    window.requestAnimationFrame(() => {
      const element = validationElementRefs.current[`question:${targetQuestionId}`]

      if (!element) {
        return
      }

      const rect = element.getBoundingClientRect()
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight
      const isFullyVisible = rect.top >= 24 && rect.bottom <= viewportHeight - 24

      if (isFullyVisible) {
        return
      }

      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [visibleQuestions])

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

  function setValidationElementRef(key: string, element: HTMLElement | null) {
    validationElementRefs.current[key] = element
  }

  function focusValidationTarget(target: string, message: string) {
    setValidationState({ target, message })
    setEligibilityMessage(message)

    window.requestAnimationFrame(() => {
      const element = validationElementRefs.current[target]

      if (!element) {
        return
      }

      element.scrollIntoView({ behavior: 'smooth', block: 'center' })

      const focusable = element.querySelector('input, select, textarea, button')

      if (focusable instanceof HTMLElement) {
        focusable.focus({ preventScroll: true })
      }
    })
  }

  function clearValidationTarget(target: string) {
    setValidationState((current) => (current?.target === target ? null : current))
  }

  function resetPreviewSession() {
    setSubmitted(false)
    setSubmitMessage('')
    setResponseId('')
    setCanSpinReward(false)
    setRewardResult(null)
    setEligibilityMessage('')
      setValidationState(null)
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
        focusValidationTarget('participant-name', 'Informe o nome completo para continuar.')
        throw new Error('Informe o nome completo para continuar.')
      }

      if (!isValidPhone(normalizedPhone)) {
        focusValidationTarget('participant-phone', 'Informe um telefone válido no formato 21996336092.')
        throw new Error('Informe um telefone válido no formato 21996336092.')
      }

      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        focusValidationTarget('participant-email', 'Informe um e-mail válido ou deixe este campo em branco.')
        throw new Error('Informe um e-mail válido ou deixe este campo em branco.')
      }

      if (!normalizedBirthMonth || normalizedBirthMonth < 1 || normalizedBirthMonth > 12) {
        focusValidationTarget('participant-birth-month', 'Selecione o mês do aniversário.')
        throw new Error('Selecione o mês do aniversário.')
      }

      if (!normalizedBirthDay || normalizedBirthDay < 1 || normalizedBirthDay > 31) {
        focusValidationTarget('participant-birth-day', 'Selecione o dia do aniversário.')
        throw new Error('Selecione o dia do aniversário.')
      }

      for (const question of visibleQuestions) {
        const currentAnswer = answers[question.id]

        if (question.required && !isQuestionAnswered(question, currentAnswer)) {
          focusValidationTarget(`question:${question.id}`, `Preencha a pergunta "${question.title}" para continuar.`)
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
      setValidationState(null)
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
      setWheelModalOpen(result.rewardEnabled && result.rewardEligible)
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
        // Perdeu: sempre cai em segmentos neutros (sem premio). Vitrine nunca
        // pode ser resultado visual de perda — itens de vitrine sao apenas decorativos.
        const losingPool = neutralSegments.length > 0 ? neutralSegments : wheelSegments.filter((s) => s.kind !== 'showcase')
        const selectedSegment = shouldWin
          ? pickRandomItem(realRewardSegments)
          : losingPool.length > 0
            ? pickRandomItem(losingPool)
            : { id: `neutral-fallback-${Date.now()}`, label: neutralWheelLabels[0] ?? 'Não foi dessa vez', kind: 'neutral' as const }

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
      const segmentIndexById = result.landedSegmentId
        ? wheelSegments.findIndex((segment) => segment.id === result.landedSegmentId)
        : -1
      const segmentIndexByLabel =
        segmentIndexById === -1 && result.landedLabel
          ? wheelSegments.findIndex((segment) => segment.label === result.landedLabel)
          : -1
      const resolvedIndex = segmentIndexById >= 0 ? segmentIndexById : segmentIndexByLabel >= 0 ? segmentIndexByLabel : -1
      const fallbackNeutralIndex = wheelSegments.findIndex((segment) => segment.kind === 'neutral')
      const rewardIndex = resolvedIndex >= 0 ? resolvedIndex : fallbackNeutralIndex >= 0 ? fallbackNeutralIndex : 0
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
      const isConflictError = error instanceof ApiError && error.status === 409
      if (isConflictError) {
        setCanSpinReward(false)
      }
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
      delete autoConfirmTriggeredRef.current[task.id]
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
    onError: (_error, task) => {
      delete autoConfirmTriggeredRef.current[task.id]
    },
  })

  const currentRetryTaskProgress = currentRetryTask ? retryTaskProgressMap[currentRetryTask.id] : null
  const currentRetryTaskReturned = Boolean(currentRetryTaskProgress?.returnedAt)
  const currentRetryTaskCanConfirm = currentRetryTask ? canConfirmRetryTask(currentRetryTask.id) : false
  const currentRetryTaskReadyToUnlock = Boolean(currentRetryTask && currentRetryTaskReturned && currentRetryTaskCanConfirm)
  const currentRetryTaskRemainingSeconds = currentRetryTask ? getRetryTaskRemainingSeconds(currentRetryTask.id) : 0
  const currentRetryTaskCountdownValue =
    currentRetryTask && currentRetryTaskReturned && !currentRetryTaskCanConfirm ? Math.max(1, currentRetryTaskRemainingSeconds) : 0
  const retryExitGuardActive = Boolean(
    activeRetryTaskId ||
      currentRetryTaskProgress ||
      (currentRetryTaskReturned && !currentRetryTaskCanConfirm) ||
      retryTaskClickMutation.isPending,
  )
  const currentRetryTaskIsLoading = currentRetryTask
    ? retryTaskClickMutation.isPending && retryTaskClickMutation.variables?.id === currentRetryTask.id
    : false
  const showRetryTaskOverlay = Boolean(rewardResult?.retryAvailable && currentRetryTask && !canSpinReward && !wheelSpinning)
  const retryExitGuardBypassRef = useRef(false)
  const retryExitGuardArmedRef = useRef(false)

  useEffect(() => {
    if (!retryExitGuardActive) {
      retryExitGuardArmedRef.current = false
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [retryExitGuardActive])

  useEffect(() => {
    if (!retryExitGuardActive) {
      retryExitGuardArmedRef.current = false
      return
    }

    if (!retryExitGuardArmedRef.current) {
      window.history.pushState({ publicSurveyRetryGuard: true }, '', window.location.href)
      retryExitGuardArmedRef.current = true
    }

    const handlePopState = () => {
      if (retryExitGuardBypassRef.current) {
        return
      }

      const shouldLeave = window.confirm('Sua nova chance ainda não foi liberada. Deseja sair mesmo assim?')

      if (shouldLeave) {
        retryExitGuardBypassRef.current = true
        window.history.back()
        window.setTimeout(() => {
          retryExitGuardBypassRef.current = false
        }, 0)
        return
      }

      window.history.pushState({ publicSurveyRetryGuard: true }, '', window.location.href)
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [retryExitGuardActive])

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
      const measureCanvas = document.createElement('canvas')
      const measureContext = measureCanvas.getContext('2d')
  
      if (!measureContext) {
        throw new Error('Não foi possível gerar a imagem do comprovante.')
      }
  
      const primaryHex = survey?.primaryColor && /^#([0-9A-Fa-f]{6})$/.test(survey.primaryColor) ? survey.primaryColor : '#0f172a'
      const pagePadding = 48
      const contentWidth = canvas.width - pagePadding * 2
      const prizeTitle = rewardResult.item || rewardResult.landedLabel || 'Prêmio confirmado'
      const congratulationsTitle = participantName ? `Parabéns, ${participantName}!` : 'Parabéns!'

      measureContext.font = '700 36px Arial'
      const congratulationsLines = wrapCanvasText(measureContext, congratulationsTitle, 760).slice(0, 2)
      measureContext.font = '900 56px Arial'
      const prizeLines = wrapCanvasText(measureContext, prizeTitle, 880).slice(0, 3)

      const addressLines = rewardPickupAddress
        ? (() => {
            measureContext.font = '500 22px Arial'
            return wrapCanvasText(measureContext, rewardPickupAddress, contentWidth - 176).slice(0, 4)
          })()
        : []

      const protocolBoxHeight = rewardResult.couponCode ? 132 : 0
      const expiryBoxHeight = rewardProofExpiresAt ? 104 : 0
      const addressBoxHeight = rewardPickupAddress ? Math.max(112, 78 + addressLines.length * 28) : 0
      const heroBottomY = 330 + congratulationsLines.length * 46 + 52 + prizeLines.length * 72
      const totalCardHeights =
        (protocolBoxHeight ? protocolBoxHeight + 18 : 0) +
        (expiryBoxHeight ? expiryBoxHeight + 18 : 0) +
        (addressBoxHeight ? addressBoxHeight + 18 : 0)
      canvas.height = Math.max(920, heroBottomY + totalCardHeights + 64)

      const context = canvas.getContext('2d')

      if (!context) {
        throw new Error('Não foi possível gerar a imagem do comprovante.')
      }
  
      // Fundo slate-50 igual à tela final
      context.fillStyle = '#f8fafc'
      context.fillRect(0, 0, canvas.width, canvas.height)
  
      let currentY = 80
  
      // Troféu em círculo branco com sombra (igual à tela)
      const trophyCircleY = currentY + 40
      context.shadowColor = 'rgba(0,0,0,0.1)'
      context.shadowBlur = 24
      context.shadowOffsetY = 8
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.arc(canvas.width / 2, trophyCircleY, 44, 0, Math.PI * 2)
      context.fill()
      context.shadowColor = 'transparent'
      context.shadowBlur = 0
      context.shadowOffsetY = 0
  
      context.fillStyle = primaryHex
      drawProofTrophyIcon(context, canvas.width / 2, trophyCircleY + 2, primaryHex)
  
      // Prêmio confirmado
      currentY = trophyCircleY + 72
      context.textAlign = 'center'
      context.fillStyle = '#64748b'
      context.font = '800 18px Arial'
      context.letterSpacing = '3px'
      context.fillText('PRÊMIO CONFIRMADO', canvas.width / 2, currentY)
      context.letterSpacing = '0px'
  
      // Parabéns
      currentY += 42
      context.fillStyle = '#0f172a'
      context.font = '700 36px Arial'
      for (const line of congratulationsLines) {
        context.fillText(line, canvas.width / 2, currentY)
        currentY += 46
      }
  
      // Você ganhou
      currentY += 6
      context.fillStyle = '#64748b'
      context.font = '500 22px Arial'
      context.fillText('Você ganhou:', canvas.width / 2, currentY)
  
      // Nome do prêmio
      currentY += 48
      context.fillStyle = '#0f172a'
      context.font = '900 56px Arial'
      for (const line of prizeLines.slice(0, 3)) {
        context.fillText(line, canvas.width / 2, currentY)
        currentY += 72
      }
  
      currentY += 18
  
      // Cards de informação (estilo igual à tela: branco, borda, sombra)
      const cardX = pagePadding
      const cardW = contentWidth
      const cardRadius = 16
  
      // Protocolo / Cupom
      if (rewardResult.couponCode) {
        const codeBoxH = 132
        context.shadowColor = 'rgba(0,0,0,0.06)'
        context.shadowBlur = 12
        context.shadowOffsetY = 4
        context.fillStyle = '#ffffff'
        fillRoundedRect(context, cardX, currentY, cardW, codeBoxH, cardRadius)
        context.shadowColor = 'transparent'
        context.shadowBlur = 0
        context.shadowOffsetY = 0
  
        // Borda
        context.strokeStyle = '#e2e8f0'
        context.lineWidth = 2
        strokeRoundedRect(context, cardX, currentY, cardW, codeBoxH, cardRadius)
  
        context.textAlign = 'center'
        context.fillStyle = '#64748b'
        context.font = '800 16px Arial'
        context.letterSpacing = '2px'
        context.fillText('PROTOCOLO / CUPOM', canvas.width / 2, currentY + 34)
        context.letterSpacing = '0px'
  
        context.fillStyle = '#0f172a'
        context.font = '900 40px Arial'
        context.fillText(rewardResult.couponCode, canvas.width / 2, currentY + 88)
  
        currentY += codeBoxH + 18
      }
  
      // Válido até
      if (rewardProofExpiresAt) {
        const infoBoxH = 104
        context.shadowColor = 'rgba(0,0,0,0.06)'
        context.shadowBlur = 12
        context.shadowOffsetY = 4
        context.fillStyle = '#ffffff'
        fillRoundedRect(context, cardX, currentY, cardW, infoBoxH, cardRadius)
        context.shadowColor = 'transparent'
        context.shadowBlur = 0
        context.shadowOffsetY = 0
  
        context.strokeStyle = '#e2e8f0'
        context.lineWidth = 2
        strokeRoundedRect(context, cardX, currentY, cardW, infoBoxH, cardRadius)
  
        // Ícone de relógio em círculo colorido
        const iconCX = cardX + 56
        const iconCY = currentY + infoBoxH / 2
        context.fillStyle = hexToRgba(primaryHex, 0.1)
        context.beginPath()
        context.arc(iconCX, iconCY, 28, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = primaryHex
        drawProofClockIcon(context, iconCX, iconCY, primaryHex)
  
        context.textAlign = 'left'
        context.fillStyle = '#64748b'
        context.font = '800 14px Arial'
        context.letterSpacing = '1.5px'
        context.fillText('VÁLIDO ATÉ', cardX + 108, currentY + 40)
        context.letterSpacing = '0px'
  
        context.fillStyle = '#0f172a'
        context.font = '700 28px Arial'
        context.fillText(formatDatePtBr(rewardProofExpiresAt), cardX + 108, currentY + 78)
  
        currentY += infoBoxH + 18
      }
  
      // Retirada
      if (rewardPickupAddress) {
        const addressBoxH = Math.max(112, 78 + addressLines.length * 28)
  
        context.shadowColor = 'rgba(0,0,0,0.06)'
        context.shadowBlur = 12
        context.shadowOffsetY = 4
        context.fillStyle = '#ffffff'
        fillRoundedRect(context, cardX, currentY, cardW, addressBoxH, cardRadius)
        context.shadowColor = 'transparent'
        context.shadowBlur = 0
        context.shadowOffsetY = 0
  
        context.strokeStyle = '#e2e8f0'
        context.lineWidth = 2
        strokeRoundedRect(context, cardX, currentY, cardW, addressBoxH, cardRadius)
  
        // Ícone de localização em círculo colorido
        const iconCX = cardX + 56
        const iconCY = currentY + 44
        context.fillStyle = hexToRgba(primaryHex, 0.1)
        context.beginPath()
        context.arc(iconCX, iconCY, 28, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = primaryHex
        context.font = '700 28px Arial'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText('📍', iconCX, iconCY + 2)
        context.textBaseline = 'alphabetic'
  
        context.textAlign = 'left'
        context.fillStyle = '#64748b'
        context.font = '800 14px Arial'
        context.letterSpacing = '1.5px'
        context.fillText('RETIRADA', cardX + 108, currentY + 38)
        context.letterSpacing = '0px'
  
        context.fillStyle = '#334155'
        context.font = '500 22px Arial'
        let addressY = currentY + 70
        for (const line of addressLines) {
          context.fillText(line, cardX + 108, addressY)
          addressY += 28
        }
  
        currentY += addressBoxH + 18
      }
  
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
    clearValidationTarget(`question:${questionId}`)
    setAnswers((current) => pruneAnswersForCurrentFlow(survey?.questions ?? [], current, questionId, value))
  }

  function toggleOption(questionId: string, value: string) {
    clearValidationTarget(`question:${questionId}`)
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
                <label
                  ref={(element) => setValidationElementRef('participant-name', element)}
                  className="grid gap-2 text-sm"
                >
                  <span className="text-slate-600">Nome completo</span>
                  <input
                    aria-label="Nome do participante"
                    className={`admin-input ${validationState?.target === 'participant-name' ? 'border-rose-400 ring-2 ring-rose-100' : ''}`}
                    value={participantName}
                    onChange={(event) => {
                      clearValidationTarget('participant-name')
                      setParticipantName(event.target.value)
                    }}
                  />
                  {validationState?.target === 'participant-name' ? (
                    <p className="text-xs font-medium text-rose-600">{validationState.message}</p>
                  ) : null}
                </label>

                <label
                  ref={(element) => setValidationElementRef('participant-phone', element)}
                  className="grid gap-2 text-sm"
                >
                  <span className="text-slate-600">Telefone com WhatsApp</span>
                  <input
                    aria-label="Telefone do participante"
                    inputMode="numeric"
                    maxLength={11}
                    className={`admin-input ${validationState?.target === 'participant-phone' ? 'border-rose-400 ring-2 ring-rose-100' : ''}`}
                    placeholder="21989988988"
                    value={participantPhone}
                    onChange={(event) => {
                      clearValidationTarget('participant-phone')
                      setParticipantPhone(sanitizePhone(event.target.value))
                    }}
                  />
                  {validationState?.target === 'participant-phone' ? (
                    <p className="text-xs font-medium text-rose-600">{validationState.message}</p>
                  ) : null}
                </label>

                <label
                  ref={(element) => setValidationElementRef('participant-email', element)}
                  className="grid gap-2 text-sm"
                >
                  <span className="text-slate-600">E-mail (opcional)</span>
                  <input
                    aria-label="E-mail do participante"
                    type="email"
                    className={`admin-input ${validationState?.target === 'participant-email' ? 'border-rose-400 ring-2 ring-rose-100' : ''}`}
                    placeholder="cliente@email.com"
                    value={participantEmail}
                    onChange={(event) => {
                      clearValidationTarget('participant-email')
                      setParticipantEmail(event.target.value)
                    }}
                  />
                  {validationState?.target === 'participant-email' ? (
                    <p className="text-xs font-medium text-rose-600">{validationState.message}</p>
                  ) : null}
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label
                    ref={(element) => setValidationElementRef('participant-birth-month', element)}
                    className="grid gap-2 text-sm"
                  >
                    <span className="text-slate-600">Mês</span>
                    <select
                      aria-label="Mês do aniversário"
                      className={`admin-select ${validationState?.target === 'participant-birth-month' ? 'border-rose-400 ring-2 ring-rose-100' : ''}`}
                      value={birthMonth}
                      onChange={(event) => {
                        clearValidationTarget('participant-birth-month')
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
                      {validationState?.target === 'participant-birth-month' ? (
                        <p className="text-xs font-medium text-rose-600">{validationState.message}</p>
                      ) : null}
                  </label>

                  <label
                    ref={(element) => setValidationElementRef('participant-birth-day', element)}
                    className="grid gap-2 text-sm"
                  >
                    <span className="text-slate-600">Dia</span>
                    <select
                      aria-label="Dia do aniversário"
                      className={`admin-select ${validationState?.target === 'participant-birth-day' ? 'border-rose-400 ring-2 ring-rose-100' : ''}`}
                      value={birthDay}
                      disabled={!birthMonth}
                      onChange={(event) => {
                        clearValidationTarget('participant-birth-day')
                        setBirthDay(event.target.value)
                      }}
                    >
                      <option value="">{birthMonth ? 'Selecione o dia' : 'Escolha o mês primeiro'}</option>
                      {Array.from({ length: getDaysInBirthMonth(Number(birthMonth)) }, (_, index) => (
                        <option key={index + 1} value={index + 1}>
                          {index + 1}
                        </option>
                      ))}
                    </select>
                      {validationState?.target === 'participant-birth-day' ? (
                        <p className="text-xs font-medium text-rose-600">{validationState.message}</p>
                      ) : null}
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
                  <section
                    key={question.id}
                    ref={(element) => setValidationElementRef(`question:${question.id}`, element)}
                    className={`border bg-white p-4 sm:p-5 ${validationState?.target === `question:${question.id}` ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'}`}
                    style={{ borderRadius: 8 }}
                  >
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
                        {validationState?.target === `question:${question.id}` ? (
                          <p className="mt-2 text-sm font-medium text-rose-600">{validationState.message}</p>
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
                    ) : question.businessMetric === 'attendant_name' && attendantSuggestions.length > 0 ? (
                      <select
                        className="admin-input w-full bg-white"
                        value={String(currentAnswer ?? '')}
                        onChange={(event) => setSingleAnswer(question.id, event.target.value)}
                      >
                        <option value="">Selecione o atendente...</option>
                        {attendantSuggestions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
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
                    {canSpinReward ? <Gift className="h-6 w-6" /> : rewardResult?.won ? <Trophy className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
                  </div>
                  <p className="mt-3 text-base font-semibold text-slate-900">
                    {canSpinReward
                      ? 'Sua vez de girar a roleta!'
                      : rewardResult?.won
                        ? 'Você ganhou um prêmio!'
                        : rewardResult
                          ? 'Você já participou desta campanha.'
                          : 'A roleta não está disponível no momento.'}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {canSpinReward
                      ? 'Toque abaixo para descobrir se ganhou.'
                      : rewardResult?.won
                        ? 'Toque abaixo para ver os detalhes do prêmio.'
                        : rewardResult
                          ? 'Obrigado por participar! Seu giro já foi registrado nesta campanha.'
                          : submitMessage || 'Sua resposta foi registrada com sucesso.'}
                  </p>
                  {(canSpinReward || rewardResult) ? (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setWheelModalOpen(true)}
                        className="admin-button-primary w-full justify-center px-6"
                        style={{ backgroundColor: survey.primaryColor || '#0f172a' }}
                      >
                        {canSpinReward ? 'Girar roleta' : rewardResult?.won ? 'Ver meu prêmio' : 'Ver resultado'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

            </section>
          )}
        </div>
      </div>

      {survey.rewardEnabled && wheelModalOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          {/* Tela final: prêmio confirmado (página inteira, sem roleta) */}
          {rewardResult?.won ? (
            <div className="winner-reveal-shell flex flex-1 flex-col bg-slate-50 p-3 animate-fade-in sm:p-5">
              <div key={celebrationKey} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
                {winnerConfettiRainPieces.map((piece, index) => (
                  <span
                    key={`winner-rain-${celebrationKey}-${index}`}
                    className="winner-confetti-rain-piece"
                    style={
                      {
                        left: piece.left,
                        top: '-6%',
                        backgroundColor: piece.color,
                        animationDelay: piece.delay,
                        animationDuration: piece.duration,
                        width: piece.width,
                        height: piece.height,
                        borderRadius: piece.radius,
                        ['--winner-confetti-drift' as string]: piece.drift,
                        ['--winner-confetti-rotate' as string]: piece.rotate,
                      } as Record<string, string>
                    }
                  />
                ))}
              </div>
              <div className="winner-reveal-card mx-auto flex h-full w-full max-w-[540px] flex-col">
                <div className="mb-3 flex items-center justify-end sm:mb-4">
                  <button
                    type="button"
                    onClick={() => setWheelModalOpen(false)}
                    className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50"
                  >
                    <X className="h-4 w-4" />
                    Fechar
                  </button>
                </div>
                <div className="flex flex-1 flex-col overflow-hidden text-center">
                  <div className="flex flex-col items-center justify-center">
                    <div
                      className="winner-trophy-pop flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-[0_8px_24px_rgba(0,0,0,0.1)] sm:h-16 sm:w-16"
                      style={{ color: survey?.primaryColor || '#0f172a' }}
                    >
                      <Trophy className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={1.5} />
                    </div>

                    <p className="winner-copy-rise mt-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500 sm:text-sm" style={{ animationDelay: '80ms' }}>Prêmio confirmado</p>
                    <p className="winner-copy-rise mt-1 text-lg font-semibold text-slate-900 sm:text-2xl" style={{ animationDelay: '130ms' }}>
                      {participantName ? `Parabéns, ${participantName}!` : 'Parabéns!'}
                    </p>

                    <div className="mt-2">
                      <p className="winner-copy-rise text-xs text-slate-500 sm:text-sm" style={{ animationDelay: '180ms' }}>Você ganhou:</p>
                      <p className="winner-prize-pop font-display text-2xl font-bold text-slate-950 sm:text-4xl" style={{ animationDelay: '220ms' }}>{rewardResult.item}</p>
                    </div>

                    {rewardInstructionText ? (
                      <p className="winner-copy-rise mx-auto mt-2 max-w-xs text-xs leading-relaxed text-slate-500 sm:text-sm" style={{ animationDelay: '280ms' }}>{rewardInstructionText}</p>
                    ) : null}
                  </div>

                  <div className="winner-copy-rise mt-4 flex w-full flex-col gap-2 sm:gap-2.5" style={{ animationDelay: '320ms' }}>
                    {rewardResult.couponCode ? (
                      <div className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm">
                        <p className="text-center text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 sm:text-xs">Protocolo / Cupom</p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="flex-1 break-all text-left text-lg font-black tracking-widest text-slate-950 sm:text-xl">{rewardResult.couponCode}</p>
                          <button
                            type="button"
                            onClick={() => void navigator.clipboard.writeText(rewardResult.couponCode ?? '')}
                            className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-95"
                            style={{ backgroundColor: survey?.primaryColor || '#0f172a' }}
                          >
                            Copiar
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {rewardProofExpiresAt ? (
                      <div className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm">
                        <div
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9"
                          style={{ backgroundColor: `${survey?.primaryColor || '#0f172a'}15` }}
                        >
                          <Clock className="h-4 w-4 sm:h-[18px] sm:w-[18px]" style={{ color: survey?.primaryColor || '#0f172a' }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:text-xs">Válido até</p>
                          <p className="text-sm font-semibold text-slate-900 sm:text-base">{formatDatePtBr(rewardProofExpiresAt)}</p>
                        </div>
                      </div>
                    ) : null}

                    {rewardPickupAddress ? (
                      <div className="flex w-full items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm">
                        <div
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9"
                          style={{ backgroundColor: `${survey?.primaryColor || '#0f172a'}15` }}
                        >
                          <MapPin className="h-4 w-4 sm:h-[18px] sm:w-[18px]" style={{ color: survey?.primaryColor || '#0f172a' }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:text-xs">Retirada</p>
                          <p className="text-xs leading-relaxed text-slate-700 sm:text-sm">{rewardPickupAddress}</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="winner-copy-rise flex w-full flex-col gap-2 pt-3 sm:gap-2.5 sm:pt-4" style={{ animationDelay: '380ms' }}>
                  {rewardContactWhatsAppUrl ? (
                    <a
                      href={rewardContactWhatsAppUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 active:scale-95"
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
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-900 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 active:scale-95"
                  >
                    <Download className="h-4 w-4" />
                    {savingRewardProof ? 'Gerando comprovante...' : 'Salvar comprovante'}
                  </button>
                </div>
              </div>
            </div>
          ) : rewardResult && !rewardResult.won && !showRetryTaskOverlay && !wheelSpinning && !canSpinReward ? (
            /* Tela final: obrigado por participar (página inteira, sem roleta) */
            <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 p-3 animate-fade-in sm:p-5">
              <div className="absolute right-3 top-3 sm:right-5 sm:top-5">
                <button
                  type="button"
                  onClick={() => setWheelModalOpen(false)}
                  className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                  Fechar
                </button>
              </div>
              <div className="w-full max-w-[420px] text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500 shadow-[0_8px_24px_rgba(15,23,42,0.12)] sm:h-16 sm:w-16">
                  <Frown className="h-7 w-7 sm:h-8 sm:w-8" />
                </div>
                <p className="mt-4 text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Não foi dessa vez</p>
                <p className="mt-2 text-base font-semibold text-slate-900 sm:text-lg">
                  Você não ganhou desta vez.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {rewardResult.message
                    ? rewardResult.message
                    : rewardResult.finalAttempt
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
              </div>
            </div>
          ) : (
            /* Roleta normal com header */
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex h-full w-full flex-col bg-white px-3 py-3 sm:px-5 sm:py-4">
                <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-100 pb-3 sm:pb-4">
                  <p className="max-w-2xl text-sm text-slate-600 sm:text-base">
                    {canSpinReward
                      ? 'Gire a roleta.'
                      : wheelSpinning
                        ? 'A roleta está girando.'
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
                        showCelebration={Boolean(rewardResult?.won && !wheelSpinning)}
                        celebrationKey={celebrationKey}
                        disabled={spinMutation.isPending || !responseId || !canSpinReward}
                        variant="fullscreen"
                        spinLabel="Girar agora"
                        disableTransition={!wheelTransitionReady}
                        onSpin={() => void spinMutation.mutateAsync()}
                      />

                      {showRetryTaskOverlay && currentRetryTask ? (
                        <div className="absolute inset-0 z-[80] flex items-center justify-center p-3 sm:p-5 animate-fade-in">
                          <div className="absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.94))] backdrop-blur-[4px]" />
                          <div className="relative w-full max-w-[min(94vw,560px)] overflow-hidden rounded-[30px] border border-sky-200/80 bg-white px-5 py-6 text-center shadow-[0_28px_90px_rgba(14,165,233,0.18)] sm:px-8 sm:py-9 animate-fade-in-scale">
                            <div className="pointer-events-none absolute inset-x-8 top-0 h-24 rounded-b-[32px] bg-[linear-gradient(180deg,rgba(56,189,248,0.16),rgba(255,255,255,0))]" />
                            <div className="pointer-events-none absolute -right-10 top-6 h-24 w-24 rounded-full bg-sky-100/70 blur-2xl" />
                            <div className="pointer-events-none absolute -left-10 bottom-10 h-24 w-24 rounded-full bg-violet-100/70 blur-2xl" />

                            <div className="relative mx-auto flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20">
                              <div className="absolute inset-0 rounded-full bg-sky-200/60 animate-ping" />
                              <div className="absolute inset-[6px] rounded-full bg-white/80" />
                              <div className="relative flex h-full w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,#e0f2fe,#ffffff_55%,#ede9fe)] text-sky-600 shadow-[0_14px_34px_rgba(14,165,233,0.22)]">
                                {currentRetryTaskReturned ? (
                                  <Sparkles className="h-8 w-8 sm:h-9 sm:w-9 animate-pulse" />
                                ) : (
                                  <PartyPopper className="h-8 w-8 sm:h-9 sm:w-9" />
                                )}
                              </div>
                            </div>

                            <div className="relative mt-4 flex items-center justify-center gap-2">
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-sky-500 animate-pulse" />
                              <p className="text-xs font-bold uppercase tracking-[0.24em] text-sky-600">Mais uma chance</p>
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-violet-500 animate-pulse" />
                            </div>

                            {!currentRetryTaskReturned ? (
                              <>
                                <p className="mt-3 text-[1.45rem] font-black leading-tight text-slate-950 sm:text-[1.9rem]">
                                  Você tem mais uma chance.
                                </p>
                                <p className="mx-auto mt-2 max-w-[28rem] text-sm leading-6 text-slate-600 sm:text-[15px]">
                                  Conclua a tarefa e volte para esta página para liberar sua nova chance.
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="mt-3 text-[1.45rem] font-black leading-tight text-slate-950 sm:text-[1.9rem]">
                                  Aguarde...
                                </p>
                                <p className="mx-auto mt-2 max-w-[25rem] text-sm leading-6 text-slate-600 sm:text-[15px]">
                                  Estamos liberando sua nova chance na roleta.
                                </p>
                              </>
                            )}

                            {!currentRetryTaskReturned ? (
                              <>
                                <div
                                  className={`mt-5 rounded-[24px] border px-5 py-5 text-left ${
                                    currentRetryTaskIsLoading
                                      ? 'border-slate-200 bg-slate-50'
                                      : `${getRetryTaskTypeColor(currentRetryTask.type).border} ${getRetryTaskTypeColor(currentRetryTask.type).bg} shadow-[0_16px_42px_rgba(15,23,42,0.08)]`
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white shadow-sm ${getRetryTaskTypeColor(currentRetryTask.type).icon}`}>
                                      {(() => {
                                        const Icon = getRetryTaskTypeIcon(currentRetryTask.type)
                                        return <Icon className="h-5 w-5" />
                                      })()}
                                    </div>
                                    <div className="flex-1">
                                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Tarefa atual</p>
                                      <p className="mt-1 text-lg font-black leading-tight text-slate-950 sm:text-[1.35rem]">{currentRetryTask.title}</p>
                                      <p className={`mt-1 text-xs font-semibold uppercase tracking-[0.16em] ${getRetryTaskTypeColor(currentRetryTask.type).text}`}>
                                        {getRetryTaskTypeLabel(currentRetryTask.type)}
                                      </p>
                                      <p className="mt-3 text-sm leading-6 text-slate-600">
                                        Depois de concluir, volte para esta página. Sem voltar, a roleta não será liberada.
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="mt-6">
                                <div className="relative mx-auto flex h-40 w-40 items-center justify-center sm:h-44 sm:w-44">
                                  <div className="absolute inset-0 rounded-full border border-sky-200/80 bg-[radial-gradient(circle,_rgba(255,255,255,1)_38%,rgba(224,242,254,0.88)_100%)] shadow-[0_18px_44px_rgba(14,165,233,0.16)]" />
                                  <div className="absolute inset-3 rounded-full border border-sky-200/80" />
                                  <div className="absolute inset-6 rounded-full border border-dashed border-violet-300 animate-spin [animation-duration:8s]" />
                                  <div className="absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-sky-500 shadow-[0_0_16px_rgba(14,165,233,0.5)]" />
                                  <div className="relative flex flex-col items-center justify-center">
                                    {currentRetryTaskReadyToUnlock ? (
                                      <>
                                        <Loader2 className="h-12 w-12 animate-spin text-sky-600 sm:h-14 sm:w-14" />
                                        <span className="mt-3 text-[11px] font-bold uppercase tracking-[0.24em] text-sky-700">
                                          liberando
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-[3.2rem] font-black leading-none text-slate-950 sm:text-[3.6rem]">
                                          {currentRetryTaskCountdownValue}
                                        </span>
                                        <span className="mt-1 text-[11px] font-bold uppercase tracking-[0.24em] text-sky-700">
                                          segundos
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <p className="mt-5 text-base font-black text-slate-950 sm:text-lg">
                                  {currentRetryTaskReadyToUnlock ? 'Estamos liberando sua roleta.' : 'Sua roleta será liberada em instantes.'}
                                </p>
                                <p className="mx-auto mt-2 max-w-[24rem] text-sm leading-6 text-slate-600">
                                  {currentRetryTaskReadyToUnlock
                                    ? 'Sua tarefa já foi reconhecida. Se demorar mais que o normal, você pode liberar manualmente no botão abaixo.'
                                    : 'Continue nesta tela. Quando a contagem terminar, sua nova chance será ativada automaticamente.'}
                                </p>
                              </div>
                            )}

                            <div className="mt-5 flex items-center justify-center">
                              <button
                                type="button"
                                disabled={currentRetryTaskIsLoading || (!currentRetryTaskReturned && Boolean(currentRetryTaskProgress))}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  if (currentRetryTaskReturned && currentRetryTaskCanConfirm) {
                                    autoConfirmTriggeredRef.current[currentRetryTask.id] = true
                                    void retryTaskClickMutation.mutateAsync(currentRetryTask)
                                    return
                                  }
                                  if (currentRetryTaskProgress) {
                                    openRetryTaskLink(currentRetryTask)
                                    return
                                  }
                                  startRetryTask(currentRetryTask)
                                }}
                                className={`inline-flex items-center justify-center gap-2 rounded-[16px] px-6 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                  currentRetryTaskReturned
                                    ? 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-sky-300 hover:text-sky-700'
                                    : 'bg-[linear-gradient(135deg,#0ea5e9,#2563eb)] text-white shadow-[0_16px_34px_rgba(37,99,235,0.28)] hover:-translate-y-0.5 hover:shadow-[0_20px_40px_rgba(37,99,235,0.34)]'
                                }`}
                              >
                                <ExternalLink className="h-4 w-4" />
                                {currentRetryTaskIsLoading
                                  ? 'Liberando roleta...'
                                  : currentRetryTaskReadyToUnlock
                                    ? 'Liberar roleta'
                                    : currentRetryTaskReturned
                                      ? 'Ir para a tarefa novamente'
                                      : currentRetryTaskProgress
                                        ? 'Reabrir tarefa'
                                        : 'Ir para a tarefa'}
                              </button>
                            </div>
                            {!currentRetryTaskReturned ? (
                              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Volte para esta página depois de concluir a tarefa.
                              </p>
                            ) : null}
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
          )}
        </div>
      ) : null}
    </div>
  )
}
