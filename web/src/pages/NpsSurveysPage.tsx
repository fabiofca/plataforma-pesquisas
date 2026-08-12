import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, ChevronRight, ClipboardList, MessageSquareText, ThumbsDown, ThumbsUp } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { AdminModal } from '@/components/ui/AdminModal'
import { SectionCard } from '@/components/ui/SectionCard'
import { apiRequest } from '@/lib/api-client'
import { mapApiSurvey } from '@/lib/mappers'
import { buildNpsSurveyPayload, createEmptySurveyForm, slugify, type SurveyCreateFormState } from '@/lib/survey-templates'

type NpsOverview = {
  surveys: number
  responses: number
  averageScore: number
  npsScore: number
  promoters: number
  neutrals: number
  detractors: number
  topSurvey: {
    id: string
    title: string
    score: number
    responses: number
  } | null
  explanation: string
  classification: string
}

const emptySurveyForm = createEmptySurveyForm({
  title: 'Pesquisa NPS',
  description: 'Modelo NPS para medir recomendação com pergunta principal e espaço para comentário.',
})

function getNpsTone(score: number) {
  if (score >= 75) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  }

  if (score >= 50) {
    return 'border-sky-200 bg-sky-50 text-sky-900'
  }

  if (score >= 0) {
    return 'border-amber-200 bg-amber-50 text-amber-900'
  }

  return 'border-rose-200 bg-rose-50 text-rose-900'
}

