import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  FileImage,
  FileText,
  Link2,
  Palette,
  Plus,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { AdminModal } from '@/components/ui/AdminModal'
import { SectionCard } from '@/components/ui/SectionCard'
import { SurveyShareCard } from '@/components/ui/SurveyShareCard'
import { apiRequest, uploadApiFile } from '@/lib/api-client'
import { mapApiSurvey } from '@/lib/mappers'
import { getSurveyTestPath } from '@/lib/public-survey'
import { FLOW_END, getQuestionFlowValues, supportsQuestionFlow } from '@/lib/survey-flow'
import type { QuestionType, SurveyItem, SurveyQuestionFlowRule } from '@/types/domain'

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
  questions: BuilderQuestion[]
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

function updateFlowRuleList(flowRules: SurveyQuestionFlowRule[], value: string, nextQuestionId: string) {
  const normalizedValue = value.trim()
  const nextRules = flowRules.filter((rule) => rule.value !== normalizedValue)

  if (!nextQuestionId) {
    return nextRules
  }

  return [...nextRules, { value: normalizedValue, nextQuestionId }]
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
    questions: [makeQuestion()],
  }
}

function mapSurveyToBuilderState(survey: SurveyItem): BuilderState {
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
    questions: survey.questions.length
      ? survey.questions.map((question) => ({
          id: question.id,
          title: question.title,
          description: question.description ?? '',
          type: question.type,
          required: question.required,
          options: question.options?.length ? question.options : [],
          flowRules: question.flowRules ?? [],
        }))
      : [makeQuestion()],
  }
}

