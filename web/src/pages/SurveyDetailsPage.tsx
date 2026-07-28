import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  ExternalLink,
  Gift,
  Link2,
  ListChecks,
  PencilLine,
  PieChart,
  Rocket,
  Share2,
  Sparkles,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { SectionCard } from '@/components/ui/SectionCard'
import { SurveyShareCard } from '@/components/ui/SurveyShareCard'
import { apiRequest } from '@/lib/api-client'
import { mapApiSurvey } from '@/lib/mappers'
import { getPublicSurveyPath, getSurveyTestPath } from '@/lib/public-survey'

type SurveyTab = 'summary' | 'questions' | 'share' | 'results'

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
  const [activeTab, setActiveTab] = useState<SurveyTab>('summary')

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
  const quickStats = useMemo(() => {
    if (!survey) {
      return []
    }

    return [
      { label: 'Respostas', value: String(survey.responses) },
      { label: 'Perguntas', value: String(survey.questions.length) },
      { label: 'Participação', value: survey.participationMode },
      { label: 'Roleta', value: survey.rewardEnabled ? 'Ativada' : 'Desligada' },
    ]
  }, [survey])
  const questionsWithFlow = survey?.questions.filter((question) => question.flowRules?.length).length ?? 0
  const requiredQuestions = survey?.questions.filter((question) => question.required).length ?? 0
  const summary = summaryQuery.data?.summary
  const publicSurveyPath = survey?.slug ? getPublicSurveyPath(survey.slug) : ''
  const isPublishedSurvey = survey?.status === 'Publicada'
  const tabs = [
    { id: 'summary' as const, label: 'Resumo', icon: PieChart },
    { id: 'questions' as const, label: 'Perguntas', icon: ListChecks },
    { id: 'share' as const, label: 'Compartilhar', icon: Link2 },
    { id: 'results' as const, label: 'Resultados', icon: BarChart3 },
  ]

  return (
    <AppShell
      title={survey?.title ?? 'Pesquisa'}
      subtitle={
        survey?.kind === 'nps'
          ? 'Página da pesquisa NPS com visão rápida, ações e compartilhamento.'
          : 'Página da pesquisa com visão rápida, ações e compartilhamento.'
      }
      backHref={survey?.kind === 'nps' ? '/app/pesquisas/nps' : '/app/pesquisas'}
      backLabel={survey?.kind === 'nps' ? 'Voltar para NPS' : 'Voltar para pesquisas'}
      breadcrumbs={
        survey?.kind === 'nps'
          ? [
              { label: 'Pesquisas', href: '/app/pesquisas' },
              { label: 'NPS', href: '/app/pesquisas/nps' },
              { label: survey?.title ?? 'Pesquisa' },
            ]
          : [
              { label: 'Pesquisas', href: '/app/pesquisas' },
              { label: survey?.title ?? 'Pesquisa' },
            ]
      }
    >
      {surveyQuery.isError ? (
        <div className="admin-alert mb-6 border-amber-200 bg-amber-50 text-amber-900">
          Não foi possível carregar esta pesquisa agora. Verifique a API e tente novamente.
        </div>
      ) : null}

      {survey ? (
        <>
          <section className="admin-page-hero mb-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <div className="mb-3 h-2 w-16" style={{ backgroundColor: survey.primaryColor, borderRadius: 2 }} />
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                {survey.kind === 'nps' ? 'Pesquisa NPS' : 'Pesquisa personalizada'}
              </p>
              <h2 className="mt-1 font-display text-[24px] leading-tight text-slate-950">{survey.title}</h2>
              <p className="mt-2 max-w-2xl text-[13px] text-slate-600">
                {survey.description || 'Abra a pesquisa, acompanhe os dados principais e siga rapidamente para editar, divulgar ou ver os relatórios.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="admin-badge border-slate-900 bg-slate-950 text-white">{survey.status}</span>
                <span className="admin-badge bg-white">/{survey.slug}</span>
                <span className="admin-badge bg-white">{survey.kind === 'nps' ? 'NPS' : 'Personalizada'}</span>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {quickStats.map((item) => (
                <div key={item.label} className="admin-inline-stat">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">{item.value}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="mb-6 overflow-x-auto border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-2 shadow-card" style={{ borderRadius: 6 }}>
            <div className="flex min-w-max gap-2">
              {tabs.map((tab) => {
                const Icon = tab.icon
                const isActive = activeTab === tab.id

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition ${
                      isActive
                        ? 'border border-slate-900 bg-slate-950 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                    style={{ borderRadius: 6 }}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>

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

          <div className="mt-6 flex flex-wrap gap-3">
            <Link to={`/app/pesquisas/${survey.id}/editar`} className="admin-button-primary">
              <PencilLine className="h-4 w-4" />
              Editar pesquisa
            </Link>
            <Link to={getSurveyTestPath(survey.id)} className="admin-button">
              <Sparkles className="h-4 w-4" />
              Testar pesquisa
            </Link>
            <Link to={`/app/pesquisas/${survey.id}/relatorios`} className="admin-button">
              <BarChart3 className="h-4 w-4" />
              Abrir relatórios
            </Link>
            {isPublishedSurvey ? (
              <a href={publicSurveyPath} target="_blank" rel="noreferrer" className="admin-button">
                <ExternalLink className="h-4 w-4" />
                Abrir página pública
              </a>
            ) : null}
            <Link to={survey.kind === 'nps' ? '/app/pesquisas/nps' : '/app/pesquisas'} className="admin-button">
              <Share2 className="h-4 w-4" />
              Voltar para a lista
            </Link>
          </div>
        </>
      ) : (
        <div className="admin-empty-state py-16">Carregando dados da pesquisa.</div>
      )}
    </AppShell>
  )
}
