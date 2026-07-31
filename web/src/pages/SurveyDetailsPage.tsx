import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  ExternalLink,
  Gift,
  ListChecks,
  PencilLine,
  Rocket,
  Share2,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { SurveyNavBar } from '@/components/surveys/SurveyNavBar'
import { SurveyPreviewLinkCard } from '@/components/ui/SurveyPreviewLinkCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { SurveyShareCard } from '@/components/ui/SurveyShareCard'
import { apiRequest } from '@/lib/api-client'
import { mapApiSurvey } from '@/lib/mappers'
import { getPublicSurveyPath, getSurveyTestPath } from '@/lib/public-survey'

type SurveyTab = 'summary' | 'questions' | 'share' | 'results' | 'flow' | 'prizes'

type SummaryResponse = {
  summary: {
    total_responses: string
    identified_responses: string
    reward_wins: string
    emails_collected: string
    birthdays_collected: string
    link_clicks: string
    qr_scans: string
    total_visits: string
    conversion_rate: string
  }
}

function formatDateInput(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getDateDaysAgo(daysAgo: number) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date
}

function getQuestionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    short_text: 'Texto curto',
    long_text: 'Texto longo',
    single_choice: 'Escolha única',
    multiple_choice: 'Múltipla escolha',
    yes_no: 'Sim ou não',
    rating_1_5: 'Nota de 1 a 5',
    nps: 'NPS',
  }

  return labels[type] ?? type
}