export function SurveyBuilderPage() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const isEditing = Boolean(params.id)
  const [form, setForm] = useState<BuilderState>(makeEmptyBuilderState)
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

  const saveMutation = useMutation({
    mutationFn: async (shouldPublish: boolean) => {
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
        questions: form.questions.map((question, index) => ({
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
            question.type === 'yes_no' || question.type === 'single_choice'
              ? question.flowRules.filter((rule) => rule.value.trim() && rule.nextQuestionId.trim())
              : [],
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

  function addQuestion() {
    setForm((current) => ({
      ...current,
      questions: [...current.questions, makeQuestion()],
    }))
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
      }
    })
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
        Ver previa
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
        disabled={saveMutation.isPending}
        className="admin-button-primary"
      >
        <Sparkles className="h-4 w-4" />
        {saveMutation.isPending ? 'Salvando...' : 'Salvar rascunho'}
      </button>
      <button
        type="button"
        onClick={() => void saveMutation.mutateAsync(true)}
        disabled={saveMutation.isPending}
        className="admin-button"
      >
        <Share2 className="h-4 w-4" />
        Salvar e publicar
      </button>
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
      title={params.id ? 'Editor de pesquisa' : 'Nova pesquisa'}
      subtitle="Organize sua pesquisa em blocos claros, revise as perguntas e publique somente quando tudo estiver pronto."
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
            saveMutation.isError || uploadMutation.isError || removeUploadMutation.isError
              ? 'border border-rose-200 bg-rose-50 text-rose-900'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {feedback}
        </div>
      ) : null}

      <section className="admin-page-hero mb-6 grid gap-3 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Criação guiada</p>
          <h2 className="mt-1 font-display text-[22px] leading-tight text-slate-950">
            Monte a pesquisa em um editor mais limpo e fácil de entender.
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] text-slate-600">
            A ideia aqui é deixar cada bloco com uma função clara: dados da pesquisa, visual, regras e perguntas em sequência.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Perguntas</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{form.questions.length}</p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Roleta</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{form.rewardEnabled ? 'Ativada' : 'Desligada'}</p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Slug</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-950">{form.slug || 'Ainda não definido'}</p>
          </div>
        </div>
      </section>

      {false ? (
      <section className="mb-6 overflow-hidden border border-slate-200 bg-white shadow-card" style={{ borderRadius: 8 }}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">PrÃ©via visual</p>
            <p className="mt-1 text-sm text-slate-600">Acompanhe ao vivo como a identidade da pesquisa estÃ¡ ficando.</p>
          </div>
          <span className="builder-question-meta builder-question-meta-primary">Atualiza automaticamente</span>
        </div>

        <div className="grid gap-4 p-4 xl:grid-cols-[1.15fr_0.85fr]">
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
                      <img src={form.logoUrl} alt="Logo da prÃ©via da pesquisa" className="h-full w-full object-contain" />
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
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/70">
                      {form.brandName.trim() || 'Sua marca'}
                    </p>
                    <p className="mt-1 text-sm font-medium text-white/90">
                      /s/{form.slug.trim() || 'seu-link-aqui'}
                    </p>
                  </div>
                </div>

                <span className="border border-white/30 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ borderRadius: 999 }}>
                  {form.rewardEnabled ? 'Com roleta' : 'Pesquisa simples'}
                </span>
              </div>

              <div className="max-w-2xl">
                <h3 className="text-2xl font-semibold leading-tight sm:text-3xl">
                  {form.title.trim() || 'O tÃ­tulo da sua pesquisa aparecerÃ¡ aqui'}
                </h3>
                <p className="mt-3 max-w-xl text-sm leading-6 text-white/85">
                  {form.description.trim() || 'Use a descriÃ§Ã£o para explicar rapidamente o objetivo da pesquisa e orientar o participante.'}
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="border border-white/25 bg-white/10 px-3 py-1 text-xs text-white/90" style={{ borderRadius: 999 }}>
                    Nome e WhatsApp obrigatÃ³rios
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
                  {form.questions[0]?.title?.trim() || 'A primeira pergunta aparecerÃ¡ aqui'}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {form.questions[0]?.description?.trim() || 'VocÃª pode usar a descriÃ§Ã£o de apoio para orientar a resposta do cliente.'}
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
      </section>
      ) : null}

      {params.id && form.slug && isPublishedSurvey ? (
        <div className="mb-6">
          <SurveyShareCard
            surveyId={params.id}
            slug={form.slug}
            linkClicks={survey?.linkClicks ?? 0}
            qrScans={survey?.qrScans ?? 0}
          />
        </div>
      ) : null}

      {params.id && !isPublishedSurvey ? (
        <div className="admin-alert mb-6 border-sky-200 bg-sky-50 text-sky-900">
          Esta pesquisa ainda não está publicada. Use <strong>Testar pesquisa</strong> para validar a experiência antes de colocar o link no ar.
        </div>
      ) : null}

      <div className="admin-alert mb-6 border-amber-200 bg-amber-50 text-amber-900">
        <strong>Salvar rascunho</strong> salva tudo o que você fez, mas <strong>não publica</strong> a pesquisa.
        Use <strong>Salvar e publicar</strong> somente quando o link já puder receber respostas.
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        {actionButtons}
      </div>

      <AdminModal
        open={previewOpen}
        title="Previa da pesquisa"
        description="Confira como a identidade e a abertura da pesquisa estao ficando antes de publicar."
        onClose={() => setPreviewOpen(false)}
      >
        {previewContent}
      </AdminModal>

      <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="builder-step-card builder-step-card-blue">
          <div className="mb-3 flex items-center gap-3">
            <div className="admin-icon-chip builder-chip-blue">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Passo 1</p>
              <p className="text-sm font-semibold text-slate-950">Dados principais</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">Defina título, descrição e o nome que vai aparecer para o cliente.</p>
        </article>

        <article className="builder-step-card builder-step-card-violet">
          <div className="mb-3 flex items-center gap-3">
            <div className="admin-icon-chip builder-chip-violet">
              <Link2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Passo 2</p>
              <p className="text-sm font-semibold text-slate-950">Link e visual</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">Escolha o slug, a cor principal e envie a logo e o banner da pesquisa.</p>
        </article>

        <article className="builder-step-card builder-step-card-amber">
          <div className="mb-3 flex items-center gap-3">
            <div className="admin-icon-chip builder-chip-amber">
              <Settings2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Passo 3</p>
              <p className="text-sm font-semibold text-slate-950">Perguntas</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">Adicione as perguntas na ordem da resposta e ajuste opções e fluxo quando precisar.</p>
        </article>

        <article className="builder-step-card builder-step-card-emerald">
          <div className="mb-3 flex items-center gap-3">
            <div className="admin-icon-chip builder-chip-emerald">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Passo 4</p>
              <p className="text-sm font-semibold text-slate-950">Salvar</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">Use rascunho para continuar depois. Publique somente quando o link estiver pronto.</p>
        </article>
      </section>

      <div className="builder-sheet">
        <SectionCard
          eyebrow="Configuração"
          title="Dados principais"
          description="Preencha os dados da pesquisa em uma sequência simples, como um formulário bem guiado."
        >
          <div className="grid gap-4">
            <div className="admin-alert border-sky-200 bg-sky-50 text-sky-900">
              Preencha primeiro o básico. Depois ajuste o visual e finalize com as regras da pesquisa.
            </div>
            <div className="admin-subcard builder-subcard-blue grid gap-4">
              <div>
                <p className="text-sm font-semibold text-sky-950">1. Identificação da pesquisa</p>
                <p className="mt-1 text-sm text-slate-600">
                  Essas informações aparecem no topo da pesquisa e ajudam o cliente a entender do que se trata.
                </p>
              </div>

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

              <label className="grid gap-2 text-sm">
                <span className="text-slate-600">Nome da marca</span>
                <input
                  className="admin-input"
                  value={form.brandName}
                  placeholder="Ex.: Loja Exemplo"
                  onChange={(event) => updateForm('brandName', event.target.value)}
                />
              </label>
            </div>

            <div className="admin-subcard builder-subcard-violet grid gap-4">
              <div className="flex items-center gap-3">
                <div className="admin-icon-chip builder-chip-violet">
                  <Palette className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-violet-950">2. Link e aparência</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Defina o endereço da pesquisa e deixe a identidade visual alinhada com a marca.
                  </p>
                </div>
              </div>

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
                <span className="text-xs text-slate-500">
                  Link final: <strong>/s/{form.slug || 'seu-link-aqui'}</strong>
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-[120px_1fr]">
                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Cor principal</span>
                  <input
                    type="color"
                    className="h-11 w-full cursor-pointer border border-slate-300 bg-white p-1"
                    value={form.primaryColor}
                    onChange={(event) => updateForm('primaryColor', event.target.value)}
                    style={{ borderRadius: 6 }}
                  />
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Código da cor principal</span>
                  <div className="flex gap-3">
                    <input
                      className="admin-input"
                      value={form.primaryColor}
                      placeholder="#0b5cff"
                      onChange={(event) => updateForm('primaryColor', event.target.value)}
                    />
                    <div
                      className="h-10 w-12 shrink-0 border border-slate-300 bg-white"
                      style={{ borderRadius: 6, backgroundColor: form.primaryColor || '#0b5cff' }}
                    />
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
                  <span className="text-xs text-slate-500">
                    Clique na cor para abrir o seletor completo ou escolha uma cor pronta abaixo.
                  </span>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-3 border border-slate-200 bg-white p-4" style={{ borderRadius: 6 }}>
                  <div className="flex items-start gap-3">
                    <div className="admin-icon-chip builder-chip-violet">
                      <FileImage className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-950">Logo da pesquisa</p>
                      <p className="mt-1 text-sm text-slate-600">Envie a logo da marca para aparecer no topo da página.</p>
                      <p className="mt-1 text-xs text-slate-500">Medida recomendada: 320 x 120 px.</p>
                    </div>
                  </div>

                  {form.logoUrl ? (
                    <div className="flex min-h-24 items-center justify-center border border-slate-200 bg-slate-50 px-4 py-3" style={{ borderRadius: 6 }}>
                      <img src={form.logoUrl} alt="Preview da logo da pesquisa" className="h-14 w-auto max-w-full object-contain" />
                    </div>
                  ) : (
                    <div className="flex min-h-24 items-center justify-center border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400" style={{ borderRadius: 6 }}>
                      Nenhuma logo enviada ainda.
                    </div>
                  )}

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
                      {removeUploadMutation.isPending && removingKey === 'logo' ? 'Removendo...' : 'Remover logo'}
                    </button>
                  </div>

                  <p className="text-xs text-slate-500">
                    {uploadingKey === 'logo' && uploadMutation.isPending
                      ? 'Enviando logo...'
                      : form.logoUrl || 'PNG, JPG, SVG ou WEBP. Tamanho máximo de 3 MB.'}
                  </p>
                  {uploadErrors.logo ? <p className="text-xs text-rose-600">{uploadErrors.logo}</p> : null}
                </div>

                <div className="grid gap-3 border border-slate-200 bg-white p-4" style={{ borderRadius: 6 }}>
                  <div className="flex items-start gap-3">
                    <div className="admin-icon-chip builder-chip-violet">
                      <Upload className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-950">Banner da pesquisa</p>
                      <p className="mt-1 text-sm text-slate-600">Envie um banner horizontal para destacar a campanha.</p>
                      <p className="mt-1 text-xs text-slate-500">Medida recomendada: 1600 x 400 px.</p>
                    </div>
                  </div>

                  {form.bannerUrl ? (
                    <div className="flex min-h-28 items-center justify-center overflow-hidden border border-slate-200 bg-slate-50" style={{ borderRadius: 6 }}>
                      <img src={form.bannerUrl} alt="Preview do banner da pesquisa" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex min-h-28 items-center justify-center border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400" style={{ borderRadius: 6 }}>
                      Nenhum banner enviado ainda.
                    </div>
                  )}

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
                      {removeUploadMutation.isPending && removingKey === 'banner' ? 'Removendo...' : 'Remover banner'}
                    </button>
                  </div>

                  <p className="text-xs text-slate-500">
                    {uploadingKey === 'banner' && uploadMutation.isPending
                      ? 'Enviando banner...'
                      : form.bannerUrl || 'PNG, JPG, SVG ou WEBP. Tamanho máximo de 3 MB.'}
                  </p>
                  {uploadErrors.banner ? <p className="text-xs text-rose-600">{uploadErrors.banner}</p> : null}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Caminho interno da logo</span>
                  <input
                    className="admin-input"
                    value={form.logoUrl}
                    placeholder="A logo enviada aparece aqui automaticamente."
                    readOnly
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="text-slate-600">Caminho interno do banner</span>
                  <input
                    className="admin-input"
                    value={form.bannerUrl}
                    placeholder="O banner enviado aparece aqui automaticamente."
                    readOnly
                  />
                </label>
              </div>
            </div>

            <div className="admin-subcard builder-subcard-amber grid gap-4">
              <div>
                <p className="text-sm font-semibold text-amber-950">3. Regras e finalização</p>
                <p className="mt-1 text-sm text-slate-600">
                  Aqui você define como a pesquisa funciona e qual mensagem aparece ao final da resposta.
                </p>
              </div>

              <label className="grid gap-2 text-sm">
                <span className="text-slate-600">Modo de participação</span>
                <select
                  className="admin-select"
                  value="identified"
                  disabled
                >
                  <option value="identified">Identificada com nome e telefone</option>
                </select>
                <span className="text-xs text-slate-500">
                  Esse modelo mantém nome e WhatsApp obrigatórios para facilitar relatórios e controle da roleta.
                </span>
              </label>

              <label className="admin-checkrow">
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
                  <span className="text-slate-500">
                    Quando estiver ativa, a mesma pessoa pode responder novamente, mas não gira outra vez com o mesmo WhatsApp ou e-mail.
                  </span>
                </span>
              </label>

              <div className="admin-alert border-sky-200 bg-sky-50 text-sky-900">
                Toda pesquisa publicada coleta <strong>nome e WhatsApp</strong> obrigatórios, além de <strong>e-mail opcional</strong> e <strong>aniversário</strong>.
              </div>

              {form.rewardEnabled ? (
                <div className="admin-alert border-emerald-200 bg-emerald-50 text-emerald-900">
                  Depois de salvar a pesquisa, use o botão <strong>Configurar prêmios</strong> para cadastrar a campanha e os itens da roleta.
                </div>
              ) : null}

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
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Estrutura"
          title="Perguntas da pesquisa"
          description="Cada pergunta fica em um bloco próprio para facilitar leitura, edição e revisão."
        >
          <div className="admin-alert mb-4 border-amber-200 bg-amber-50 text-amber-900">
            Dica: comece pelas perguntas mais importantes. Se uma resposta precisar pular etapas, use o fluxo condicional.
          </div>

          <div className="space-y-4">
            {form.questions.map((question, index) => (
              (() => {
                const nextQuestions = form.questions.slice(index + 1)
                const flowValues = getQuestionFlowValues(question)

                return (
                  <article key={question.id} className="builder-question-card">
                    <div
                      className="builder-section-topbar"
                      style={{
                        background: `linear-gradient(90deg, ${form.primaryColor || '#0b5cff'} 0%, rgba(255,255,255,0.95) 100%)`,
                      }}
                    />
                    <div className="p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Pergunta {index + 1}</p>
                        <p className="mt-2 font-semibold text-slate-950">{question.title || 'Sem título ainda'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="builder-question-meta builder-question-meta-primary">{questionTypeLabels[question.type]}</span>
                        <span className="builder-question-meta builder-question-meta-muted">
                          {question.required ? 'Obrigatória' : 'Opcional'}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeQuestion(index)}
                          className="admin-button-danger px-3 py-1 text-xs"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remover
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4">
                      <label className="grid gap-2 text-sm">
                        <span className="text-slate-600">Título da pergunta</span>
                        <input
                          className="admin-input"
                          value={question.title}
                          placeholder="Ex.: Como você avalia seu atendimento?"
                          onChange={(event) =>
                            updateQuestion(index, (current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                        />
                      </label>

                      <label className="grid gap-2 text-sm">
                        <span className="text-slate-600">Descrição de apoio</span>
                        <textarea
                          className="admin-input min-h-20"
                          value={question.description}
                          placeholder="Use esse campo se quiser orientar o cliente sobre como responder."
                          onChange={(event) =>
                            updateQuestion(index, (current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                        />
                      </label>

                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="grid gap-2 text-sm">
                          <span className="text-slate-600">Tipo</span>
                          <select
                            className="admin-select"
                            value={question.type}
                            onChange={(event) =>
                              updateQuestion(index, (current) => {
                                const type = event.target.value as QuestionType
                                const needsOptions = type === 'single_choice' || type === 'multiple_choice'

                                return {
                                  ...current,
                                  type,
                                  options: needsOptions ? (current.options.length ? current.options : ['']) : [],
                                  flowRules: [],
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
                            checked={question.required}
                            onChange={(event) =>
                              updateQuestion(index, (current) => ({
                                ...current,
                                required: event.target.checked,
                              }))
                            }
                          />
                          Obrigatória
                        </label>
                      </div>

                      {question.type === 'single_choice' || question.type === 'multiple_choice' ? (
                        <div className="builder-soft-panel">
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-950">Opções de resposta</p>
                            <button
                              type="button"
                              onClick={() => addOption(index)}
                              className="admin-button px-3 py-2 text-xs"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Nova opção
                            </button>
                          </div>

                          <div className="space-y-3">
                            {question.options.map((option, optionIndex) => (
                              <div key={`${question.id}-${optionIndex}`} className="flex gap-3">
                                <input
                                  className="admin-input flex-1 bg-slate-50"
                                  value={option}
                                  placeholder={`Opção ${optionIndex + 1}`}
                                  onChange={(event) =>
                                    updateQuestion(index, (current) => {
                                      const previousValue = current.options[optionIndex] ?? ''
                                      const nextValue = event.target.value

                                      return {
                                        ...current,
                                        options: current.options.map((item, itemIndex) =>
                                          itemIndex === optionIndex ? nextValue : item,
                                        ),
                                        flowRules: current.flowRules.map((rule) =>
                                          rule.value === previousValue ? { ...rule, value: nextValue } : rule,
                                        ),
                                      }
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  onClick={() => removeOption(index, optionIndex)}
                                  className="admin-button-danger px-3 py-2 text-xs"
                                >
                                  Remover
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {supportsQuestionFlow(question.type) ? (
                        <div className="builder-soft-panel">
                          <div className="mb-4">
                            <p className="text-sm font-semibold text-slate-950">Fluxo da pergunta</p>
                            <p className="mt-1 text-sm text-slate-600">
                              Defina para onde o formulário vai quando esta pergunta receber uma resposta específica. Este fluxo vale para
                              perguntas de Sim/Não e Escolha única.
                            </p>
                          </div>

                          {flowValues.length ? (
                            <div className="space-y-3">
                              {flowValues.map((flowValue) => {
                                const selectedTarget =
                                  question.flowRules.find((rule) => rule.value === flowValue)?.nextQuestionId ?? ''

                                return (
                                  <label key={`${question.id}-${flowValue}`} className="grid gap-2 text-sm">
                                    <span className="text-slate-600">Se responder "{flowValue}", ir para</span>
                                    <select
                                      className="admin-select"
                                      value={selectedTarget}
                                      onChange={(event) =>
                                        updateQuestion(index, (current) => ({
                                          ...current,
                                          flowRules: updateFlowRuleList(current.flowRules, flowValue, event.target.value),
                                        }))
                                      }
                                    >
                                      <option value="">Próxima pergunta normal</option>
                                      <option value={FLOW_END}>Encerrar pesquisa após esta resposta</option>
                                      {nextQuestions.map((targetQuestion, targetIndex) => (
                                        <option key={targetQuestion.id} value={targetQuestion.id}>
                                          Pergunta {index + targetIndex + 2}: {targetQuestion.title || 'Sem título ainda'}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="builder-soft-panel">
                              Preencha as opções da pergunta para liberar o fluxo condicional.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                    </div>
                  </article>
                )
              })()
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={addQuestion}
              className="admin-button border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
            >
              <Plus className="h-4 w-4" />
              Adicionar pergunta
            </button>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6">
        <div className="admin-alert mb-4 border-slate-200 bg-slate-50 text-slate-700">
          Terminou de ajustar as perguntas? <strong>Salvar rascunho</strong> guarda a pesquisa sem publicar.{' '}
          <strong>Salvar e publicar</strong> já coloca o link no ar.
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          {actionButtons}
        </div>
      </div>
    </AppShell>
  )
}
