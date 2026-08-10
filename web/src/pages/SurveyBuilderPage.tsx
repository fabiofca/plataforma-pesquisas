import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Download,
  FileImage,
  Palette,
  Share2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { SurveyNavBar } from '@/components/surveys/SurveyNavBar'
import { SurveyVisualFlowEditor } from '@/components/surveys/SurveyVisualFlowEditor'
import { AdminModal } from '@/components/ui/AdminModal'
import { SectionCard } from '@/components/ui/SectionCard'
import { apiRequest, uploadApiFile } from '@/lib/api-client'

function downloadJsonFile(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result as string))
      } catch {
        reject(new Error('Arquivo JSON inválido.'))
      }
    }
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
    reader.readAsText(file)
  })
}
import { mapApiSurvey } from '@/lib/mappers'
import { getSurveyTestPath } from '@/lib/public-survey'
import { FLOW_ON_ANSWER } from '@/lib/survey-flow'
import { mergeFlowLayout, sortIdsByFlowLayout } from '@/lib/survey-visual-flow'
import type { BusinessMetric, QuestionType, SurveyBuilderMode, SurveyFlowLayout, SurveyItem, SurveyQuestionFlowRule } from '@/types/domain'

type BuilderQuestion = {
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

type BuilderState = {
  title: string
  description: string
  slug: string
  brandName: string
  logoUrl: string
  primaryColor: string
  bannerUrl: string
  closingMessage: string
  participationMode: 'anonymous' | 'identified'
  rewardEnabled: boolean
  preventDuplicateResponses: boolean
  duplicateResponseCooldownDays: number
  allowMultipleResponses: boolean
  builderMode: SurveyBuilderMode
  flowLayout: SurveyFlowLayout
  questions: BuilderQuestion[]
}

type FlowDraftState = Pick<BuilderState, 'questions' | 'flowLayout'>
type BuilderDraftState = Pick<
  BuilderState,
  | 'title'
  | 'description'
  | 'slug'
  | 'brandName'
  | 'logoUrl'
  | 'primaryColor'
  | 'bannerUrl'
  | 'closingMessage'
  | 'rewardEnabled'
  | 'preventDuplicateResponses'
  | 'duplicateResponseCooldownDays'
  | 'allowMultipleResponses'
  | 'questions'
  | 'flowLayout'
>

const surveyColorPresets = ['#0b5cff', '#11284a', '#0f766e', '#7c3aed', '#d97706', '#dc2626']

type SurveyUploadTarget = 'logo' | 'banner'

function makeQuestion(type: QuestionType = 'short_text'): BuilderQuestion {
  return {
    id: crypto.randomUUID(),
    title: '',
    description: '',
    type,
    required: false,
    options: type === 'single_choice' || type === 'multiple_choice' ? [''] : [],
    flowRules: [],
  }
}

function removeRulesThatPointToQuestion(flowRules: SurveyQuestionFlowRule[], targetQuestionId: string) {
  return flowRules.filter((rule) => rule.nextQuestionId !== targetQuestionId)
}

function getBrandInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)

  if (!parts.length) {
    return 'MR'
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('')
}

function makeEmptyBuilderState(): BuilderState {
  const initialQuestions = [makeQuestion()]
  return {
    title: '',
    description: '',
    slug: '',
    brandName: 'Minha marca',
    logoUrl: '',
    primaryColor: '#0b5cff',
    bannerUrl: '',
    closingMessage: 'Obrigado por participar. Sua resposta foi registrada com sucesso.',
    participationMode: 'identified',
    rewardEnabled: false,
    preventDuplicateResponses: true,
    duplicateResponseCooldownDays: 15,
    allowMultipleResponses: true,
    builderMode: 'visual',
    flowLayout: mergeFlowLayout(initialQuestions.map((question) => question.id), { version: 1, nodes: [] }),
    questions: initialQuestions,
  }
}

function extractFlowDraft(state: Pick<BuilderState, 'questions' | 'flowLayout'>): FlowDraftState {
  return {
    questions: state.questions.map((question) => ({
      ...question,
      options: [...question.options],
      flowRules: question.flowRules.map((rule) => ({ ...rule })),
    })),
    flowLayout: {
      ...state.flowLayout,
      nodes: state.flowLayout.nodes.map((node) => ({ ...node })),
      viewport: state.flowLayout.viewport ? { ...state.flowLayout.viewport } : undefined,
    },
  }
}

function extractBuilderDraft(state: BuilderState): BuilderDraftState {
  return {
    title: state.title,
    description: state.description,
    slug: state.slug,
    brandName: state.brandName,
    logoUrl: state.logoUrl,
    primaryColor: state.primaryColor,
    bannerUrl: state.bannerUrl,
    closingMessage: state.closingMessage,
    rewardEnabled: state.rewardEnabled,
    preventDuplicateResponses: state.preventDuplicateResponses,
    duplicateResponseCooldownDays: state.duplicateResponseCooldownDays,
    allowMultipleResponses: state.allowMultipleResponses,
    questions: state.questions.map((question) => ({
      ...question,
      options: [...question.options],
      flowRules: question.flowRules.map((rule) => ({ ...rule })),
    })),
    flowLayout: {
      ...state.flowLayout,
      nodes: state.flowLayout.nodes.map((node) => ({ ...node })),
      viewport: state.flowLayout.viewport ? { ...state.flowLayout.viewport } : undefined,
    },
  }
}

