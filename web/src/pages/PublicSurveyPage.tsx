import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, Gift, Meh, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { PrizeWheel, getSegmentTargetRotation, type PrizeWheelSegment } from '@/components/public/PrizeWheel'
import { apiRequest } from '@/lib/api-client'
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
  'Não foi dessa vez',
  'Quase!',
  'Obrigado por participar.',
  'Boa sorte na próxima',
  'Você não teve sorte',
  'Continue participando',
]

const previewWinMessages = [
  'Resultado de teste: este prêmio foi liberado apenas para você validar o visual.',
  'Simulação concluída. Use este cenário para revisar cupom, texto e resgate.',
]

const previewNoPrizeMessages = [
  'Resultado de teste: cenário sem prêmio para revisar a mensagem final.',
  'Simulação concluída sem prêmio. Assim você valida o fluxo de derrota antes de publicar.',
]

type RewardRetryTask = {
  id: string
  type: 'google_review' | 'instagram_follow' | 'custom_link'
  title: string
  url: string
}

type SurveyAnswerMap = Record<string, string | string[] | number>

function buildVisibleQuestionSet(questions: SurveyQuestion[], answers: SurveyAnswerMap) {
  return new Set(getVisibleSurveyQuestions(questions, answers).map((question) => question.id))
}