export function SurveyDetailsPage() {
  const { id } = useParams()
  const location = useLocation()

  const hashToTab: Record<string, SurveyTab> = {
    '#perguntas': 'questions',
    '#compartilhar': 'share',
  }
  const initialTab = hashToTab[location.hash] ?? 'summary'
  const [activeTab, setActiveTab] = useState<SurveyTab>(initialTab)

  const handleTabClick = useCallback((tab: SurveyTab) => {
    setActiveTab(tab)
    const tabToHash: Record<string, string> = {
      questions: '#perguntas',
      share: '#compartilhar',
    }
    const hash = tabToHash[tab]
    if (hash) {
      window.history.replaceState(null, '', hash)
    } else {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const [feedback, setFeedback] = useState('')
  const queryClient = useQueryClient()

  const surveyQuery = useQuery({
    queryKey: ['survey', id],
    queryFn: async () => {
      const response = await apiRequest<{
        survey: {
          id: string
          survey_kind?: string
          title: string
          description?: string | null
          slug?: string | null
          status: string
          responses?: string | number
          participation_mode?: string
          reward_enabled?: boolean
          primary_color?: string
          questions?: Array<{
            id: string
            title: string
            description?: string | null
            type: string
            is_required?: boolean
            options?: string[]
            settings_json?: {
              flowRules?: Array<{
                value: string
                nextQuestionId: string
              }>
            }
          }>
          brand_name?: string
          logo_url?: string | null
          banner_url?: string | null
          closing_message?: string | null
          link_clicks?: string | number
          qr_scans?: string | number
          reward_items?: Array<{
            id: string
            title: string
          }>
        }
      }>(`/surveys/${id}`)

      return mapApiSurvey(response.survey)
    },
    enabled: Boolean(id),
    retry: 0,
  })

  const summaryQuery = useQuery({
    queryKey: ['survey-summary-preview', id],
    queryFn: async () => {
      const queryParams = new URLSearchParams({
        startDate: formatDateInput(getDateDaysAgo(29)),
        endDate: formatDateInput(getDateDaysAgo(0)),
      })

      return apiRequest<SummaryResponse>(`/surveys/${id}/reports/summary?${queryParams.toString()}`)
    },
    enabled: Boolean(id),
    retry: 0,
  })

  const survey = surveyQuery.data
  const questionsWithFlow = survey?.questions.filter((question) => question.flowRules?.length).length ?? 0
  const requiredQuestions = survey?.questions.filter((question) => question.required).length ?? 0
  const summary = summaryQuery.data?.summary
  const publicSurveyPath = survey?.slug ? getPublicSurveyPath(survey.slug) : ''
  const isPublishedSurvey = survey?.status === 'Publicada'
  const isDraftSurvey = survey?.status === 'Rascunho'
  const unpublishMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<{ ok: boolean }>(`/surveys/${id}/unpublish`, {
        method: 'POST',
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['survey', id] }),
        queryClient.invalidateQueries({ queryKey: ['survey-summary-preview', id] }),
      ])

      setFeedback('Pesquisa movida de volta para rascunho com sucesso.')
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível voltar a pesquisa para rascunho.')
    },
  })
  return (
    <AppShell
      title={survey?.title ?? 'Pesquisa'}
      subtitle=""
      hideHeader
    >
      {surveyQuery.isError ? (
        <div className="admin-alert mb-6 border-amber-200 bg-amber-50 text-amber-900">
          Não foi possível carregar esta pesquisa agora. Verifique a API e tente novamente.
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`admin-alert mb-6 ${
            unpublishMutation.isError ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {feedback}
        </div>
      ) : null}

      {survey ? (
        <>
          <SurveyNavBar
            surveyId={survey.id}
            surveyTitle={survey.title}
            activeTab={activeTab}
            onTabClick={handleTabClick}
          />

          <div className="p-3 sm:p-4 lg:p-5">
          {activeTab === 'summary' ? (
            <>
              <SectionCard
                eyebrow="Ações"
                title="O que deseja fazer agora"
                description="Atalhos rápidos para continuar o trabalho nessa pesquisa sem precisar voltar para a lista."
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Link to={`/app/pesquisas/${survey.id}/editar`} className="admin-action-card">
                    <div className="admin-icon-chip mb-3 border-blue-100 bg-blue-50 text-blue-700">
                      <PencilLine className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-semibold text-slate-950">Editar pesquisa</p>
                    <p className="mt-1 text-sm text-slate-600">Ajuste texto, perguntas, visual e fluxo.</p>
                  </Link>

                  <Link to={`/app/pesquisas/${survey.id}/relatorios`} className="admin-action-card">
                    <div className="admin-icon-chip mb-3 border-emerald-100 bg-emerald-50 text-emerald-700">
                      <BarChart3 className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-semibold text-slate-950">Ver relatórios</p>
                    <p className="mt-1 text-sm text-slate-600">Acompanhe respostas, conversão e desempenho.</p>
                  </Link>

                  {survey.rewardEnabled ? (
                    <Link to={`/app/pesquisas/${survey.id}/premios`} className="admin-action-card">
                      <div className="admin-icon-chip mb-3 border-violet-100 bg-violet-50 text-violet-700">
                        <Gift className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold text-slate-950">Configurar prêmios</p>
                      <p className="mt-1 text-sm text-slate-600">Revise campanha, frequência e demonstração.</p>
                    </Link>
                  ) : (
                    <div className="admin-action-card opacity-70">
                      <div className="admin-icon-chip mb-3 border-slate-200 bg-slate-50 text-slate-600">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold text-slate-950">Roleta desativada</p>
                      <p className="mt-1 text-sm text-slate-600">Ative a roleta no editor para liberar os prêmios.</p>
                    </div>
                  )}

                  <Link to={getSurveyTestPath(survey.id)} className="admin-action-card">
                    <div className="admin-icon-chip mb-3 border-sky-100 bg-sky-50 text-sky-700">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-semibold text-slate-950">Testar pesquisa</p>
                    <p className="mt-1 text-sm text-slate-600">Abra uma prévia funcional sem gravar respostas reais.</p>
                  </Link>

                  {isPublishedSurvey ? (
                    <a href={publicSurveyPath} target="_blank" rel="noreferrer" className="admin-action-card">
                      <div className="admin-icon-chip mb-3 border-amber-100 bg-amber-50 text-amber-700">
                        <Rocket className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold text-slate-950">Abrir pesquisa pública</p>
                      <p className="mt-1 text-sm text-slate-600">Veja exatamente como o participante enxerga a página.</p>
                    </a>
                  ) : null}

                  {isPublishedSurvey ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            'Deseja tirar esta pesquisa do ar e voltar para rascunho? O link público deixará de funcionar, mas as respostas já recebidas continuarão salvas.',
                          )
                        ) {
                          void unpublishMutation.mutateAsync()
                        }
                      }}
                      disabled={unpublishMutation.isPending}
                      className="admin-action-card text-left disabled:opacity-60"
                    >
                      <div className="admin-icon-chip mb-3 border-rose-100 bg-rose-50 text-rose-700">
                        <Share2 className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold text-slate-950">
                        {unpublishMutation.isPending ? 'Voltando para rascunho...' : 'Voltar para rascunho'}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">Tira a pesquisa do ar sem apagar respostas já recebidas.</p>
                    </button>
                  ) : null}
                </div>
              </SectionCard>

              <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <SectionCard
                  eyebrow="Resumo"
                  title="Informações principais"
                  description="Leitura direta do que está configurado hoje nesta pesquisa."
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="admin-subcard">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Marca</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">{survey.brandName || 'Não informada'}</p>
                    </div>
                    <div className="admin-subcard">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cor principal</p>
                      <div className="mt-2 flex items-center gap-3">
                        <span className="h-5 w-5 border border-slate-200" style={{ backgroundColor: survey.primaryColor, borderRadius: 4 }} />
                        <p className="text-sm font-semibold text-slate-950">{survey.primaryColor}</p>
                      </div>
                    </div>
                    <div className="admin-subcard">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tipo</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">
                        {survey.kind === 'nps' ? 'Pesquisa NPS' : 'Pesquisa personalizada'}
                      </p>
                    </div>
                    <div className="admin-subcard">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Atualização</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">{survey.updatedAt}</p>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  eyebrow="Estrutura"
                  title="Como a pesquisa está montada"
                  description="Leitura curta da composição atual para o usuário entender rapidamente o cenário."
                >
                  <div className="space-y-3">
                    <div className="admin-highlight-card">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Perguntas obrigatórias</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">{requiredQuestions}</p>
                      <p className="mt-1 text-sm text-slate-600">Campos que o participante precisa responder.</p>
                    </div>
                    <div className="admin-highlight-card">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Fluxos condicionais</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">{questionsWithFlow}</p>
                      <p className="mt-1 text-sm text-slate-600">Perguntas que já direcionam para outro caminho.</p>
                    </div>
                  </div>
                </SectionCard>
              </div>
            </>
          ) : null}

          {activeTab === 'questions' ? (
            <div className="mt-0">
              <SectionCard
                eyebrow="Perguntas"
                title="Estrutura atual da pesquisa"
                description="Lista rápida das perguntas cadastradas para o usuário saber o que já existe sem abrir o editor."
              >
                {survey.questions.length ? (
                  <div className="space-y-3">
                    {survey.questions.map((question, index) => (
                      <article key={question.id} className="admin-panel p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="admin-icon-chip border-slate-200 bg-white text-slate-700">
                                <ListChecks className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Pergunta {index + 1}</p>
                                <p className="mt-1 font-semibold text-slate-950">{question.title || 'Sem título'}</p>
                              </div>
                            </div>
                            {question.description ? <p className="mt-3 text-sm text-slate-600">{question.description}</p> : null}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <span className="admin-badge bg-white">{getQuestionTypeLabel(question.type)}</span>
                            <span className="admin-badge bg-white">{question.required ? 'Obrigatória' : 'Opcional'}</span>
                            {question.flowRules?.length ? <span className="admin-badge bg-white">Com fluxo</span> : null}
                          </div>
                        </div>

                        {question.options?.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {question.options.map((option) => (
                              <span key={`${question.id}-${option}`} className="admin-badge bg-white">
                                {option}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="admin-empty-state py-16">Esta pesquisa ainda não possui perguntas cadastradas.</div>
                )}
              </SectionCard>
            </div>
          ) : null}

          {activeTab === 'share' ? (
            <div className="mt-0">
              <SectionCard
                eyebrow="Compartilhamento"
                title="Link, QR code e abertura pública"
                description="Tudo pronto para divulgar com leitura rápida de cliques e QR scans."
              >
                <div className="mb-4">
                  <SurveyPreviewLinkCard surveyId={survey.id} isDraft={Boolean(isDraftSurvey)} />
                </div>

                {isPublishedSurvey ? (
                  <SurveyShareCard
                    surveyId={survey.id}
                    slug={survey.slug}
                    linkClicks={survey.linkClicks ?? 0}
                    qrScans={survey.qrScans ?? 0}
                  />
                ) : (
                  <div className="admin-alert border-sky-200 bg-sky-50 text-sky-900">
                    A pesquisa ainda está em rascunho. Teste à vontade no modo de prévia e publique somente quando o link já puder receber respostas reais.
                  </div>
                )}

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="admin-highlight-card">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cliques no link</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{survey.linkClicks ?? 0}</p>
                  </div>
                  <div className="admin-highlight-card">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Leituras do QR</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{survey.qrScans ?? 0}</p>
                  </div>
                  <div className="admin-highlight-card">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Página pública</p>
                    <div className="mt-3">
                      {isPublishedSurvey ? (
                        <a href={publicSurveyPath} target="_blank" rel="noreferrer" className="admin-button-primary">
                          <ExternalLink className="h-4 w-4" />
                          Abrir agora
                        </a>
                      ) : (
                        <Link to={getSurveyTestPath(survey.id)} className="admin-button-primary">
                          <Sparkles className="h-4 w-4" />
                          Testar agora
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>
          ) : null}

          {activeTab === 'results' ? (
            <div className="mt-0 grid gap-6 xl:grid-cols-[1fr_0.95fr]">
              <SectionCard
                eyebrow="Resultados"
                title="Leitura rápida da pesquisa"
                description="Um resumo direto do desempenho recente sem precisar abrir o relatório completo."
              >
                {summary ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="admin-highlight-card">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Respostas</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-950">{summary.total_responses}</p>
                      <p className="mt-1 text-sm text-slate-600">Participações válidas no recorte recente.</p>
                    </div>
                    <div className="admin-highlight-card">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Visitas</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-950">{summary.total_visits}</p>
                      <p className="mt-1 text-sm text-slate-600">Acessos somados da página pública.</p>
                    </div>
                    <div className="admin-highlight-card">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Conversão</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-950">{summary.conversion_rate}%</p>
                      <p className="mt-1 text-sm text-slate-600">Quanto das visitas virou resposta completa.</p>
                    </div>
                    <div className="admin-highlight-card">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Identificadas</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-950">{summary.identified_responses}</p>
                      <p className="mt-1 text-sm text-slate-600">Respostas com dados de contato preenchidos.</p>
                    </div>
                    <div className="admin-highlight-card">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">E-mails coletados</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-950">{summary.emails_collected}</p>
                      <p className="mt-1 text-sm text-slate-600">Participantes que também informaram e-mail.</p>
                    </div>
                    <div className="admin-highlight-card">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Aniversários</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-950">{summary.birthdays_collected}</p>
                      <p className="mt-1 text-sm text-slate-600">Base pronta para futuras campanhas de aniversário.</p>
                    </div>
                  </div>
                ) : (
                  <div className="admin-empty-state py-16">Carregando resultados recentes desta pesquisa.</div>
                )}
              </SectionCard>

              <SectionCard
                eyebrow="Próximos passos"
                title="Ações ligadas a resultado"
                description="Entre em relatórios completos, veja a roleta ou acompanhe a página pública."
              >
                <div className="space-y-3">
                  <Link to={`/app/pesquisas/${survey.id}/relatorios`} className="admin-action-card block">
                    <div className="admin-icon-chip mb-3 border-emerald-100 bg-emerald-50 text-emerald-700">
                      <BarChart3 className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-semibold text-slate-950">Abrir relatórios completos</p>
                    <p className="mt-1 text-sm text-slate-600">Veja filtros, séries temporais, ganhadores e exportações.</p>
                  </Link>

                  {survey.rewardEnabled ? (
                    <Link to={`/app/pesquisas/${survey.id}/premios`} className="admin-action-card block">
                      <div className="admin-icon-chip mb-3 border-violet-100 bg-violet-50 text-violet-700">
                        <Gift className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold text-slate-950">Revisar campanha da roleta</p>
                      <p className="mt-1 text-sm text-slate-600">Acompanhe a configuração dos prêmios e a demonstração visual.</p>
                    </Link>
                  ) : null}

                  <Link to={getSurveyTestPath(survey.id)} className="admin-action-card block">
                    <div className="admin-icon-chip mb-3 border-sky-100 bg-sky-50 text-sky-700">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-semibold text-slate-950">Testar experiência da pesquisa</p>
                    <p className="mt-1 text-sm text-slate-600">Valide perguntas, roleta e mensagens sem gerar respostas reais.</p>
                  </Link>

                  {isPublishedSurvey ? (
                    <a href={publicSurveyPath} target="_blank" rel="noreferrer" className="admin-action-card block">
                      <div className="admin-icon-chip mb-3 border-amber-100 bg-amber-50 text-amber-700">
                        <Rocket className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold text-slate-950">Abrir página pública</p>
                      <p className="mt-1 text-sm text-slate-600">Confirme a experiência do participante com a pesquisa no ar.</p>
                    </a>
                  ) : null}
                </div>
              </SectionCard>
            </div>
          ) : null}

          {activeTab === 'flow' ? (
            <div className="mt-0">
              <SectionCard
                eyebrow="Fluxo da pesquisa"
                title="Editor visual de conexões"
                description="Monte o caminho que o participante segue entre as perguntas arrastando e conectando os blocos."
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="admin-highlight-card">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Total de perguntas</p>
                    <p className="mt-2 text-3xl font-semibold text-slate-950">{survey.questions.length}</p>
                  </div>
                  <div className="admin-highlight-card">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Com fluxo condicional</p>
                    <p className="mt-2 text-3xl font-semibold text-slate-950">{questionsWithFlow}</p>
                  </div>
                  <div className="admin-highlight-card">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Obrigatórias</p>
                    <p className="mt-2 text-3xl font-semibold text-slate-950">{requiredQuestions}</p>
                  </div>
                </div>

                {questionsWithFlow > 0 ? (
                  <div className="mt-5 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Perguntas com fluxo configurado</p>
                    {survey.questions
                      .filter((question) => question.flowRules?.length)
                      .map((question, index) => (
                        <div key={question.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900">{question.title}</p>
                            <p className="text-xs text-slate-500">
                              {question.flowRules.length} {question.flowRules.length === 1 ? 'regra' : 'regras'} de fluxo
                            </p>
                          </div>
                          <Workflow className="h-4 w-4 shrink-0 text-slate-400" />
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                    <Workflow className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm text-slate-600">Nenhuma pergunta possui fluxo condicional configurado.</p>
                    <p className="mt-1 text-xs text-slate-500">Abra o editor visual para conectar as perguntas e definir caminhos.</p>
                  </div>
                )}

                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    to={`/app/pesquisas/${survey.id}/editar`}
                    className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    <Workflow className="h-4 w-4" />
                    Abrir editor de fluxo
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link to={getSurveyTestPath(survey.id)} className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-800 transition hover:bg-sky-100">
                    <Sparkles className="h-4 w-4" />
                    Testar fluxo
                  </Link>
                </div>
              </SectionCard>
            </div>
          ) : null}

          {activeTab === 'prizes' ? (
            <div className="mt-0">
              <SectionCard
                eyebrow="Campanha de prêmios"
                title="Roleta e configuração de prêmios"
                description={survey.rewardEnabled
                  ? 'A roleta está ativada. Configure os prêmios, frequência e regras de distribuição.'
                  : 'A roleta está desativada. Ative no editor para liberar a campanha de prêmios.'}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="admin-highlight-card">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Status da roleta</p>
                    <p className={`mt-2 text-2xl font-semibold ${survey.rewardEnabled ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {survey.rewardEnabled ? 'Ativada' : 'Desativada'}
                    </p>
                  </div>
                  <div className="admin-highlight-card">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Prêmios</p>
                    <p className="mt-2 text-sm font-semibold text-slate-700">
                      {survey.rewardEnabled ? 'Veja a configuração completa na página de prêmios.' : 'Disponível ao ativar a roleta.'}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    to={`/app/pesquisas/${survey.id}/premios`}
                    className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
                  >
                    <Gift className="h-4 w-4" />
                    {survey.rewardEnabled ? 'Configurar prêmios' : 'Ativar e configurar'}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </SectionCard>
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
            <Link
              to={`/app/pesquisas/${survey.id}/editar`}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              <PencilLine className="h-4 w-4" />
              Editar pesquisa
            </Link>
            <Link
              to={getSurveyTestPath(survey.id)}
              className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-800 transition hover:bg-sky-100"
            >
              <Sparkles className="h-4 w-4" />
              Testar pesquisa
            </Link>
            <Link
              to={`/app/pesquisas/${survey.id}/relatorios`}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
            >
              <BarChart3 className="h-4 w-4" />
              Abrir relatórios
            </Link>
            {isPublishedSurvey ? (
              <a
                href={publicSurveyPath}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
              >
                <ExternalLink className="h-4 w-4" />
                Página pública
              </a>
            ) : null}
            {isPublishedSurvey ? (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      'Deseja tirar esta pesquisa do ar e voltar para rascunho? O link público deixará de funcionar, mas as respostas já recebidas continuarão salvas.',
                    )
                  ) {
                    void unpublishMutation.mutateAsync()
                  }
                }}
                disabled={unpublishMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
              >
                <Share2 className="h-4 w-4" />
                {unpublishMutation.isPending ? 'Voltando...' : 'Voltar para rascunho'}
              </button>
            ) : null}
            <Link
              to={survey.kind === 'nps' ? '/app/pesquisas/nps' : '/app/pesquisas'}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowRight className="h-4 w-4 rotate-180" />
              Voltar para a lista
            </Link>
          </div>
          </div>
        </>
      ) : (
        <div className="admin-empty-state py-16">Carregando dados da pesquisa.</div>
      )}
    </AppShell>
  )
}