function normalizeFlowDraft(state: FlowDraftState): FlowDraftState {
  const normalizedLayout = mergeFlowLayout(
    state.questions.map((question) => question.id),
    state.flowLayout,
  )

  return {
    questions: [...state.questions]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((question) => ({
        ...question,
        options: [...question.options],
        flowRules: [...question.flowRules].sort(
          (left, right) =>
            left.value.localeCompare(right.value) || left.nextQuestionId.localeCompare(right.nextQuestionId),
        ),
      })),
    flowLayout: {
      ...normalizedLayout,
      nodes: [...normalizedLayout.nodes].sort((left, right) => left.id.localeCompare(right.id)),
      viewport: normalizedLayout.viewport ? { ...normalizedLayout.viewport } : undefined,
    },
  }
}

function getFlowDraftSignature(state: FlowDraftState) {
  return JSON.stringify(normalizeFlowDraft(state))
}

function normalizeBuilderDraft(state: BuilderDraftState): BuilderDraftState {
  const normalizedLayout = mergeFlowLayout(
    state.questions.map((question) => question.id),
    state.flowLayout,
  )

  return {
    ...state,
    questions: state.questions.map((question) => ({
      ...question,
      options: [...question.options],
      flowRules: question.flowRules.map((rule) => ({ ...rule })),
    })),
    flowLayout: {
      ...normalizedLayout,
      nodes: [...normalizedLayout.nodes].sort((left, right) => left.id.localeCompare(right.id)),
      viewport: normalizedLayout.viewport ? { ...normalizedLayout.viewport } : undefined,
    },
  }
}

function getBuilderDraftSignature(state: BuilderDraftState) {
  return JSON.stringify(normalizeBuilderDraft(state))
}

function mapSurveyToBuilderState(survey: SurveyItem): BuilderState {
  const questions = survey.questions.length
    ? survey.questions.map((question) => ({
        id: question.id,
        title: question.title,
        description: question.description ?? '',
        type: question.type,
        required: question.required,
        options: question.options?.length ? question.options : [],
        flowRules: question.flowRules ?? [],
        businessMetric: question.businessMetric ?? null,
        linkedQuestionId: question.linkedQuestionId ?? null,
      }))
    : [makeQuestion()]

  return {
    title: survey.title,
    description: survey.description ?? '',
    slug: survey.slug,
    brandName: survey.brandName ?? 'Minha marca',
    logoUrl: survey.logoUrl ?? '',
    primaryColor: survey.primaryColor,
    bannerUrl: survey.bannerUrl ?? '',
    closingMessage: survey.closingMessage ?? 'Obrigado por participar. Sua resposta foi registrada com sucesso.',
    participationMode: 'identified',
    rewardEnabled: survey.rewardEnabled,
    preventDuplicateResponses: survey.preventDuplicateResponses ?? true,
    duplicateResponseCooldownDays: survey.duplicateResponseCooldownDays ?? 15,
    allowMultipleResponses: survey.allowMultipleResponses ?? true,
    builderMode: 'visual',
    flowLayout: mergeFlowLayout(
      questions.map((question) => question.id),
      survey.flowLayout ?? { version: 1, nodes: [] },
    ),
    questions,
  }
}

