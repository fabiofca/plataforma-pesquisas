import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FileImage,
  Palette,
  Share2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { SurveyVisualFlowEditor } from '@/components/surveys/SurveyVisualFlowEditor'
import { AdminModal } from '@/components/ui/AdminModal'
import { SectionCard } from '@/components/ui/SectionCard'
import { apiRequest, uploadApiFile } from '@/lib/api-client'
import { mapApiSurvey } from '@/lib/mappers'
import { getSurveyTestPath } from '@/lib/public-survey'
import { FLOW_ON_ANSWER } from '@/lib/survey-flow'
import { mergeFlowLayout, sortIdsByFlowLayout } from '@/lib/survey-visual-flow'
import type { QuestionType, SurveyBuilderMode, SurveyFlowLayout, SurveyItem, SurveyQuestionFlowRule } from '@/types/domain'

type BuilderQuestion = {
  id: string
  title: string
  description: string
  type: QuestionType
  required: boolean
  options: string[]
  flowRules: SurveyQuestionFlowRule[]
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
  builderMode: SurveyBuilderMode
  flowLayout: SurveyFlowLayout
  questions: BuilderQuestion[]
}

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
    preventDuplicateResponses: false,
    builderMode: 'visual',
    flowLayout: mergeFlowLayout(initialQuestions.map((question) => question.id), { version: 1, nodes: [] }),
    questions: initialQuestions,
  }
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
    preventDuplicateResponses: false,
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
  const [selectedVisualQuestionId, setSelectedVisualQuestionId] = useState('')
  const [feedback, setFeedback] = useState('')
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
      setForm(mapSurveyToBuilderState(survey))
      setUploadErrors({ logo: '', banner: '' })
      return
    }

    if (!isEditing) {
      setForm(makeEmptyBuilderState())
      setFeedback('')
      setUploadErrors({ logo: '', banner: '' })
    }
  }, [isEditing, survey])

  useEffect(() => {
    const state = location.state as { feedback?: string } | null

    if (!state?.feedback) {
      return
    }

    setFeedback(state.feedback)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    if (!form.questions.length) {
      setSelectedVisualQuestionId('')
      return
    }

    if (!selectedVisualQuestionId || !form.questions.some((question) => question.id === selectedVisualQuestionId)) {
      setSelectedVisualQuestionId(form.questions[0].id)
    }
  }, [form.questions, selectedVisualQuestionId])

  const saveMutation = useMutation({
    mutationFn: async (shouldPublish: boolean) => {
      const normalizedFlowLayout = mergeFlowLayout(
        form.questions.map((question) => question.id),
        form.flowLayout,
      )
      const orderedQuestions =
        form.builderMode === 'visual'
          ? sortIdsByFlowLayout(
              form.questions.map((question) => question.id),
              normalizedFlowLayout,
            )
              .map((questionId) => form.questions.find((question) => question.id === questionId))
              .filter((question): question is BuilderQuestion => Boolean(question))
          : form.questions
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        participationMode: 'identified' as const,
        slug: form.slug.trim(),
        brandName: form.brandName.trim(),
        logoUrl: form.logoUrl.trim(),
        primaryColor: form.primaryColor.trim(),
        bannerUrl: form.bannerUrl.trim(),
        closingMessage: form.closingMessage.trim(),
        rewardEnabled: form.rewardEnabled,
        preventDuplicateResponses: false,
        builderMode: 'visual',
        flowLayout: normalizedFlowLayout,
        questions: orderedQuestions.map((question, index) => ({
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
                (rule.value === FLOW_ON_ANSWER || question.type === 'yes_no' || question.type === 'single_choice'),
            ),
        })),
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

      return { surveyId, published: shouldPublish }
    },
    onSuccess: async ({ surveyId, published }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['survey', surveyId] }),
      ])

      const successMessage = published
        ? 'Pesquisa salva e publicada com sucesso.'
        : 'Pesquisa salva com sucesso.'

      if (!isEditing) {
        navigate(`/app/pesquisas/${surveyId}/editar`, {
          replace: true,
          state: { feedback: successMessage },
        })
        return
      }

      setFeedback(successMessage)
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar a pesquisa.')
    },
  })

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

      const removedQuestionId = current.questions[index]?.id
      const nextQuestions = current.questions.filter((_, i) => i !== index)

      return {
        ...current,
        questions: removedQuestionId
          ? nextQuestions.map((question) => ({
              ...question,
              flowRules: removeRulesThatPointToQuestion(question.flowRules, removedQuestionId),
            }))
          : nextQuestions,
        flowLayout: removedQuestionId
          ? {
              ...current.flowLayout,
              nodes: current.flowLayout.nodes.filter((node) => node.id !== removedQuestionId),
            }
          : current.flowLayout,
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
              <div className="h-10 border border-slate-200 bg-slate-50" style={{ borderRadius: 6 }} />
              <div
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-white"
                style={{ borderRadius: 6, backgroundColor: form.primaryColor || '#0b5cff' }}
              >
                Continuar
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border border-slate-200 bg-white p-4" style={{ borderRadius: 8 }}>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Resumo da identidade</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="border border-slate-200 bg-slate-50 p-3" style={{ borderRadius: 6 }}>
              <p className="text-xs text-slate-500">Cor principal</p>
              <div className="mt-2 flex items-center gap-2">
                <div
                  className="h-8 w-8 border border-slate-200"
                  style={{ borderRadius: 6, backgroundColor: form.primaryColor || '#0b5cff' }}
                />
                <span className="text-sm font-medium text-slate-900">{form.primaryColor || '#0b5cff'}</span>
              </div>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-3" style={{ borderRadius: 6 }}>
              <p className="text-xs text-slate-500">Logo</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{form.logoUrl ? 'Enviada' : 'Pendente'}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-3" style={{ borderRadius: 6 }}>
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
        <Link to={getSurveyTestPath(params.id)} className="admin-button">
          <Sparkles className="h-4 w-4" />
          Testar pesquisa
        </Link>
      ) : null}
      <button
        type="button"
        onClick={() => void saveMutation.mutateAsync(false)}
          disabled={saveMutation.isPending || unpublishMutation.isPending}
        className="admin-button-primary"
      >
        <Sparkles className="h-4 w-4" />
        {saveMutation.isPending ? 'Salvando...' : 'Salvar rascunho'}
      </button>
      <button
        type="button"
        onClick={() => void saveMutation.mutateAsync(true)}
          disabled={saveMutation.isPending || unpublishMutation.isPending}
        className="admin-button"
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
            className="admin-button"
          >
            <Share2 className="h-4 w-4" />
            {unpublishMutation.isPending ? 'Voltando...' : 'Voltar para rascunho'}
          </button>
        ) : null}
      {params.id && form.rewardEnabled ? (
        <Link
          to={`/app/pesquisas/${params.id}/premios`}
          className="admin-button"
        >
          Configurar prêmios
        </Link>
      ) : null}
    </>
  )

  return (
    <AppShell
      title={params.id ? 'Fluxo da pesquisa' : 'Nova pesquisa'}
      subtitle="Monte o fluxo e salve quando estiver pronto."
      backHref={params.id ? `/app/pesquisas/${params.id}` : '/app/pesquisas'}
      backLabel={params.id ? 'Voltar para a pesquisa' : 'Voltar para pesquisas'}
      breadcrumbs={
        params.id
          ? [
              { label: 'Pesquisas', href: '/app/pesquisas' },
              { label: survey?.title ?? 'Pesquisa', href: `/app/pesquisas/${params.id}` },
              { label: 'Editar' },
            ]
          : [{ label: 'Pesquisas', href: '/app/pesquisas' }, { label: 'Nova pesquisa' }]
      }
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

      <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
            {params.id ? (isPublishedSurvey ? 'Publicada' : 'Rascunho') : 'Nova pesquisa'}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
            {form.questions.length} {form.questions.length === 1 ? 'pergunta' : 'perguntas'}
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
            selectedQuestionId={selectedVisualQuestionId}
            onSelectQuestion={setSelectedVisualQuestionId}
            onAddQuestion={addQuestion}
            onRemoveQuestion={removeQuestionById}
            onUpdateQuestion={updateQuestionById}
            onUpdateFlowLayout={(layout) => updateForm('flowLayout', layout)}
          />
        </SectionCard>

        <SectionCard
          eyebrow="Configuração"
          title="Dados principais"
          description="Só o essencial para deixar a pesquisa pronta e fácil de publicar."
        >
          <div className="grid gap-6">
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

            <div className="grid gap-4 lg:grid-cols-3">
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
                <span className="text-slate-600">Cor principal</span>
                <div className="flex gap-3">
                  <input
                    type="color"
                    className="h-11 w-14 cursor-pointer border border-slate-300 bg-white p-1"
                    value={form.primaryColor}
                    onChange={(event) => updateForm('primaryColor', event.target.value)}
                    style={{ borderRadius: 6 }}
                  />
                  <input
                    className="admin-input"
                    value={form.primaryColor}
                    placeholder="#0b5cff"
                    onChange={(event) => updateForm('primaryColor', event.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Palette className="h-4 w-4" />
                Cores rápidas
              </div>
              <div className="flex flex-wrap gap-2">
                {surveyColorPresets.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Usar a cor ${color}`}
                    className="h-8 w-8 border border-slate-200 transition hover:scale-105"
                    style={{ borderRadius: 6, backgroundColor: color }}
                    onClick={() => updateForm('primaryColor', color)}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid gap-4 border border-slate-200 bg-slate-50 p-4" style={{ borderRadius: 8 }}>
                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Logo da pesquisa</span>
                  {form.logoUrl ? (
                    <div className="flex min-h-24 items-center justify-center border border-slate-200 bg-white px-4 py-3" style={{ borderRadius: 6 }}>
                      <img src={form.logoUrl} alt="Preview da logo da pesquisa" className="h-14 w-auto max-w-full object-contain" />
                    </div>
                  ) : (
                    <div className="flex min-h-24 items-center justify-center border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-400" style={{ borderRadius: 6 }}>
                      Nenhuma logo enviada.
                    </div>
                  )}
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Enviar logo</span>
                  <input
                    key={`survey-logo-${uploadInputVersion.logo}`}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp"
                    className="block w-full border border-slate-200 bg-white px-4 py-3 text-sm outline-none file:mr-3 file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                    style={{ borderRadius: 6 }}
                    onChange={(event) => void handleSurveyImageUpload('logo', event.target.files?.[0])}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="admin-button"
                      onClick={() => void handleSurveyImageRemove('logo')}
                      disabled={!form.logoUrl || (removeUploadMutation.isPending && removingKey === 'logo')}
                    >
                      <Trash2 className="h-4 w-4" />
                      {removeUploadMutation.isPending && removingKey === 'logo' ? 'Removendo...' : 'Remover'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    {uploadingKey === 'logo' && uploadMutation.isPending
                      ? 'Enviando logo...'
                      : form.logoUrl || 'PNG, JPG, SVG ou WEBP.'}
                  </p>
                  {uploadErrors.logo ? <p className="text-xs text-rose-600">{uploadErrors.logo}</p> : null}
                </label>
              </div>

              <div className="grid gap-4 border border-slate-200 bg-slate-50 p-4" style={{ borderRadius: 8 }}>
                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Banner da pesquisa</span>
                  {form.bannerUrl ? (
                    <div className="flex min-h-28 items-center justify-center overflow-hidden border border-slate-200 bg-white" style={{ borderRadius: 6 }}>
                      <img src={form.bannerUrl} alt="Preview do banner da pesquisa" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex min-h-28 items-center justify-center border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-400" style={{ borderRadius: 6 }}>
                      Nenhum banner enviado.
                    </div>
                  )}
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Enviar banner</span>
                  <input
                    key={`survey-banner-${uploadInputVersion.banner}`}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp"
                    className="block w-full border border-slate-200 bg-white px-4 py-3 text-sm outline-none file:mr-3 file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                    style={{ borderRadius: 6 }}
                    onChange={(event) => void handleSurveyImageUpload('banner', event.target.files?.[0])}
                  />

                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="admin-button"
                      onClick={() => void handleSurveyImageRemove('banner')}
                      disabled={!form.bannerUrl || (removeUploadMutation.isPending && removingKey === 'banner')}
                    >
                      <Trash2 className="h-4 w-4" />
                      {removeUploadMutation.isPending && removingKey === 'banner' ? 'Removendo...' : 'Remover'}
                    </button>
                  </div>

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

    </AppShell>
  )
}
