import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  CreditCard,
  FileBarChart2,
  Gift,
  LayoutDashboard,
  Link2,
  PieChart as PieChartIcon,
  Settings,
  Target,
  Users2,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { MetricCard } from '@/components/ui/MetricCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { ApiError, apiRequest } from '@/lib/api-client'
import { mapApiSurvey } from '@/lib/mappers'
import { useAuthStore } from '@/store/use-auth-store'

type QuickActionItem = {
  title: string
  description: string
  to: string
  icon: typeof LayoutDashboard
}

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

function getStatusTone(status: 'Rascunho' | 'Publicada' | 'Pausada') {
  if (status === 'Publicada') {
    return 'bg-emerald-50 text-emerald-700'
  }

  if (status === 'Pausada') {
    return 'bg-amber-50 text-amber-700'
  }

  return 'bg-slate-100 text-slate-700'
}

const STATUS_CHART_COLORS = ['#0b5cff', '#f59e0b', '#94a3b8']
const REWARD_CHART_COLORS = ['#7c3aed', '#cbd5e1']
const NPS_CHART_COLORS = ['#16a34a', '#f59e0b', '#ef4444']

export function DashboardPage() {
  const user = useAuthStore((state) => state.user)

  const surveysQuery = useQuery({
    queryKey: ['dashboard', 'surveys'],
    queryFn: async () => {
      const response = await apiRequest<{
        surveys: Array<{
          id: string
          title: string
          description?: string | null
          status: string
          participation_mode: string
          primary_color: string
          reward_enabled: boolean
          slug: string | null
          responses: string
        }>
      }>('/surveys')

      return response.surveys.map(mapApiSurvey)
    },
    retry: 0,
    enabled: user?.roleCode !== 'master',
  })

  const globalQuery = useQuery({
    queryKey: ['dashboard', 'global-reports'],
    queryFn: async () => {
      const response = await apiRequest<{
        metrics: {
          surveys: string
          users: string
          responses: string
          wins: string
        }
      }>('/reports/global')

      return response.metrics
    },
    retry: 0,
    enabled: user?.roleCode === 'master',
  })

  const npsOverviewQuery = useQuery({
    queryKey: ['dashboard', 'nps-overview'],
    queryFn: async () => {
      const response = await apiRequest<{ summary: NpsOverview }>('/reports/nps-overview')
      return response.summary
    },
    retry: 0,
    enabled: user?.roleCode !== 'master',
  })

  const surveyItems = surveysQuery.data ?? []
  const totalResponses = surveyItems.reduce((sum, survey) => sum + survey.responses, 0)
  const publishedSurveys = surveyItems.filter((survey) => survey.status === 'Publicada').length
  const rewardSurveys = surveyItems.filter((survey) => survey.rewardEnabled).length
  const draftSurveys = surveyItems.filter((survey) => survey.status === 'Rascunho').length
  const pausedSurveys = surveyItems.filter((survey) => survey.status === 'Pausada').length
  const prioritySurveys = useMemo(
    () => [...surveyItems].sort((left, right) => right.responses - left.responses).slice(0, 3),
    [surveyItems],
  )
  const statusChartData = useMemo(
    () =>
      [
        { name: 'Publicadas', value: publishedSurveys, color: STATUS_CHART_COLORS[0] },
        { name: 'Pausadas', value: pausedSurveys, color: STATUS_CHART_COLORS[1] },
        { name: 'Rascunhos', value: draftSurveys, color: STATUS_CHART_COLORS[2] },
      ].filter((item) => item.value > 0),
    [draftSurveys, pausedSurveys, publishedSurveys],
  )
  const rewardChartData = useMemo(
    () => [
      { name: 'Com roleta', value: rewardSurveys, color: REWARD_CHART_COLORS[0] },
      { name: 'Sem roleta', value: Math.max(surveyItems.length - rewardSurveys, 0), color: REWARD_CHART_COLORS[1] },
    ],
    [rewardSurveys, surveyItems.length],
  )
  const topResponsesChartData = useMemo(
    () =>
      prioritySurveys
        .map((survey) => ({
          name: survey.title.length > 18 ? `${survey.title.slice(0, 18)}...` : survey.title,
          respostas: survey.responses,
          color: survey.primaryColor || '#0b5cff',
        }))
        .reverse(),
    [prioritySurveys],
  )
  const npsCompositionData = useMemo(() => {
    if (!npsOverviewQuery.data) {
      return []
    }

    return [
      { name: 'Promotores', value: npsOverviewQuery.data.promoters, color: NPS_CHART_COLORS[0] },
      { name: 'Neutros', value: npsOverviewQuery.data.neutrals, color: NPS_CHART_COLORS[1] },
      { name: 'Detratores', value: npsOverviewQuery.data.detractors, color: NPS_CHART_COLORS[2] },
    ].filter((item) => item.value > 0)
  }, [npsOverviewQuery.data])

  const metrics =
    globalQuery.data
      ? [
          {
            label: 'Pesquisas',
            value: globalQuery.data.surveys,
            change: 'Plataforma',
            detail: 'Campanhas registradas',
            tone: 'blue' as const,
            icon: BarChart3,
          },
          {
            label: 'Respostas',
            value: globalQuery.data.responses,
            change: 'Base total',
            detail: 'Volume consolidado',
            tone: 'emerald' as const,
            icon: FileBarChart2,
          },
          {
            label: 'Usuários',
            value: globalQuery.data.users,
            change: 'Acesso',
            detail: 'Contas ativas na plataforma',
            tone: 'violet' as const,
            icon: Users2,
          },
          {
            label: 'Prêmios',
            value: globalQuery.data.wins,
            change: 'Campanhas',
            detail: 'Entregas registradas',
            tone: 'amber' as const,
            icon: Gift,
          },
        ]
      : surveysQuery.data
        ? [
            {
              label: 'Pesquisas',
              value: String(surveyItems.length),
              change: 'Seu painel',
              detail: 'Pesquisas no painel',
              tone: 'blue' as const,
              icon: BarChart3,
            },
            {
              label: 'Respostas',
              value: String(totalResponses),
              change: 'Base total',
              detail: 'Total das suas pesquisas',
              tone: 'emerald' as const,
              icon: FileBarChart2,
            },
            {
              label: 'Roleta',
              value: String(rewardSurveys),
              change: 'Campanhas',
              detail: 'Pesquisas com prêmio',
              tone: 'violet' as const,
              icon: Gift,
            },
            {
              label: 'Publicadas',
              value: String(publishedSurveys),
              change: 'No ar',
              detail: 'Pesquisas prontas',
              tone: 'amber' as const,
              icon: Users2,
            },
          ]
        : [
            {
              label: 'Pesquisas',
              value: '-',
              change: 'Carregando',
              detail: 'Buscando dados',
              tone: 'blue' as const,
              icon: BarChart3,
            },
            {
              label: 'Respostas',
              value: '-',
              change: 'Carregando',
              detail: 'Buscando dados',
              tone: 'emerald' as const,
              icon: FileBarChart2,
            },
            {
              label: 'Usuários',
              value: '-',
              change: 'Carregando',
              detail: 'Buscando dados',
              tone: 'violet' as const,
              icon: Users2,
            },
            {
              label: 'Prêmios',
              value: '-',
              change: 'Carregando',
              detail: 'Buscando dados',
              tone: 'amber' as const,
              icon: Gift,
            },
          ]

  const quickActions: QuickActionItem[] =
    user?.roleCode === 'master'
      ? [
          {
            title: 'Usuários',
            description: 'Acessos, bloqueios e perfis.',
            to: '/app/usuarios',
            icon: Users2,
          },
          {
            title: 'Planos',
            description: 'Recursos liberados por contrato.',
            to: '/app/planos',
            icon: CreditCard,
          },
          {
            title: 'Configurações',
            description: 'Logo, favicon e identidade visual.',
            to: '/app/configuracoes',
            icon: Settings,
          },
        ]
      : [
          {
            title: 'Pesquisas',
            description: 'Abrir lista e editar campanhas.',
            to: '/app/pesquisas',
            icon: BarChart3,
          },
          {
            title: 'NPS',
            description: 'Modelo pronto e leitura simples da recomendação.',
            to: '/app/pesquisas/nps',
            icon: FileBarChart2,
          },
          {
            title: 'Aniversário',
            description: 'Fila e contatos salvos.',
            to: '/app/automacoes/aniversario',
            icon: Gift,
          },
        ]

  const operationalHighlights =
    user?.roleCode === 'master'
      ? [
          {
            title: 'Usuários e planos',
            description: 'Acompanhe usuários, planos e crescimento da base.',
          },
          {
            title: 'Recursos ativos',
            description: 'Revise planos ativos e liberações importantes.',
          },
          {
            title: 'Próximo passo',
            description: 'Use os relatórios para ver onde agir primeiro.',
          },
        ]
      : [
          {
            title: 'Pesquisa líder',
            description:
              prioritySurveys[0]
                ? `${prioritySurveys[0].title} lidera com ${prioritySurveys[0].responses} respostas.`
                : 'Quando entrar resposta, a campanha principal aparece aqui.',
          },
          {
            title: 'Roleta',
            description:
              rewardSurveys > 0
                ? `${rewardSurveys} campanha(s) com roleta ativa.`
                : 'Nenhuma campanha com roleta ativa.',
          },
          {
            title: 'Publicação',
            description:
              publishedSurveys > 0
                ? `${publishedSurveys} pesquisa(s) publicada(s).`
                : 'Nenhuma pesquisa publicada no momento.',
          },
        ]

  const masterPriorities = [
    {
      title: 'Usuários e permissões',
      description: 'Revise bloqueios, planos e contas com mais impacto.',
    },
    {
      title: 'Planos e recursos',
      description: 'Garanta liberações coerentes por contrato.',
    },
    {
      title: 'Branding',
      description: 'Mantenha nome, logo e favicon alinhados.',
    },
  ]

  const checklistItems =
    user?.roleCode === 'master'
      ? [
          'Revise usuários e planos.',
          'Ajuste o branding quando necessário.',
          'Use relatórios para acompanhar a plataforma.',
        ]
      : [
          'Abra uma pesquisa publicada.',
          'Confira relatórios e ganhadores.',
          'Revise a roleta e o estoque quando houver prêmio.',
        ]

  const hasConnectivityIssue =
    (user?.roleCode !== 'master' && surveysQuery.isError) ||
    (user?.roleCode === 'master' &&
      globalQuery.isError &&
      !(globalQuery.error instanceof ApiError && globalQuery.error.status === 403))

  return (
    <AppShell title="Painel" subtitle="Resumo rápido para encontrar o que importa.">
      {hasConnectivityIssue ? (
        <div className="mb-4 rounded-[6px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Não foi possível carregar todo o painel agora. Verifique a API e tente novamente.
        </div>
      ) : null}

      <section className="admin-page-hero mb-3 grid gap-3 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Resumo</p>
          <h2 className="mt-1 font-display text-[22px] leading-tight text-slate-950">
            {user?.roleCode === 'master' ? 'Tudo centralizado em um só lugar.' : 'Veja rápido o status das suas pesquisas.'}
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] text-slate-600">
            Um painel mais elegante e direto para acompanhar campanhas, respostas, NPS e pontos que pedem ação.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="admin-inline-stat border-blue-100 bg-[linear-gradient(180deg,#eff6ff_0%,#ffffff_100%)]">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Perfil</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {user?.roleCode === 'master' ? 'Master' : 'Painel do cliente'}
            </p>
          </div>
          <div className="admin-inline-stat border-emerald-100 bg-[linear-gradient(180deg,#ecfdf5_0%,#ffffff_100%)]">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Pesquisas</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {user?.roleCode === 'master' ? globalQuery.data?.surveys ?? '-' : surveyItems.length}
            </p>
          </div>
          <div className="admin-inline-stat border-violet-100 bg-[linear-gradient(180deg,#f5f3ff_0%,#ffffff_100%)]">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Respostas</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {user?.roleCode === 'master' ? globalQuery.data?.responses ?? '-' : totalResponses}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      {user?.roleCode !== 'master' ? (
        <div className="mt-3 grid gap-3 xl:grid-cols-[0.95fr_0.95fr_1.1fr]">
          <section className="dashboard-chart-card">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Status das pesquisas</p>
                <h3 className="mt-1 font-display text-[22px] leading-tight text-slate-950">Distribuição por situação</h3>
                <p className="mt-1 text-[13px] text-slate-600">Veja quantas pesquisas estão publicadas, pausadas ou em rascunho.</p>
              </div>
              <div className="admin-icon-chip border-blue-100 bg-blue-50 text-blue-700">
                <PieChartIcon className="h-4 w-4" />
              </div>
            </div>

            {statusChartData.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusChartData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={86} paddingAngle={4}>
                      {statusChartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="admin-empty-state py-16">Assim que você criar pesquisas, o gráfico aparece aqui.</div>
            )}

            <div className="mt-3 grid gap-2">
              {statusChartData.map((item) => (
                <div key={item.name} className="flex items-center justify-between rounded-[6px] border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-sm text-slate-700">{item.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-slate-950">{item.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-chart-card">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Campanhas com roleta</p>
                <h3 className="mt-1 font-display text-[22px] leading-tight text-slate-950">Uso da roleta</h3>
                <p className="mt-1 text-[13px] text-slate-600">Entenda rapidamente quantas campanhas já usam prêmio e quantas ainda não usam.</p>
              </div>
              <div className="admin-icon-chip border-violet-100 bg-violet-50 text-violet-700">
                <Target className="h-4 w-4" />
              </div>
            </div>

            {surveyItems.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={rewardChartData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={86} paddingAngle={4}>
                      {rewardChartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="admin-empty-state py-16">Crie pesquisas para visualizar a composição da roleta.</div>
            )}

            <div className="mt-3 grid gap-2">
              {rewardChartData.map((item) => (
                <div key={item.name} className="flex items-center justify-between rounded-[6px] border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-sm text-slate-700">{item.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-slate-950">{item.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-chart-card">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Desempenho</p>
                <h3 className="mt-1 font-display text-[22px] leading-tight text-slate-950">Top pesquisas por respostas</h3>
                <p className="mt-1 text-[13px] text-slate-600">Um gráfico simples para mostrar quais campanhas estão puxando o resultado.</p>
              </div>
              <div className="admin-icon-chip border-emerald-100 bg-emerald-50 text-emerald-700">
                <BarChart3 className="h-4 w-4" />
              </div>
            </div>

            {topResponsesChartData.length ? (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topResponsesChartData} layout="vertical" margin={{ top: 4, right: 8, left: 12, bottom: 4 }}>
                    <CartesianGrid stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={110} />
                    <Tooltip />
                    <Bar dataKey="respostas" radius={[0, 6, 6, 0]}>
                      {topResponsesChartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="admin-empty-state py-16">Quando houver respostas, o ranking aparece aqui.</div>
            )}
          </section>
        </div>
      ) : null}

      {user?.roleCode !== 'master' ? (
        <div className="mt-3 grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
          <SectionCard
            eyebrow="NPS"
            title="Leitura simples da recomendação"
            description="Veja o número principal, entenda o momento e identifique onde agir."
          >
            {npsOverviewQuery.data ? (
              <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="dashboard-kpi-card border-blue-100 bg-[linear-gradient(180deg,#eff6ff_0%,#ffffff_100%)]">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">NPS atual</p>
                  <p className="mt-2 font-display text-5xl text-slate-950">{npsOverviewQuery.data.npsScore}</p>
                  <p className="mt-2 text-sm font-medium text-slate-700">{npsOverviewQuery.data.classification}</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-[6px] border border-emerald-100 bg-emerald-50 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-emerald-700">Promotores</p>
                      <p className="mt-1 text-lg font-semibold text-emerald-900">{npsOverviewQuery.data.promoters}</p>
                    </div>
                    <div className="rounded-[6px] border border-amber-100 bg-amber-50 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-amber-700">Neutros</p>
                      <p className="mt-1 text-lg font-semibold text-amber-900">{npsOverviewQuery.data.neutrals}</p>
                    </div>
                    <div className="rounded-[6px] border border-rose-100 bg-rose-50 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-rose-700">Detratores</p>
                      <p className="mt-1 text-lg font-semibold text-rose-900">{npsOverviewQuery.data.detractors}</p>
                    </div>
                  </div>
                </div>

                {npsCompositionData.length ? (
                  <div className="dashboard-kpi-card border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]">
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={npsCompositionData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={86} paddingAngle={4}>
                            {npsCompositionData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid gap-2">
                      {npsCompositionData.map((item) => (
                        <div key={item.name} className="flex items-center justify-between rounded-[6px] border border-slate-200 bg-white px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                            <span className="text-sm text-slate-700">{item.name}</span>
                          </div>
                          <span className="text-sm font-semibold text-slate-950">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="admin-empty-state">Quando houver respostas NPS, a divisão entre promotores, neutros e detratores aparece aqui.</div>
                )}
              </div>
            ) : (
              <div className="admin-empty-state">Carregando leitura NPS.</div>
            )}
          </SectionCard>

          <SectionCard
            eyebrow="Entendimento"
            title="Como interpretar"
            description="Explicação curta para o usuário entender sem precisar abrir relatório."
          >
            {npsOverviewQuery.data ? (
              <div className="space-y-3">
                <div className="admin-subcard">
                  <p className="text-sm font-semibold text-slate-950">{npsOverviewQuery.data.classification}</p>
                  <p className="mt-1 text-sm text-slate-600">{npsOverviewQuery.data.explanation}</p>
                </div>
                <div className="admin-subcard">
                  <p className="text-sm font-semibold text-slate-950">Média das notas</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {npsOverviewQuery.data.responses
                      ? `A média atual das notas está em ${npsOverviewQuery.data.averageScore}.`
                      : 'Ainda não há respostas NPS suficientes para calcular a média.'}
                  </p>
                </div>
                <div className="admin-subcard">
                  <p className="text-sm font-semibold text-slate-950">Pesquisa em destaque</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {npsOverviewQuery.data.topSurvey
                      ? `${npsOverviewQuery.data.topSurvey.title} está com NPS ${npsOverviewQuery.data.topSurvey.score} em ${npsOverviewQuery.data.topSurvey.responses} resposta(s).`
                      : 'Quando uma pesquisa NPS começar a receber respostas, o destaque aparece aqui.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="admin-empty-state">Carregando explicação do NPS.</div>
            )}
          </SectionCard>
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          eyebrow="Ações rápidas"
          title="Ir direto ao ponto"
          description="Atalhos para acessar o que mais importa."
        >
          <div className="grid gap-2 md:grid-cols-3">
            {quickActions.map((action) => {
              const Icon = action.icon

              return (
                <Link
                  key={action.title}
                  to={action.to}
                  className="admin-action-card group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="admin-icon-chip mb-2">
                        <Icon className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold text-slate-950">{action.title}</p>
                      <p className="mt-1 text-[13px] leading-5 text-slate-600">{action.description}</p>
                    </div>

                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-slate-900" />
                  </div>
                </Link>
              )
            })}
          </div>
        </SectionCard>

        <SectionCard eyebrow="Resumo" title="O que olhar agora" description="Leitura curta para decidir mais rápido.">
          <div className="space-y-3">
            {operationalHighlights.map((item) => (
              <div key={item.title} className="admin-highlight-card">
                <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                <p className="mt-1 text-[13px] leading-5 text-slate-600">{item.description}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          eyebrow="Prioridades"
          title={user?.roleCode === 'master' ? 'O que cuidar agora' : 'Pesquisas em destaque'}
          description={
            user?.roleCode === 'master'
              ? 'Leitura simples das frentes mais importantes.'
              : 'Campanhas que merecem atenção primeiro.'
          }
        >
          {user?.roleCode === 'master' ? (
            <div className="space-y-3">
              {masterPriorities.map((item) => (
                <article key={item.title} className="rounded-[6px] border border-slate-200 bg-slate-50 p-3">
                  <p className="font-semibold text-slate-950">{item.title}</p>
                  <p className="mt-1 text-[13px] leading-5 text-slate-600">{item.description}</p>
                </article>
              ))}
            </div>
          ) : prioritySurveys.length ? (
            <div className="space-y-3">
              {prioritySurveys.map((survey) => (
                <article key={survey.id} className="admin-panel p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: survey.primaryColor || '#0b5cff' }}
                        />
                        <p className="truncate font-semibold text-slate-950">{survey.title}</p>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1 rounded-[6px] border border-slate-200 bg-white px-2 py-1">
                          <Link2 className="h-3 w-3" />
                          /{survey.slug}
                        </span>
                        <span className="inline-flex rounded-[6px] border border-slate-200 bg-white px-2 py-1">
                          {survey.participationMode}
                        </span>
                      </div>
                    </div>

                    <span className={`rounded-[6px] px-3 py-1 text-xs font-semibold ${getStatusTone(survey.status)}`}>
                      {survey.status}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <div className="admin-inline-stat">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Respostas</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">{survey.responses}</p>
                    </div>
                    <div className="admin-inline-stat">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Roleta</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">
                        {survey.rewardEnabled ? 'Ativa' : 'Desligada'}
                      </p>
                    </div>
                    <div className="admin-inline-stat">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Modo</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">{survey.participationMode}</p>
                    </div>
                    <div className="admin-inline-stat">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Atualização</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">{survey.updatedAt}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-[6px] border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-600">
              Nenhuma pesquisa disponível para destaque no momento.
            </div>
          )}
        </SectionCard>

        <SectionCard eyebrow="Checklist" title="Passos rápidos" description="Sem texto longo e sem enrolação.">
          <div className="space-y-3">
            {checklistItems.map((item, index) => (
              <div key={item} className="admin-highlight-card flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-slate-950 text-[11px] font-semibold text-white">
                  {index + 1}
                </div>
                <p className="text-[13px] leading-5 text-slate-600">{item}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </AppShell>
  )
}