export function SurveyBuilderPage() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const isEditing = Boolean(params.id)
  const [form, setForm] = useState<BuilderState>(makeEmptyBuilderState)
  const [savedFlowSnapshot, setSavedFlowSnapshot] = useState<FlowDraftState | null>(null)
  const [savedBuilderSnapshot, setSavedBuilderSnapshot] = useState<BuilderDraftState | null>(null)
  const [selectedVisualQuestionId, setSelectedVisualQuestionId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [centeredFeedback, setCenteredFeedback] = useState<{ message: string; key: number } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [uploadingKey, setUploadingKey] = useState<SurveyUploadTarget | ''>('')
  const [removingKey, setRemovingKey] = useState<SurveyUploadTarget | ''>('')
  const [uploadErrors, setUploadErrors] = useState<Record<SurveyUploadTarget, string>>({
    logo: '',
    banner: '',
  })
  const [uploadInputVersion, setUploadInputVersion] = useState<Record<SurveyUploadTarget, number>>({
    logo: 0,
    banner: 0,
  })
  const centeredFeedbackTimeoutRef = useRef<number | null>(null)

  const surveyQuery = useQuery({
    queryKey: ['survey', params.id],
    queryFn: async () => {
      const response = await apiRequest<{
        survey: {
          id: string
          title: string
          description?: string | null
          slug: string | null
          participation_mode: string
          brand_name?: string
          logo_url?: string | null
          primary_color: string
          banner_url?: string | null
          closing_message?: string | null
          reward_enabled: boolean
          builder_mode?: SurveyBuilderMode
          flow_json?: SurveyFlowLayout | null
          prevent_duplicate_responses: boolean
          duplicate_response_cooldown_days: number
          allow_multiple_responses: boolean
          link_clicks: string
          qr_scans: string
          status: string
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
      }>(`/surveys/${params.id}`)

      return mapApiSurvey(response.survey)
    },
    enabled: isEditing,
    retry: 0,
  })

  const survey = useMemo(() => surveyQuery.data, [surveyQuery.data])
  const isPublishedSurvey = survey?.status === 'Publicada'

  useEffect(() => {
    if (survey) {
      const nextForm = mapSurveyToBuilderState(survey)
      setForm(nextForm)
      setSavedFlowSnapshot(extractFlowDraft(nextForm))
      setSavedBuilderSnapshot(extractBuilderDraft(nextForm))
      setUploadErrors({ logo: '', banner: '' })
      return
    }

    if (!isEditing) {
      const nextForm = makeEmptyBuilderState()
      setForm(nextForm)
      setSavedFlowSnapshot(extractFlowDraft(nextForm))
      setSavedBuilderSnapshot(extractBuilderDraft(nextForm))
      setFeedback('')
      setUploadErrors({ logo: '', banner: '' })
    }
  }, [isEditing, survey])

  useEffect(() => {
    const state = location.state as { feedback?: string; visualNotice?: string } | null

    if (!state?.feedback && !state?.visualNotice) {
      return
    }

    if (state.feedback) {
      setFeedback(state.feedback)
    }
    if (state.visualNotice) {
      if (centeredFeedbackTimeoutRef.current) {
        window.clearTimeout(centeredFeedbackTimeoutRef.current)
      }
      setCenteredFeedback({ message: state.visualNotice, key: Date.now() })
      centeredFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCenteredFeedback(null)
      }, 1800)
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    return () => {
      if (centeredFeedbackTimeoutRef.current) {
        window.clearTimeout(centeredFeedbackTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!form.questions.length) {
      setSelectedVisualQuestionId('')
      return
    }

    if (!selectedVisualQuestionId || !form.questions.some((question) => question.id === selectedVisualQuestionId)) {
      setSelectedVisualQuestionId(form.questions[0].id)
    }
  }, [form.questions, selectedVisualQuestionId])

  const currentFlowSnapshot = useMemo(() => extractFlowDraft(form), [form.flowLayout, form.questions])
  const currentFlowSignature = useMemo(() => getFlowDraftSignature(currentFlowSnapshot), [currentFlowSnapshot])
  const savedFlowSignature = useMemo(
    () => (savedFlowSnapshot ? getFlowDraftSignature(savedFlowSnapshot) : ''),
    [savedFlowSnapshot],
  )
  const currentBuilderSnapshot = useMemo(() => extractBuilderDraft(form), [form])
  const currentBuilderSignature = useMemo(() => getBuilderDraftSignature(currentBuilderSnapshot), [currentBuilderSnapshot])
  const savedBuilderSignature = useMemo(
    () => (savedBuilderSnapshot ? getBuilderDraftSignature(savedBuilderSnapshot) : ''),
    [savedBuilderSnapshot],
  )
  const hasUnsavedBuilderChanges = Boolean(savedBuilderSnapshot) && currentBuilderSignature !== savedBuilderSignature
  const hasUnsavedFlowChanges = Boolean(savedFlowSnapshot) && currentFlowSignature !== savedFlowSignature
  const navigationBlocker = useBlocker(hasUnsavedBuilderChanges)

  useEffect(() => {
    if (navigationBlocker.state !== 'blocked') {
      return
    }

    if (window.confirm('Você tem alterações não salvas. Deseja sair mesmo assim?')) {
      navigationBlocker.proceed()
      return
    }

    navigationBlocker.reset()
  }, [navigationBlocker])

  useEffect(() => {
    if (!hasUnsavedBuilderChanges) {
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
  }, [hasUnsavedBuilderChanges])

  const saveMutation = useMutation({
    mutationFn: async ({
      shouldPublish,
      flowSnapshot,
      draft,
    }: {
      shouldPublish: boolean
      flowSnapshot: FlowDraftState
      draft: BuilderState
    }) => {
      const normalizedFlowLayout = mergeFlowLayout(
        draft.questions.map((question) => question.id),
        draft.flowLayout,
      )
      const orderedQuestions =
        draft.builderMode === 'visual'
          ? sortIdsByFlowLayout(
              draft.questions.map((question) => question.id),
              normalizedFlowLayout,
            )
              .map((questionId) => draft.questions.find((question) => question.id === questionId))
              .filter((question): question is BuilderQuestion => Boolean(question))
          : draft.questions
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        participationMode: 'identified' as const,
        slug: draft.slug.trim(),
        brandName: draft.brandName.trim(),
        logoUrl: draft.logoUrl.trim(),
        primaryColor: draft.primaryColor.trim(),
        bannerUrl: draft.bannerUrl.trim(),
        closingMessage: draft.closingMessage.trim(),
        rewardEnabled: draft.rewardEnabled,
        preventDuplicateResponses: draft.preventDuplicateResponses,
        duplicateResponseCooldownDays: draft.duplicateResponseCooldownDays,
        allowMultipleResponses: draft.allowMultipleResponses,
        builderMode: 'visual',
        flowLayout: normalizedFlowLayout,
        questions: orderedQuestions.map((question, index) => {
          // Validate linkedQuestionId: must point to an existing question of compatible type
          let validatedLinkedId = question.linkedQuestionId ?? null
          if (validatedLinkedId) {
            const linkedQuestion = orderedQuestions.find((q) => q.id === validatedLinkedId)
            if (!linkedQuestion) {
              validatedLinkedId = null
            } else if (question.businessMetric === 'attendant_rating' && linkedQuestion.type !== 'short_text' && linkedQuestion.type !== 'long_text') {
              validatedLinkedId = null
            } else if (question.businessMetric === 'attendant_name') {
              validatedLinkedId = null
            }
          }

          return {
            id: question.id,
            title: question.title.trim(),
            description: question.description.trim(),
            type: question.type,
            isRequired: question.required,
            position: index,
            options:
              question.type === 'single_choice' || question.type === 'multiple_choice'
                ? question.options.map((item) => item.trim()).filter(Boolean)
                : [],
            flowRules:
              question.flowRules.filter(
                (rule) =>
                  rule.value.trim() &&
                  rule.nextQuestionId.trim() &&
                  (rule.value === FLOW_ON_ANSWER || question.type === 'yes_no' || question.type === 'single_choice' || question.type === 'multiple_choice'),
              ),
            businessMetric: question.businessMetric ?? null,
            linkedQuestionId: validatedLinkedId,
          }
        }),
      }

      let surveyId = params.id ?? ''

      if (isEditing) {
        await apiRequest<{ ok: boolean }>(`/surveys/${params.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      } else {
        const created = await apiRequest<{ id: string }>('/surveys', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        surveyId = created.id
      }

      if (shouldPublish) {
        await apiRequest<{ ok: boolean }>(`/surveys/${surveyId}/publish`, {
          method: 'POST',
        })
      }

      return { surveyId, published: shouldPublish, flowSnapshot, builderSnapshot: extractBuilderDraft(draft) }
    },
    onSuccess: async ({ surveyId, published, flowSnapshot, builderSnapshot }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['survey', surveyId] }),
      ])

      setSavedFlowSnapshot(flowSnapshot)
      setSavedBuilderSnapshot(builderSnapshot)

      const successMessage = published
        ? 'Pesquisa salva e publicada com sucesso.'
        : 'Pesquisa salva com sucesso.'

      if (!isEditing) {
        navigate(`/app/pesquisas/${surveyId}/editar`, {
          replace: true,
          state: { feedback: successMessage, visualNotice: successMessage },
        })
        return
      }

      setFeedback(successMessage)
      if (centeredFeedbackTimeoutRef.current) {
        window.clearTimeout(centeredFeedbackTimeoutRef.current)
      }
      setCenteredFeedback({ message: successMessage, key: Date.now() })
      centeredFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCenteredFeedback(null)
      }, 1800)
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar a pesquisa.')
    },
  })

  const [importingSurvey, setImportingSurvey] = useState(false)
  const importFileRef = useRef<HTMLInputElement | null>(null)

  async function handleExportSurvey() {
    if (!params.id) return
    try {
      const result = await apiRequest<{ version: number; kind: string; data: unknown }>(`/surveys/${params.id}/export`)
      const fileName = `pesquisa-${Date.now()}.json`
      downloadJsonFile(result, fileName)
      setFeedback('Pesquisa exportada com sucesso.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível exportar a pesquisa.')
    }
  }

  async function handleImportSurvey(file: File) {
    if (importingSurvey) return
    setImportingSurvey(true)
    try {
      const parsed = await readJsonFile(file) as { data?: Record<string, unknown> }
      if (!parsed.data || typeof parsed.data !== 'object') {
        throw new Error('Arquivo de importação inválido.')
      }
      const payload = parsed.data
      payload.slug = `imported-${Date.now()}`
      const result = await apiRequest<{ id: string }>('/surveys', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      await queryClient.invalidateQueries({ queryKey: ['surveys'] })
      setFeedback('Pesquisa importada com sucesso! Redirecionando...')
      navigate(`/surveys/${result.id}/builder`)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível importar a pesquisa.')
    } finally {
      setImportingSurvey(false)
      if (importFileRef.current) {
        importFileRef.current.value = ''
      }
    }
  }

  const unpublishMutation = useMutation({
    mutationFn: async () => {
      if (!params.id) {
        throw new Error('A pesquisa ainda precisa ser salva antes de voltar para rascunho.')
      }

      return apiRequest<{ ok: boolean }>(`/surveys/${params.id}/unpublish`, {
        method: 'POST',
      })
    },
    onSuccess: async () => {
      if (!params.id) {
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['survey', params.id] }),
      ])

      setFeedback('Pesquisa movida de volta para rascunho com sucesso.')
      if (centeredFeedbackTimeoutRef.current) {
        window.clearTimeout(centeredFeedbackTimeoutRef.current)
      }
      setCenteredFeedback({ message: 'Pesquisa atualizada com sucesso.', key: Date.now() })
      centeredFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCenteredFeedback(null)
      }, 1800)
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível voltar a pesquisa para rascunho.')
    },
  })

  const uploadMutation = useMutation({
    mutationFn: async ({ target, file, previousValue }: { target: SurveyUploadTarget; file: File; previousValue: string }) => {
      return uploadApiFile(`/surveys/uploads/${target}`, file, 'file', { previousValue })
    },
    onSuccess: ({ key, value }) => {
      const target = key as SurveyUploadTarget
      setForm((current) => ({
        ...current,
        ...(target === 'logo' ? { logoUrl: value } : { bannerUrl: value }),
      }))
      setUploadErrors((current) => ({
        ...current,
        [target]: '',
      }))
      setUploadInputVersion((current) => ({
        ...current,
        [target]: current[target] + 1,
      }))
      setUploadingKey('')
      setFeedback('Imagem enviada com sucesso.')
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : 'Não foi possível enviar a imagem.'
      setUploadErrors((current) => ({
        ...current,
        [variables.target]: message,
      }))
      setUploadingKey('')
      setFeedback(message)
    },
  })

  const removeUploadMutation = useMutation({
    mutationFn: async ({ target, value }: { target: SurveyUploadTarget; value: string }) => {
      return apiRequest<{ ok: boolean; key: string; value: string }>(`/surveys/uploads/${target}`, {
        method: 'DELETE',
        body: JSON.stringify({ value }),
      })
    },
    onSuccess: ({ key }) => {
      const target = key as SurveyUploadTarget
      setForm((current) => ({
        ...current,
        ...(target === 'logo' ? { logoUrl: '' } : { bannerUrl: '' }),
      }))
      setUploadErrors((current) => ({
        ...current,
        [target]: '',
      }))
      setUploadInputVersion((current) => ({
        ...current,
        [target]: current[target] + 1,
      }))
      setRemovingKey('')
      setFeedback('Imagem removida com sucesso.')
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : 'Não foi possível remover a imagem.'
      setUploadErrors((current) => ({
        ...current,
        [variables.target]: message,
      }))
      setRemovingKey('')
      setFeedback(message)
    },
  })

  function updateForm<K extends keyof BuilderState>(key: K, value: BuilderState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleSurveyImageUpload(target: SurveyUploadTarget, file?: File) {
    if (!file) {
      return
    }

    const previousValue = target === 'logo' ? form.logoUrl : form.bannerUrl

    setFeedback('')
    setUploadingKey(target)
    setUploadErrors((current) => ({
      ...current,
      [target]: '',
    }))

    await uploadMutation.mutateAsync({ target, file, previousValue })
  }

  async function handleSurveyImageRemove(target: SurveyUploadTarget) {
    const value = target === 'logo' ? form.logoUrl : form.bannerUrl

    if (!value) {
      return
    }

    setFeedback('')
    setRemovingKey(target)
    setUploadErrors((current) => ({
      ...current,
      [target]: '',
    }))

    await removeUploadMutation.mutateAsync({ target, value })
  }

  function updateQuestion(index: number, updater: (question: BuilderQuestion) => BuilderQuestion) {
    setForm((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) =>
        questionIndex === index ? updater(question) : question,
      ),
    }))
  }

  function updateQuestionById(questionId: string, updater: (question: BuilderQuestion) => BuilderQuestion) {
    setForm((current) => ({
      ...current,
      questions: current.questions.map((question) => (question.id === questionId ? updater(question) : question)),
    }))
  }

  function addQuestion() {
    const nextQuestion = makeQuestion()

    setForm((current) => {
      const nextQuestions = [...current.questions, nextQuestion]

      return {
        ...current,
        questions: nextQuestions,
        flowLayout: mergeFlowLayout(
          nextQuestions.map((question) => question.id),
          current.flowLayout,
        ),
      }
    })
    setSelectedVisualQuestionId(nextQuestion.id)
  }

  function removeQuestion(index: number) {
    setForm((current) => {
      if (current.questions.length <= 1) {
        return current
      }

      const removedQuestion = current.questions[index]
      if (!removedQuestion) return current

      // Warn if the question has a business metric
      if (removedQuestion.businessMetric) {
        const metricLabels: Record<string, string> = {
          missing_product: 'Produto em falta',
          attendant_name: 'Nome do atendente',
          attendant_rating: 'Nota do atendente',
        }
        const label = metricLabels[removedQuestion.businessMetric] ?? removedQuestion.businessMetric
        if (!window.confirm(`Esta pergunta está configurada como métrica de negócio "${label}". Deseja removê-la mesmo assim? A métrica será perdida.`)) {
          return current
        }
      }

      const removedQuestionId = removedQuestion.id
      const nextQuestions = current.questions.filter((_, i) => i !== index)

      return {
        ...current,
        questions: nextQuestions.map((question) => ({
          ...question,
          flowRules: removeRulesThatPointToQuestion(question.flowRules, removedQuestionId),
          // Clean up linkedQuestionId if it points to the removed question
          linkedQuestionId: question.linkedQuestionId === removedQuestionId ? null : question.linkedQuestionId,
        })),
        flowLayout: {
          ...current.flowLayout,
          nodes: current.flowLayout.nodes.filter((node) => node.id !== removedQuestionId),
        },
      }
    })
  }

  function removeQuestionById(questionId: string) {
    const questionIndex = form.questions.findIndex((question) => question.id === questionId)

    if (questionIndex < 0) {
      return
    }

    removeQuestion(questionIndex)
  }

  function addOption(questionIndex: number) {
    updateQuestion(questionIndex, (question) => ({
      ...question,
      options: [...question.options, ''],
    }))
  }

  function removeOption(questionIndex: number, optionIndex: number) {
    updateQuestion(questionIndex, (question) => ({
      ...question,
      options: question.options.length > 1 ? question.options.filter((_, i) => i !== optionIndex) : question.options,
      flowRules:
        question.options.length > 1
          ? question.flowRules.filter((rule) => rule.value !== question.options[optionIndex])
          : question.flowRules,
    }))
  }

  const previewContent = (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <div
        className="overflow-hidden border border-slate-200"
        style={{
          borderRadius: 8,
          backgroundImage: form.bannerUrl
            ? `linear-gradient(180deg, rgba(15,23,42,0.18) 0%, rgba(15,23,42,0.7) 100%), url(${form.bannerUrl})`
            : `linear-gradient(135deg, ${form.primaryColor || '#0b5cff'} 0%, #0f172a 100%)`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="flex min-h-[260px] flex-col justify-between px-5 py-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {form.logoUrl ? (
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden border border-white/30 bg-white/90" style={{ borderRadius: 8 }}>
                  <img src={form.logoUrl} alt="Logo da previa da pesquisa" className="h-full w-full object-contain" />
                </div>
              ) : (
                <div
                  className="flex h-14 w-14 items-center justify-center border border-white/30 bg-white/15 text-sm font-semibold"
                  style={{ borderRadius: 8 }}
                >
                  {getBrandInitials(form.brandName)}
                </div>
              )}

              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/70">{form.brandName.trim() || 'Sua marca'}</p>
                <p className="mt-1 text-sm font-medium text-white/90">/s/{form.slug.trim() || 'seu-link-aqui'}</p>
              </div>
            </div>

            <span className="border border-white/30 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ borderRadius: 999 }}>
              {form.rewardEnabled ? 'Com roleta' : 'Pesquisa simples'}
            </span>
          </div>

          <div className="max-w-2xl">
            <h3 className="text-2xl font-semibold leading-tight sm:text-3xl">
              {form.title.trim() || 'O titulo da sua pesquisa aparecera aqui'}
            </h3>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/85">
              {form.description.trim() || 'Use a descricao para explicar rapidamente o objetivo da pesquisa e orientar o participante.'}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="border border-white/25 bg-white/10 px-3 py-1 text-xs text-white/90" style={{ borderRadius: 999 }}>
                Nome e WhatsApp obrigatorios
              </span>
              <span className="border border-white/25 bg-white/10 px-3 py-1 text-xs text-white/90" style={{ borderRadius: 999 }}>
                {form.questions.length} {form.questions.length === 1 ? 'pergunta' : 'perguntas'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="border border-slate-200 bg-slate-50 p-4" style={{ borderRadius: 8 }}>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Como o participante percebe</p>
          <div className="mt-3 border border-slate-200 bg-white p-4" style={{ borderRadius: 8 }}>
            <p className="text-sm font-semibold text-slate-950">
              {form.questions[0]?.title?.trim() || 'A primeira pergunta aparecera aqui'}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {form.questions[0]?.description?.trim() || 'Voce pode usar a descricao de apoio para orientar a resposta do cliente.'}
            </p>
            <div className="mt-4 grid gap-2">
              <div className="h-10 border border-slate-200 bg-slate-50" style={{ borderRadius: 8 }} />
              <div
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-white"
                style={{ borderRadius: 8, backgroundColor: form.primaryColor || '#0b5cff' }}
              >
                Continuar
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border border-slate-200 bg-white p-4" style={{ borderRadius: 8 }}>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Resumo da identidade</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="border border-slate-200 bg-slate-50 p-3" style={{ borderRadius: 8 }}>
              <p className="text-xs text-slate-500">Cor principal</p>
              <div className="mt-2 flex items-center gap-2">
                <div
                  className="h-8 w-8 border border-slate-200"
                  style={{ borderRadius: 8, backgroundColor: form.primaryColor || '#0b5cff' }}
                />
                <span className="text-sm font-medium text-slate-900">{form.primaryColor || '#0b5cff'}</span>
              </div>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-3" style={{ borderRadius: 8 }}>
              <p className="text-xs text-slate-500">Logo</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{form.logoUrl ? 'Enviada' : 'Pendente'}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-3" style={{ borderRadius: 8 }}>
              <p className="text-xs text-slate-500">Banner</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{form.bannerUrl ? 'Enviado' : 'Pendente'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const actionButtons = (
    <>
      <button type="button" onClick={() => setPreviewOpen(true)} className="admin-button">
        <FileImage className="h-4 w-4" />
        Ver prévia
      </button>
      {params.id ? (
        <Link to={getSurveyTestPath(params.id)} className="admin-button border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100">
          <Sparkles className="h-4 w-4" />
          Testar pesquisa
        </Link>
      ) : null}
      {params.id ? (
        <button type="button" onClick={() => void handleExportSurvey()} className="admin-button">
          <Download className="h-4 w-4" />
          Exportar
        </button>
      ) : null}
      <input
        ref={importFileRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleImportSurvey(file)
        }}
      />
      <button
        type="button"
        disabled={importingSurvey}
        onClick={() => importFileRef.current?.click()}
        className="admin-button"
      >
        <Upload className="h-4 w-4" />
        {importingSurvey ? 'Importando...' : 'Importar'}
      </button>
      <button
        type="button"
        onClick={() =>
          void saveMutation.mutateAsync({
            shouldPublish: false,
            flowSnapshot: normalizeFlowDraft(currentFlowSnapshot),
            draft: form,
          })
        }
        disabled={saveMutation.isPending || unpublishMutation.isPending}
        className="admin-button border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"
      >
        <FileImage className="h-4 w-4" />
        Salvar rascunho
      </button>
      <button
        type="button"
        onClick={() =>
          void saveMutation.mutateAsync({
            shouldPublish: true,
            flowSnapshot: normalizeFlowDraft(currentFlowSnapshot),
            draft: form,
          })
        }
        disabled={saveMutation.isPending || unpublishMutation.isPending}
        className="admin-button-primary border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700"
      >
        <Share2 className="h-4 w-4" />
        Salvar e publicar
      </button>
        {params.id && isPublishedSurvey ? (
          <button
            type="button"
            disabled={saveMutation.isPending || unpublishMutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  'Deseja tirar esta pesquisa do ar e voltar para rascunho? O link público deixará de funcionar, mas as respostas já recebidas continuarão salvas.',
                )
              ) {
                void unpublishMutation.mutateAsync()
              }
            }}
            className="admin-button border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
          >
            <Share2 className="h-4 w-4" />
            {unpublishMutation.isPending ? 'Voltando...' : 'Voltar para rascunho'}
          </button>
        ) : null}
    </>
  )

  return (
    <>
      {centeredFeedback ? (
        <div className="pointer-events-none fixed inset-0 z-[140] flex items-center justify-center px-4">
          <div
            key={centeredFeedback.key}
            className="animate-fade-in-scale rounded-[24px] border border-emerald-200 bg-white/95 px-6 py-5 text-center shadow-[0_28px_80px_rgba(15,23,42,0.18)] backdrop-blur-sm"
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-[0_12px_30px_rgba(16,185,129,0.18)]">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.22em] text-emerald-700">Tudo certo</p>
            <p className="mt-2 text-base font-semibold text-slate-950 sm:text-lg">{centeredFeedback.message}</p>
          </div>
        </div>
      ) : null}

      <AppShell
      title={params.id ? (survey?.title ?? 'Fluxo da pesquisa') : 'Nova pesquisa'}
      subtitle=""
      hideHeader={Boolean(params.id)}
      {...(params.id
        ? {}
        : {
            backHref: '/app/pesquisas',
            backLabel: 'Voltar para pesquisas',
            breadcrumbs: [{ label: 'Pesquisas', href: '/app/pesquisas' }, { label: 'Nova pesquisa' }],
          })}
    >
      {surveyQuery.isError ? (
        <div className="admin-alert mb-6 border-amber-200 bg-amber-50 text-amber-900">
          Não foi possível carregar a pesquisa agora. Verifique a API e tente novamente.
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`admin-alert mb-6 ${
            saveMutation.isError || uploadMutation.isError || removeUploadMutation.isError || unpublishMutation.isError
              ? 'border border-rose-200 bg-rose-50 text-rose-900'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {feedback}
        </div>
      ) : null}

      {params.id ? (
        <SurveyNavBar
          surveyId={params.id}
          surveyTitle={survey?.title}
          activeTab="flow"
        />
      ) : null}

      <div className={params.id ? 'p-3 sm:p-4 lg:p-5' : ''}>
      <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
            {params.id ? (isPublishedSurvey ? 'Publicada' : 'Rascunho') : 'Nova pesquisa'}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
            {form.questions.length} {form.questions.length === 1 ? 'pergunta' : 'perguntas'}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              saveMutation.isPending
                ? 'border border-sky-200 bg-sky-50 text-sky-700'
                : hasUnsavedBuilderChanges
                  ? 'border border-amber-200 bg-amber-50 text-amber-700'
                  : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {saveMutation.isPending ? 'Salvando...' : hasUnsavedBuilderChanges ? 'Alterações não salvas' : 'Tudo salvo'}
          </span>
          {form.slug ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
              /s/{form.slug}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {actionButtons}
        </div>
      </section>

      <AdminModal
        open={previewOpen}
        title="Previa da pesquisa"
        description="Confira como a identidade e a abertura da pesquisa estao ficando antes de publicar."
        onClose={() => setPreviewOpen(false)}
      >
        {previewContent}
      </AdminModal>

      <div className="grid gap-6">
        <SectionCard
          eyebrow="Fluxo"
          title="Canvas da pesquisa"
          description="O fluxo fica no centro. Toque em um bloco para editar a pergunta."
        >
          <SurveyVisualFlowEditor
            primaryColor={form.primaryColor}
            questions={form.questions}
            flowLayout={form.flowLayout}
            hasUnsavedChanges={hasUnsavedFlowChanges}
            isSaving={saveMutation.isPending}
            selectedQuestionId={selectedVisualQuestionId}
            onSelectQuestion={setSelectedVisualQuestionId}
            onAddQuestion={addQuestion}
            onRemoveQuestion={removeQuestionById}
            onUpdateQuestion={updateQuestionById}
            onUpdateFlowLayout={(layout) => updateForm('flowLayout', layout)}
            onSaveFlow={() =>
              void saveMutation.mutateAsync({
                shouldPublish: false,
                flowSnapshot: normalizeFlowDraft(currentFlowSnapshot),
                draft: form,
              })
            }
            onDiscardFlow={() => {
              if (!savedFlowSnapshot || !hasUnsavedFlowChanges) {
                return
              }

              if (window.confirm('Descartar as alterações do fluxo e voltar para a última versão salva?')) {
                setForm((current) => ({
                  ...current,
                  questions: savedFlowSnapshot.questions.map((question) => ({
                    ...question,
                    options: [...question.options],
                    flowRules: question.flowRules.map((rule) => ({ ...rule })),
                  })),
                  flowLayout: {
                    ...savedFlowSnapshot.flowLayout,
                    nodes: savedFlowSnapshot.flowLayout.nodes.map((node) => ({ ...node })),
                    viewport: savedFlowSnapshot.flowLayout.viewport
                      ? { ...savedFlowSnapshot.flowLayout.viewport }
                      : undefined,
                  },
                }))
                setFeedback('Alterações do fluxo descartadas.')
              }
            }}
          />
        </SectionCard>

        <SectionCard
          eyebrow="Configuração"
          title="Dados principais"
          description="Só o essencial para deixar a pesquisa pronta e fácil de publicar."
        >
          <div className="grid gap-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="text-slate-600">Título da pesquisa</span>
                <input
                  className="admin-input"
                  value={form.title}
                  placeholder="Ex.: Pesquisa de satisfação da loja"
                  onChange={(event) => updateForm('title', event.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="text-slate-600">Descrição</span>
                <textarea
                  className="admin-input min-h-24"
                  value={form.description}
                  placeholder="Explique rapidamente o objetivo da pesquisa e o que o cliente vai encontrar."
                  onChange={(event) => updateForm('description', event.target.value)}
                />
              </label>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(320px,0.9fr)]">
              <label className="grid gap-2 text-sm">
                <span className="text-slate-600">Nome da marca</span>
                <input
                  className="admin-input"
                  value={form.brandName}
                  placeholder="Ex.: Loja Exemplo"
                  onChange={(event) => updateForm('brandName', event.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="text-slate-600">Slug amigável</span>
                <input
                  className="admin-input"
                  value={form.slug}
                  placeholder="ex.: promocao-julho"
                  onChange={(event) =>
                    updateForm(
                      'slug',
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]+/g, '-')
                        .replace(/^-+|-+$/g, ''),
                    )
                  }
                />
              </label>

              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <Palette className="h-4 w-4" />
                  <span>Cor principal</span>
                </div>
                <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      className="h-10 w-12 cursor-pointer border border-slate-300 bg-white p-1"
                      value={form.primaryColor}
                      onChange={(event) => updateForm('primaryColor', event.target.value)}
                      style={{ borderRadius: 8 }}
                    />
                    <input
                      className="admin-input h-10"
                      value={form.primaryColor}
                      placeholder="#0b5cff"
                      onChange={(event) => updateForm('primaryColor', event.target.value)}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {surveyColorPresets.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Usar a cor ${color}`}
                        className={`h-7 w-7 border transition hover:scale-105 ${
                          form.primaryColor.toLowerCase() === color.toLowerCase()
                            ? 'border-slate-950 ring-2 ring-slate-200'
                            : 'border-slate-200'
                        }`}
                        style={{ borderRadius: 8, backgroundColor: color }}
                        onClick={() => updateForm('primaryColor', color)}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Essa cor aparece nos botões, destaques e na identidade da página pública.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid gap-3 rounded-[10px] border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">Logo da pesquisa</span>
                  <button
                    type="button"
                    className="admin-button px-3 py-2 text-xs"
                    onClick={() => void handleSurveyImageRemove('logo')}
                    disabled={!form.logoUrl || (removeUploadMutation.isPending && removingKey === 'logo')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {removeUploadMutation.isPending && removingKey === 'logo' ? 'Removendo...' : 'Remover'}
                  </button>
                </div>

                {form.logoUrl ? (
                  <div className="flex h-20 items-center justify-center border border-slate-200 bg-white px-4 py-3" style={{ borderRadius: 8 }}>
                    <img src={form.logoUrl} alt="Preview da logo da pesquisa" className="h-12 w-auto max-w-full object-contain" />
                  </div>
                ) : (
                  <div className="flex h-20 items-center justify-center border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-400" style={{ borderRadius: 8 }}>
                    Nenhuma logo enviada.
                  </div>
                )}

                <label className="grid gap-2 text-sm">
                  <input
                    key={`survey-logo-${uploadInputVersion.logo}`}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp"
                    className="block w-full border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none file:mr-3 file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                    style={{ borderRadius: 8 }}
                    onChange={(event) => void handleSurveyImageUpload('logo', event.target.files?.[0])}
                  />
                  <p className="text-xs text-slate-500">
                    {uploadingKey === 'logo' && uploadMutation.isPending
                      ? 'Enviando logo...'
                      : form.logoUrl || 'PNG, JPG, SVG ou WEBP.'}
                  </p>
                  {uploadErrors.logo ? <p className="text-xs text-rose-600">{uploadErrors.logo}</p> : null}
                </label>
              </div>

              <div className="grid gap-3 rounded-[10px] border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">Banner da pesquisa</span>
                  <button
                    type="button"
                    className="admin-button px-3 py-2 text-xs"
                    onClick={() => void handleSurveyImageRemove('banner')}
                    disabled={!form.bannerUrl || (removeUploadMutation.isPending && removingKey === 'banner')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {removeUploadMutation.isPending && removingKey === 'banner' ? 'Removendo...' : 'Remover'}
                  </button>
                </div>

                {form.bannerUrl ? (
                  <div className="flex h-24 items-center justify-center overflow-hidden border border-slate-200 bg-white" style={{ borderRadius: 8 }}>
                    <img src={form.bannerUrl} alt="Preview do banner da pesquisa" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="flex h-24 items-center justify-center border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-400" style={{ borderRadius: 8 }}>
                    Nenhum banner enviado.
                  </div>
                )}

                <label className="grid gap-2 text-sm">
                  <input
                    key={`survey-banner-${uploadInputVersion.banner}`}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp"
                    className="block w-full border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none file:mr-3 file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                    style={{ borderRadius: 8 }}
                    onChange={(event) => void handleSurveyImageUpload('banner', event.target.files?.[0])}
                  />
                  <p className="text-xs text-slate-500">
                    {uploadingKey === 'banner' && uploadMutation.isPending
                      ? 'Enviando banner...'
                      : form.bannerUrl || 'PNG, JPG, SVG ou WEBP.'}
                  </p>
                  {uploadErrors.banner ? <p className="text-xs text-rose-600">{uploadErrors.banner}</p> : null}
                </label>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <label className="grid gap-2 text-sm">
                <span className="text-slate-600">Modo de participação</span>
                <select
                  className="admin-select"
                  value="identified"
                  disabled
                >
                  <option value="identified">Identificada com nome e telefone</option>
                </select>
              </label>

              <label className="admin-checkrow rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={form.rewardEnabled}
                  onChange={(event) => {
                    const rewardEnabled = event.target.checked
                    setForm((current) => ({
                      ...current,
                      rewardEnabled,
                      participationMode: 'identified',
                    }))
                  }}
                />
                <span>
                  <span className="block font-semibold text-slate-950">Ativar roleta de prêmios</span>
                  <span className="text-slate-500">Liga a campanha de prêmios para esta pesquisa.</span>
                </span>
              </label>
            </div>

            <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
              <label className="admin-checkrow">
                <input
                  type="checkbox"
                  checked={form.allowMultipleResponses}
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      allowMultipleResponses: event.target.checked,
                    }))
                  }}
                />
                <span>
                  <span className="block font-semibold text-slate-950">Permitir múltiplas respostas</span>
                  <span className="text-slate-500">A mesma pessoa pode responder à pesquisa mais de uma vez.</span>
                </span>
              </label>
            </div>

            <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
              <label className="grid gap-2 text-sm">
                <span className="font-semibold text-slate-950">Prazo para novo giro da roleta (dias)</span>
                <span className="text-slate-500">A mesma pessoa só pode girar a roleta novamente após esse prazo.</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="admin-input w-32"
                  value={form.duplicateResponseCooldownDays}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10)
                    setForm((current) => ({
                      ...current,
                      duplicateResponseCooldownDays: Number.isNaN(value) ? current.duplicateResponseCooldownDays : Math.max(1, Math.min(365, value)),
                    }))
                  }}
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Mensagem final</span>
              <textarea
                className="admin-input min-h-28"
                value={form.closingMessage}
                placeholder="Ex.: Obrigado por participar. Sua resposta foi registrada com sucesso."
                onChange={(event) => updateForm('closingMessage', event.target.value)}
              />
            </label>
          </div>
        </SectionCard>
      </div>
      </div>
    </AppShell>
    </>
  )
}