export function NpsSurveysPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isSlugDirty, setIsSlugDirty] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [createForm, setCreateForm] = useState<SurveyCreateFormState>(emptySurveyForm)

  const surveysQuery = useQuery({
    queryKey: ['surveys'],
    queryFn: async () => {
      const response = await apiRequest<{
        surveys: Array<{
          id: string
          survey_kind?: string
          title: string
          description?: string | null
          status: string
          participation_mode: string
          primary_color: string
          reward_enabled: boolean
          slug: string | null
          responses: string
          link_clicks: string
          qr_scans: string
        }>
      }>('/surveys')

      return response.surveys.map(mapApiSurvey)
    },
    retry: 0,
  })

  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'nps-overview'],
    queryFn: async () => {
      const response = await apiRequest<{ summary: NpsOverview }>('/reports/nps-overview')
      return response.summary
    },
    retry: 0,
  })

  const createSurveyMutation = useMutation({
    mutationFn: async () => {
      const created = await apiRequest<{ id: string }>('/surveys', {
        method: 'POST',
        body: JSON.stringify(buildNpsSurveyPayload(createForm)),
      })

      return created.id
    },
    onSuccess: async (surveyId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'nps-overview'] }),
      ])
      setIsCreateModalOpen(false)
      setIsSlugDirty(false)
      setCreateForm(emptySurveyForm)
      navigate(`/app/pesquisas/${surveyId}/editar`, {
        state: { feedback: 'Pesquisa NPS criada com boas práticas. Agora você pode ajustar os detalhes finais.' },
      })
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível criar a pesquisa NPS.')
    },
  })

  const npsSurveys = (surveysQuery.data ?? []).filter((survey) => survey.kind === 'nps')
  const overview = overviewQuery.data

  function handleOpenCreateModal() {
    setFeedback('')
    setIsSlugDirty(false)
    setCreateForm(emptySurveyForm)
    setIsCreateModalOpen(true)
  }

  function handleCloseCreateModal() {
    setIsCreateModalOpen(false)
    setIsSlugDirty(false)
    setCreateForm(emptySurveyForm)
  }

  return (
    <AppShell
      title="Pesquisas NPS"
      subtitle="Página separada para NPS, com modelo pronto, leitura simples e indicadores fáceis de entender."
      backHref="/app/pesquisas"
      backLabel="Voltar para pesquisas"
      breadcrumbs={[
        { label: 'Pesquisas', href: '/app/pesquisas' },
        { label: 'NPS' },
      ]}
    >
      <AdminModal
        open={isCreateModalOpen}
        title="Nova pesquisa NPS"
        description="Este modelo já nasce com a pergunta NPS correta, explicação da escala e campos abertos para entender o motivo da nota."
        onClose={handleCloseCreateModal}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void createSurveyMutation.mutateAsync()
          }}
        >
          <label className="grid gap-2 text-sm">
            <span className="text-slate-600">Título da pesquisa</span>
            <input
              className="admin-input"
              value={createForm.title}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  title: event.target.value,
                  slug: isSlugDirty ? current.slug : slugify(event.target.value),
                }))
              }
              required
            />
          </label>

          <label className="grid gap-2 text-sm">
            <span className="text-slate-600">Descrição</span>
            <textarea
              className="admin-input min-h-24"
              value={createForm.description}
              onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Slug</span>
              <input
                className="admin-input"
                value={createForm.slug}
                onChange={(event) => {
                  setIsSlugDirty(true)
                  setCreateForm((current) => ({ ...current, slug: slugify(event.target.value) }))
                }}
                required
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Nome da marca</span>
              <input
                className="admin-input"
                value={createForm.brandName}
                onChange={(event) => setCreateForm((current) => ({ ...current, brandName: event.target.value }))}
                required
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="text-slate-600">Cor principal</span>
            <input
              className="admin-input"
              value={createForm.primaryColor}
              onChange={(event) => setCreateForm((current) => ({ ...current, primaryColor: event.target.value }))}
              required
            />
          </label>

          <div className="admin-alert border-sky-200 bg-sky-50 text-sky-900">
            O modelo NPS será criado com a pergunta de recomendação de 0 a 10 e campos abertos para entender o motivo da nota.
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" onClick={handleCloseCreateModal} className="admin-button">
              Cancelar
            </button>

            <button type="submit" disabled={createSurveyMutation.isPending} className="admin-button-primary">
              {createSurveyMutation.isPending ? 'Criando...' : 'Criar pesquisa NPS'}
            </button>
          </div>
        </form>
      </AdminModal>

      {feedback ? <div className="admin-alert mb-6 border-rose-200 bg-rose-50 text-rose-900">{feedback}</div> : null}

      <section className="admin-page-hero mb-6 grid gap-3 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Experiência do cliente</p>
          <h2 className="mt-1 font-display text-[22px] leading-tight text-slate-950">
            Meça recomendação com um visual mais claro, elegante e fácil de explicar.
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] text-slate-600">
            Esta área concentra as pesquisas NPS com modelo pronto, leitura direta e métricas que ajudam o cliente a entender o resultado sem esforço.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Pesquisas NPS</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{npsSurveys.length} campanha(s)</p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Notas válidas</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{overview?.responses ?? 0}</p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Leitura atual</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{overview?.classification ?? 'Sem leitura'}</p>
          </div>
        </div>
      </section>

      <div className="mb-6 flex flex-wrap justify-end gap-3">
        <Link to="/app/pesquisas" className="admin-button">
          Ir para pesquisas personalizadas
        </Link>
        <button type="button" onClick={handleOpenCreateModal} className="admin-button-primary">
          Nova pesquisa NPS
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_0.95fr]">
        <SectionCard
          eyebrow="O que é NPS"
          title="Uma pergunta direta para medir lealdade"
          description="NPS pergunta o quanto o cliente indicaria sua empresa para outra pessoa. A resposta vai de 0 a 10."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <div className="admin-subcard">
              <div className="flex items-center gap-2 text-rose-700">
                <ThumbsDown className="h-4 w-4" />
                <p className="text-sm font-semibold">0 a 6: Detratores</p>
              </div>
              <p className="mt-1 text-sm text-slate-600">Clientes insatisfeitos ou em risco de sair.</p>
            </div>
            <div className="admin-subcard">
              <div className="flex items-center gap-2 text-amber-700">
                <BarChart3 className="h-4 w-4" />
                <p className="text-sm font-semibold">7 e 8: Neutros</p>
              </div>
              <p className="mt-1 text-sm text-slate-600">Clientes satisfeitos, mas ainda sem forte defesa da marca.</p>
            </div>
            <div className="admin-subcard">
              <div className="flex items-center gap-2 text-emerald-700">
                <ThumbsUp className="h-4 w-4" />
                <p className="text-sm font-semibold">9 e 10: Promotores</p>
              </div>
              <p className="mt-1 text-sm text-slate-600">Clientes que tendem a indicar sua empresa com segurança.</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Boas práticas"
          title="Modelo pronto para uso"
          description="A página NPS já nasce com a estrutura mais comum para medir recomendação com clareza."
        >
          <div className="space-y-3">
            <div className="admin-subcard">
              <div className="flex items-center gap-2 text-slate-950">
                <ClipboardList className="h-4 w-4" />
                <p className="text-sm font-semibold">1. Pergunta principal na escala correta</p>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                A pergunta principal usa a escala de 0 a 10 com explicação direta para evitar dúvida.
              </p>
            </div>
            <div className="admin-subcard">
              <div className="flex items-center gap-2 text-slate-950">
                <MessageSquareText className="h-4 w-4" />
                <p className="text-sm font-semibold">2. Campo aberto para entender o motivo</p>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Além da nota, a pesquisa já traz um espaço para o cliente explicar o motivo da resposta.
              </p>
            </div>
            <div className="admin-subcard">
              <div className="flex items-center gap-2 text-slate-950">
                <BarChart3 className="h-4 w-4" />
                <p className="text-sm font-semibold">3. Leitura pronta no painel</p>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                O dashboard passa a mostrar a nota NPS, a leitura geral e a divisão entre promotores, neutros e detratores.
              </p>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className={`admin-highlight-card ${getNpsTone(overview?.npsScore ?? 0)}`}>
          <p className="text-[11px] uppercase tracking-[0.16em]">NPS atual</p>
          <p className="mt-2 font-display text-4xl">{overview?.npsScore ?? 0}</p>
          <p className="mt-1 text-sm">{overview?.classification ?? 'Sem leitura ainda'}</p>
        </div>
        <div className="admin-stat-card">
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Respostas NPS</p>
          <p className="mt-2 font-display text-4xl text-slate-950">{overview?.responses ?? 0}</p>
          <p className="mt-1 text-sm text-slate-600">Notas válidas somadas nas pesquisas NPS.</p>
        </div>
        <div className="admin-stat-card">
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Promotores</p>
          <p className="mt-2 font-display text-4xl text-slate-950">{overview?.promoters ?? 0}</p>
          <p className="mt-1 text-sm text-slate-600">Clientes que deram nota 9 ou 10.</p>
        </div>
        <div className="admin-stat-card">
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Detratores</p>
          <p className="mt-2 font-display text-4xl text-slate-950">{overview?.detractors ?? 0}</p>
          <p className="mt-1 text-sm text-slate-600">Clientes que deram nota entre 0 e 6.</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard eyebrow="Leitura rápida" title="Como entender esse número" description="Explicação curta para o cliente bater o olho e entender.">
          <div className="space-y-3">
            <div className={`admin-highlight-card ${getNpsTone(overview?.npsScore ?? 0)}`}>
              <p className="text-sm font-semibold">{overview?.classification ?? 'Sem dados suficientes ainda'}</p>
              <p className="mt-1 text-sm">{overview?.explanation ?? 'Assim que entrarem respostas, a leitura aparece aqui.'}</p>
            </div>
            <div className="admin-subcard">
              <p className="text-sm font-semibold text-slate-950">Média das notas</p>
              <p className="mt-1 text-sm text-slate-600">
                {overview ? `A média atual das notas é ${overview.averageScore}.` : 'A média aparece quando a pesquisa começar a receber notas.'}
              </p>
            </div>
            <div className="admin-subcard">
              <p className="text-sm font-semibold text-slate-950">Melhor pesquisa NPS</p>
              <p className="mt-1 text-sm text-slate-600">
                {overview?.topSurvey
                  ? `${overview.topSurvey.title} está com NPS ${overview.topSurvey.score} em ${overview.topSurvey.responses} resposta(s).`
                  : 'Quando existir uma pesquisa NPS com respostas, o destaque aparece aqui.'}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Pesquisas NPS" title="Campanhas criadas" description="Lista direta das pesquisas NPS já cadastradas.">
          {surveysQuery.isError ? (
            <div className="admin-alert border-amber-200 bg-amber-50 text-amber-900">
              Não foi possível carregar as pesquisas NPS agora. Verifique a API e tente novamente.
            </div>
          ) : !npsSurveys.length ? (
            <div className="admin-empty-state">
              Nenhuma pesquisa NPS cadastrada ainda. Use o botão acima para criar um modelo pronto.
            </div>
          ) : (
            <div className="space-y-3">
              {npsSurveys.map((survey) => (
                <Link key={survey.id} to={`/app/pesquisas/${survey.id}`} className="admin-panel block overflow-hidden transition hover:border-slate-300 hover:bg-white">
                  <div className="flex w-full flex-col gap-3 p-4 text-left sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">{survey.title}</p>
                      <p className="mt-1 truncate text-sm text-slate-500">/{survey.slug}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <span className="admin-badge bg-white">{survey.responses} resposta(s)</span>
                      <span className="admin-badge bg-white">NPS</span>
                      <span className="admin-badge border-slate-900 bg-slate-950 text-white">{survey.status}</span>
                      <span className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-slate-600" style={{ borderRadius: 8 }}>
                        <ChevronRight className="h-4 w-4" />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  )
}