function pruneAnswersForCurrentFlow(
  questions: SurveyQuestion[],
  currentAnswers: SurveyAnswerMap,
  sourceQuestionId: string,
  nextValue: string | number,
) {
  const nextAnswers = { ...currentAnswers, [sourceQuestionId]: nextValue }
  const questionsById = new Map(questions.map((question) => [question.id, question]))
  const orderedQuestions = [...questions]
  const sourceIndex = orderedQuestions.findIndex((question) => question.id === sourceQuestionId)
  const sourceQuestion = questionsById.get(sourceQuestionId)
  const previousVisibleIds = buildVisibleQuestionSet(questions, currentAnswers)
  const nextVisibleIds = buildVisibleQuestionSet(questions, nextAnswers)

  if (sourceIndex < 0 || !sourceQuestion) {
    return nextAnswers
  }

  const normalizedValue = typeof nextValue === 'string' ? nextValue.trim() : ''
  const nextTarget =
    typeof nextValue === 'string' && normalizedValue
      ? sourceQuestion.flowRules?.find((rule) => rule.value === normalizedValue)?.nextQuestionId ?? null
      : null

  const branchStartQuestionId =
    nextTarget && nextTarget !== FLOW_END
      ? nextTarget
      : orderedQuestions[sourceIndex + 1]?.id

  const blockedQuestionIds = new Set<string>()
  let shouldCollect = false

  for (const question of orderedQuestions) {
    if (question.id === branchStartQuestionId) {
      shouldCollect = true
    }

    if (!shouldCollect) {
      continue
    }

    if (!nextVisibleIds.has(question.id) && previousVisibleIds.has(question.id)) {
      blockedQuestionIds.add(question.id)
    }
  }

  if (!blockedQuestionIds.size) {
    return nextAnswers
  }

  const cleanedAnswers = { ...nextAnswers }

  for (const questionId of blockedQuestionIds) {
    delete cleanedAnswers[questionId]
  }

  return cleanedAnswers
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

function pickRandomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function buildPrizeWheelSegments(items: Array<{ id: string; title: string }>) {
  const rewardItems = items.slice(0, 3)
  const neutralSlots = Math.max(0, 6 - rewardItems.length)
  const segments: PrizeWheelSegment[] = rewardItems.map((item) => ({
    id: item.id,
    label: item.title,
    kind: 'reward',
  }))

  for (let index = 0; index < neutralSlots; index += 1) {
    segments.push({
      id: `neutral-${index}`,
      label: neutralWheelLabels[index % neutralWheelLabels.length],
      kind: 'neutral',
    })
  }

  return segments.length
    ? segments
    : neutralWheelLabels.map((label, index) => ({
        id: `neutral-${index}`,
        label,
        kind: 'neutral' as const,
      }))
}

export function PublicSurveyPage() {
  const { slug, id } = useParams()
  const previewMode = Boolean(id)
  const [searchParams] = useSearchParams()
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
  const [rewardResult, setRewardResult] = useState<{
    won: boolean
    item?: string
    landedLabel?: string
    couponCode?: string
    pickupAddress?: string
    retryAvailable?: boolean
    retryUnlocked?: boolean
    retryTasks?: RewardRetryTask[]
    completedTaskIds?: string[]
    message?: string
  } | null>(null)
  const [eligibilityMessage, setEligibilityMessage] = useState('')
  const [wheelRotation, setWheelRotation] = useState(0)
  const [wheelSpinning, setWheelSpinning] = useState(false)
  const [activeWheelSegmentId, setActiveWheelSegmentId] = useState('')
  const [completedRetryTaskIds, setCompletedRetryTaskIds] = useState<string[]>([])
  const [celebrationKey, setCelebrationKey] = useState(0)
  const [wheelModalOpen, setWheelModalOpen] = useState(false)
  const [savingRewardProof, setSavingRewardProof] = useState(false)
  const trackedVisitKeyRef = useRef('')
  const spinTimeoutRef = useRef<number | null>(null)
  const rewardProofRef = useRef<HTMLDivElement | null>(null)
  const source = searchParams.get('src')
  const trackedSource: SurveyShareSource | null = source === 'link' || source === 'qr' ? source : null

  const surveyQuery = useQuery({
    queryKey: ['public-survey', previewMode ? id : slug, previewMode ? 'preview' : 'public'],
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
      }>(previewMode ? `/surveys/${id}/preview` : `/public/surveys/${slug}`)

      return mapApiSurvey({
        ...response.survey,
        slug: response.survey.slug ?? slug ?? `preview-${id ?? 'sem-slug'}`,
        status: response.survey.status ?? 'published',
      })
    },
    enabled: Boolean(previewMode ? id : slug),
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
  const canCloseWheelModal = !wheelSpinning && Boolean(rewardResult)

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
            ? 'Modo teste: sua resposta não foi salva. Agora você pode validar a roleta com um giro simulado.'
            : 'Modo teste: sua resposta não foi salva nem enviada para relatórios.',
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
        const shouldWin = rewardSegments.length > 0 && Math.random() < 0.45
        const selectedSegment = shouldWin
          ? pickRandomItem(rewardSegments)
          : pickRandomItem(neutralSegments.length ? neutralSegments : wheelSegments)

        return {
          won: shouldWin,
          item: shouldWin ? selectedSegment.label : undefined,
          landedLabel: selectedSegment.label,
          couponCode: shouldWin ? `TESTE-${Math.random().toString(36).slice(2, 8).toUpperCase()}` : undefined,
          retryAvailable: !shouldWin && Boolean(survey.rewardRetryUnlockEnabled && (survey.rewardRetryTasks?.length ?? 0) > 0),
          retryUnlocked: false,
          retryTasks: survey.rewardRetryTasks ?? [],
          completedTaskIds: [],
          message: shouldWin ? pickRandomItem(previewWinMessages) : pickRandomItem(previewNoPrizeMessages),
        }
      }

      return apiRequest<{
        won: boolean
        item?: string
        landedLabel?: string
        couponCode?: string
        pickupAddress?: string
        retryAvailable?: boolean
        retryUnlocked?: boolean
        retryTasks?: RewardRetryTask[]
        completedTaskIds?: string[]
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

      const openedWindow = window.open(task.url, '_blank', 'noopener,noreferrer')

      if (previewMode) {
        if (!openedWindow) {
          window.location.href = task.url
        }

        const currentCompletedTaskIds = rewardResult?.completedTaskIds ?? completedRetryTaskIds
        const nextCompletedTaskIds = Array.from(new Set([...currentCompletedTaskIds, task.id]))

        return {
          ok: true,
          unlocked: nextCompletedTaskIds.length >= (survey.rewardRetryTasks?.length ?? 0),
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

      if (!openedWindow) {
        window.location.href = task.url
      }

      return result
    },
    onSuccess: (result) => {
      setCompletedRetryTaskIds(result.completedTaskIds)
      setCanSpinReward(result.unlocked)
      setRewardResult((current) =>
        current
          ? {
              ...current,
              retryUnlocked: result.unlocked,
              completedTaskIds: result.completedTaskIds,
              message: result.unlocked
                ? 'As tarefas foram registradas. Sua chance extra já está liberada.'
                : current.message,
            }
          : current,
      )
    },
  })

  async function handleDownloadRewardProof() {
    if (!rewardResult?.won || !rewardProofRef.current) {
      return
    }

    setSavingRewardProof(true)

    try {
      const proofNode = rewardProofRef.current
      const clonedNode = proofNode.cloneNode(true) as HTMLElement

      clonedNode.style.position = 'fixed'
      clonedNode.style.left = '-99999px'
      clonedNode.style.top = '0'
      clonedNode.style.width = '1080px'
      clonedNode.style.maxWidth = '1080px'
      clonedNode.style.transform = 'none'
      clonedNode.style.zIndex = '-1'
      document.body.appendChild(clonedNode)

      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${Math.ceil(clonedNode.getBoundingClientRect().height)}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml" style="width:1080px;height:100%;">
              ${new XMLSerializer().serializeToString(clonedNode)}
            </div>
          </foreignObject>
        </svg>
      `

      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const image = new Image()

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Não foi possível preparar o comprovante do prêmio.'))
        image.src = url
      })

      const canvas = document.createElement('canvas')
      canvas.width = 1080
      canvas.height = Math.ceil(clonedNode.getBoundingClientRect().height)
      const context = canvas.getContext('2d')

      if (!context) {
        throw new Error('Não foi possível gerar a imagem do comprovante.')
      }

      context.drawImage(image, 0, 0)
      URL.revokeObjectURL(url)
      document.body.removeChild(clonedNode)

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

      return {
        ...current,
        [questionId]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
      }
    })
  }

  if (surveyQuery.isLoading) {
    return (
      <div className="min-h-screen px-4 py-6" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)' }}>
        <div className="mx-auto max-w-4xl border border-slate-200 bg-white p-10 text-center shadow-card" style={{ borderRadius: 6 }}>
          <p className="text-sm text-slate-500">Carregando pesquisa...</p>
        </div>
      </div>
    )
  }

  if (surveyQuery.isError || !survey) {
    return (
      <div className="min-h-screen px-4 py-6" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)' }}>
        <div className="mx-auto max-w-4xl border border-slate-200 bg-white p-10 text-center shadow-card" style={{ borderRadius: 6 }}>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Pesquisa indisponível</p>
          <h1 className="mt-4 font-display text-4xl text-slate-950">Não foi possível abrir esta pesquisa agora</h1>
          <p className="mt-4 text-sm text-slate-600">Verifique se o link está correto ou tente novamente mais tarde.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: `linear-gradient(180deg, ${survey.primaryColor}12 0%, #f8fafc 24%, #e2e8f0 100%)` }}>
      <div className="mx-auto max-w-4xl">
        <div className="border border-slate-200 bg-white p-6 shadow-card lg:p-8" style={{ borderRadius: 6 }}>
          {previewMode ? (
            <div className="mb-6 flex flex-col gap-3 border border-sky-200 bg-sky-50 px-4 py-4 text-sky-950 sm:flex-row sm:items-center sm:justify-between" style={{ borderRadius: 6 }}>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-sky-700">Modo teste</p>
                <p className="mt-1 text-sm">
                  Nada do que acontecer aqui será salvo em respostas, relatórios ou prêmios reais.
                </p>
              </div>
              <Link to={`/app/pesquisas/${id}/editar`} className="admin-button self-start">
                Voltar para o editor
              </Link>
            </div>
          ) : null}

          <header className="border-b border-slate-200 pb-5">
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
              <Sparkles className="h-4 w-4" />
              {previewMode ? 'Prévia de teste' : 'Pesquisa publicada'}
            </p>
            <h1 className="mt-3 font-display text-4xl text-slate-950 lg:text-5xl">{survey.title}</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-600 lg:text-base">
              {survey.description || (previewMode ? 'Use esta tela para testar a experiência antes de publicar.' : 'Responda os campos abaixo para concluir sua participação.')}
            </p>
          </header>

          {eligibilityMessage && !submitted ? (
            <div className="admin-alert mt-6 border-amber-200 bg-amber-50 text-amber-900">{eligibilityMessage}</div>
          ) : null}

          {!submitted ? (
            <form
              className="mt-6 space-y-5"
              onSubmit={(event) => {
                event.preventDefault()
                void submitMutation.mutateAsync()
              }}
            >
              <section className="admin-panel grid gap-4 p-5 md:grid-cols-2">
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
                  <section key={question.id} className="border border-slate-200 bg-white p-5" style={{ borderRadius: 6 }}>
                    <div className="mb-4 flex items-start justify-between gap-3">
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
                      <div className="grid gap-3 md:grid-cols-2">
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
                      <div className="grid gap-3 md:grid-cols-2">
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
                        <div className="grid gap-3 md:grid-cols-3">
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

                        <div className="grid grid-cols-2 gap-3 md:grid-cols-6 xl:grid-cols-11">
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
                  {previewMode ? 'Teste protegido' : 'Controle da campanha por identificadores'}
                </div>
                <p className="mt-2">
                  {previewMode
                    ? 'Este modo ignora regras de duplicidade, não grava participação e serve apenas para validar a experiência da pesquisa.'
                    : 'A pesquisa pode continuar recebendo respostas, mas a roleta só fica disponível uma vez por campanha para o mesmo cliente usando o mesmo WhatsApp ou e-mail.'}
                </p>
              </div>

              <button type="submit" disabled={submitMutation.isPending} className="admin-button-primary w-full justify-center">
                {submitMutation.isPending ? (previewMode ? 'Preparando teste...' : 'Enviando...') : previewMode ? 'Testar pesquisa' : 'Enviar respostas'}
              </button>
            </form>
          ) : (
            <section className="admin-panel mt-6 p-6 text-center">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{previewMode ? 'Teste concluído' : 'Pesquisa finalizada'}</p>
              <h2 className="mt-3 font-display text-4xl text-slate-950">{previewMode ? 'Prévia validada' : 'Obrigado por participar'}</h2>
              <p className="mt-4 text-sm text-slate-600">
                {submitMessage || (previewMode ? 'Este teste foi executado apenas para validar a experiência da pesquisa.' : 'Sua resposta foi registrada com sucesso e já pode alimentar os relatórios do painel.')}
              </p>

              {survey.rewardEnabled ? (
                <div className="mt-6 border border-slate-200 bg-slate-950 p-5 text-white" style={{ borderRadius: 6 }}>
                  <div className="flex items-center justify-center gap-2 font-semibold">
                    <Gift className="h-5 w-5" />
                    Roleta de prêmios
                  </div>

                  {showWheelArea ? (
                    <>
                      <p className="mt-2 text-sm text-slate-300">
                        {canSpinReward
                          ? previewMode
                            ? 'No modo teste, o giro é simulado para você revisar visual, cupom e mensagens.'
                            : 'O resultado já será decidido no servidor assim que você girar. A animação abaixo apenas revela esse resultado.'
                          : previewMode
                            ? 'O teste já foi processado. Confira abaixo o resultado simulado deste giro.'
                            : 'A participação já foi processada. Confira abaixo o resultado registrado para este giro.'}
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
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Cupom do prêmio</p>
                              <p className="mt-2 text-lg font-semibold text-white">{rewardResult.couponCode}</p>
                            </div>
                            <div className="flex justify-center">
                              <button
                                type="button"
                                onClick={() => void handleDownloadRewardProof()}
                                disabled={savingRewardProof}
                                className="admin-button-primary"
                              >
                                <Download className="h-4 w-4" />
                                {savingRewardProof ? 'Gerando comprovante...' : 'Salvar comprovante do prêmio'}
                              </button>
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
                                    Clique em todas as tarefas abaixo para liberar o segundo giro.
                                  </p>
                                </div>

                                <div className="space-y-3">
                                  {retryTasks.map((task) => {
                                    const completed = completedRetryTaskIds.includes(task.id)
                                    const isLoading =
                                      retryTaskClickMutation.isPending && retryTaskClickMutation.variables?.id === task.id

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
                                                : 'border-white/15 bg-white/10 text-white'
                                            }`}
                                          >
                                            {completed ? 'Clicado' : 'Pendente'}
                                          </span>
                                          <button
                                            type="button"
                                            disabled={completed || isLoading}
                                            onClick={() => void retryTaskClickMutation.mutateAsync(task)}
                                            className="admin-button-primary disabled:opacity-60"
                                          >
                                            {completed ? 'Registrado' : isLoading ? 'Abrindo...' : 'Ir para a tarefa'}
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
                    Testar novamente
                  </button>
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>

      {survey.rewardEnabled && wheelModalOpen ? (
        <div className="fixed inset-0 z-50 bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.22)_0%,rgba(15,23,42,0.92)_36%,rgba(2,6,23,0.98)_100%)]">
          <div className="absolute inset-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col justify-between rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.94)_0%,rgba(3,7,18,0.98)_100%)] p-4 shadow-[0_30px_100px_rgba(2,6,23,0.65)] sm:p-6 lg:p-8">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <p className="text-xs uppercase tracking-[0.28em] text-amber-200/80">Momento do prêmio</p>
                  <h2 className="mt-3 font-display text-3xl text-white sm:text-4xl lg:text-5xl">Roleta premium em tela cheia</h2>
                  <p className="mt-3 text-sm text-slate-300 sm:text-base">
                    {canSpinReward
                      ? previewMode
                        ? 'Toque em girar para validar a roleta em um cenário de teste, sem afetar nenhuma participação real.'
                        : 'Toque em girar para revelar o resultado desta campanha com destaque total.'
                      : wheelSpinning
                        ? 'A roleta está girando e o resultado está sendo revelado agora.'
                        : rewardResult?.won
                          ? 'Seu prêmio já foi confirmado. Você pode salvar o comprovante antes de fechar.'
                          : 'O resultado deste giro já foi registrado. Confira a mensagem final abaixo.'}
                  </p>
                </div>

                <div className="flex items-center gap-3 self-start">
                  {canCloseWheelModal ? (
                    <button type="button" onClick={() => setWheelModalOpen(false)} className="admin-button px-4 py-3 text-white">
                      <X className="h-4 w-4" />
                      Fechar
                    </button>
                  ) : (
                    <div className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                      Fechamento liberado ao final
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.4)_0%,rgba(15,23,42,0.12)_100%)] px-3 py-6 sm:px-6 sm:py-8">
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
                </div>

                <div className="space-y-4">
                  {!rewardResult ? (
                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-5 text-center">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Status da roleta</p>
                      <p className="mt-3 text-lg font-semibold text-white">
                        {wheelSpinning ? 'A sorte está girando...' : canSpinReward ? 'Pronta para girar' : 'Aguardando resultado'}
                      </p>
                      <p className="mt-2 text-sm text-slate-300">
                        {wheelSpinning
                          ? 'Segure esse momento. O resultado já está sendo revelado.'
                          : previewMode
                            ? 'Quando você tocar em girar, um resultado simulado será mostrado aqui para revisão.'
                            : 'Quando você tocar em girar, o resultado salvo no servidor será mostrado aqui.'}
                      </p>
                    </div>
                  ) : rewardResult.won ? (
                    <div ref={rewardProofRef} className="rounded-[24px] border border-amber-300/25 bg-[linear-gradient(180deg,rgba(250,204,21,0.22)_0%,rgba(236,72,153,0.16)_52%,rgba(15,23,42,0.96)_100%)] p-5 shadow-[0_22px_70px_rgba(250,204,21,0.14)]">
                      <p className="text-xs uppercase tracking-[0.24em] text-amber-100">Comprovante do prêmio</p>
                      <p className="mt-3 text-sm font-semibold text-emerald-100">Parabéns, {participantName || 'participante'}!</p>
                      <p className="mt-3 font-display text-3xl leading-tight text-white sm:text-4xl">{rewardResult.item}</p>
                      {rewardResult.couponCode ? (
                        <div className="mt-5 rounded-[18px] border border-white/15 bg-slate-950/35 px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Cupom</p>
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
                          {savingRewardProof ? 'Gerando imagem...' : 'Salvar comprovante em imagem'}
                        </button>
                        <p className="text-center text-xs text-slate-300">
                          {previewMode ? 'Use essa imagem para validar o layout do comprovante antes da publicação.' : 'Salve no celular para apresentar no resgate do prêmio.'}
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
                      {rewardResult.retryAvailable ? (
                        <p className="mt-3 text-sm text-slate-300">Conclua as tarefas abaixo na página para liberar a chance extra.</p>
                      ) : null}
                    </div>
                  )}

                  {rewardResult?.retryAvailable ? (
                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-5 text-left">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Mais uma chance</p>
                      <div className="mt-4 space-y-3">
                        {retryTasks.map((task) => {
                          const completed = completedRetryTaskIds.includes(task.id)
                          const isLoading = retryTaskClickMutation.isPending && retryTaskClickMutation.variables?.id === task.id

                          return (
                            <div
                              key={task.id}
                              className="flex flex-col gap-3 rounded-[18px] border border-white/10 bg-slate-950/30 px-4 py-4"
                            >
                              <div>
                                <p className="text-sm font-semibold text-white">{task.title}</p>
                                <p className="mt-1 text-xs text-slate-400">
                                  {task.type === 'google_review'
                                    ? 'Google'
                                    : task.type === 'instagram_follow'
                                      ? 'Instagram'
                                      : 'Link personalizado'}
                                </p>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span
                                  className={`admin-badge ${
                                    completed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-white/15 bg-white/10 text-white'
                                  }`}
                                >
                                  {completed ? 'Clicado' : 'Pendente'}
                                </span>
                                <button
                                  type="button"
                                  disabled={completed || isLoading}
                                  onClick={() => void retryTaskClickMutation.mutateAsync(task)}
                                  className="admin-button-primary disabled:opacity-60"
                                >
                                  {completed ? 'Registrado' : isLoading ? 'Abrindo...' : 'Ir para a tarefa'}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
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
