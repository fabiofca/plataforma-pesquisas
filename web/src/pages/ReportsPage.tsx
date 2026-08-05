import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChartColumnBig, Download, Trophy, Users } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { SurveyNavBar } from '@/components/surveys/SurveyNavBar'
import { SectionCard } from '@/components/ui/SectionCard'
import { apiRequest, downloadApiFile } from '@/lib/api-client'
import { hasFeatureAccess } from '@/lib/features'
import { useAuthStore } from '@/store/use-auth-store'

type PeriodPreset = 'today' | '7d' | '30d' | 'custom'

type PaginationMeta = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

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
  period: Array<{
    day: string
    responses: string
    visits: string
  }>
  range: {
    startDate: string
    endDate: string
  }
}

type QuestionReport = {
  id: string
  title: string
  description?: string | null
  type: string
  totalAnswers: number
  completionRate: number
  averageScore?: number
  distribution?: Array<{
    label: string
    count: number
    percentage: number
  }>
  textSamples?: string[]
  nps?: {
    score: number
    promoters: number
    neutrals: number
    detractors: number
  }
}

type QuestionsResponse = {
  questions: QuestionReport[]
  totalResponses: number
  range: {
    startDate: string
    endDate: string
  }
}

type RespondentsResponse = {
  respondents: Array<{
    id: string
    submittedAt: string
    name?: string | null
    phone?: string | null
    email?: string | null
    birthdayLabel?: string | null
  }>
  pagination: PaginationMeta
  range: {
    startDate: string
    endDate: string
  }
}

type RewardsResponse = {
  summary: {
    total_spins: string
    total_wins: string
    total_no_prize: string
    pending_redemptions: string
    delivered_redemptions: string
    cancelled_redemptions: string
  }
  pickupAddress?: string | null
  requireReceiverIdentity?: boolean
  stock: Array<{
    id: string
    title: string
    quantityTotal: number
    quantityAwarded: number
    remainingStock: number
    winsInRange: number
  }>
  winners: Array<{
    id: string
    awardedAt: string
    expiresAt: string
    isExpired: boolean
    deliveredAt?: string | null
    name?: string | null
    phone?: string | null
    email?: string | null
    itemTitle: string
    couponCode: string
    redemptionStatus: 'pending' | 'delivered' | 'cancelled'
    redemptionNotes?: string | null
    receivedBy?: string | null
  }>
  winnersPagination: PaginationMeta
  noPrizeBreakdown: Array<{
    label: string
    count: number
  }>
  range: {
    startDate: string
    endDate: string
  }
}

type WinnerSortField = 'awardedAt' | 'name' | 'itemTitle'
type WinnerSortDirection = 'asc' | 'desc'
type WinnerStatusFilter = 'all' | 'pending' | 'delivered' | 'cancelled'

type InsightCategory = 'responses' | 'access' | 'contacts' | 'rewards' | 'wheel'

type InsightItem = {
  category: InsightCategory
  title: string
  value: string
}

const insightCategoryStyles: Record<InsightCategory, { bar: string; label: string }> = {
  responses: { bar: 'bg-blue-500', label: 'Respostas' },
  access: { bar: 'bg-teal-500', label: 'Acessos' },
  contacts: { bar: 'bg-violet-500', label: 'Contatos' },
  rewards: { bar: 'bg-emerald-500', label: 'Prêmios' },
  wheel: { bar: 'bg-amber-500', label: 'Roleta' },
}

function formatPeriodDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed)
}

function getDistributionBarColor(index: number) {
  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500', 'bg-teal-500', 'bg-sky-500', 'bg-orange-500']
  return colors[index % colors.length]
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

function formatDateTimeLabel(value?: string | null) {
  if (!value) {
    return '-'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function formatDateLabel(value?: string | null) {
  if (!value) {
    return '-'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed)
}

function buildReportParams(
  range: { startDate: string; endDate: string },
  extra?: Record<string, string | number | undefined>,
) {
  const params = new URLSearchParams({
    startDate: range.startDate,
    endDate: range.endDate,
  })

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== '') {
        params.set(key, String(value))
      }
    }
  }

  return params
}

function getPaginationWindow(pagination: PaginationMeta) {
  if (!pagination.totalItems) {
    return { start: 0, end: 0 }
  }

  const start = (pagination.page - 1) * pagination.pageSize + 1
  const end = Math.min(pagination.page * pagination.pageSize, pagination.totalItems)

  return { start, end }
}

function PaginationControls({
  pagination,
  onPageChange,
  onPageSizeChange,
}: {
  pagination: PaginationMeta
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const windowRange = getPaginationWindow(pagination)

  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-slate-600">
        Mostrando <strong>{windowRange.start}</strong> a <strong>{windowRange.end}</strong> de{' '}
        <strong>{pagination.totalItems}</strong> registros.
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span>Por página</span>
          <select
            value={pagination.pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="admin-select min-w-[90px]"
          >
            {[20, 50, 100].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="admin-button disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anterior
          </button>
          <div className="min-w-[110px] text-center text-sm font-medium text-slate-700">
            Página {pagination.page} de {pagination.totalPages}
          </div>
          <button
            type="button"
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="admin-button disabled:cursor-not-allowed disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  )
}

function TextSamplesList({ samples, questionId }: { samples: string[]; questionId: string }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? samples : samples.slice(0, 3)
  const canExpand = samples.length > 3

  return (
    <div className="mt-3 grid gap-2">
      {visible.map((sample, sampleIndex) => (
        <div
          key={`${questionId}-sample-${sampleIndex}`}
          className="border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          style={{ borderRadius: 8 }}
        >
          {sample}
        </div>
      ))}
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          {expanded ? 'Ver menos' : `Ver todas (${samples.length})`}
        </button>
      ) : null}
    </div>
  )
}

export function ReportsPage() {
  const { id } = useParams()
  const user = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()

  const surveyTitleQuery = useQuery({
    queryKey: ['survey-title', id],
    queryFn: async () => {
      const response = await apiRequest<{ survey: { title: string } }>(`/surveys/${id}`)
      return response.survey.title
    },
    enabled: Boolean(id),
  })
  const defaultEndDate = formatDateInput(getDateDaysAgo(0))
  const defaultStartDate = formatDateInput(getDateDaysAgo(29))
  const [preset, setPreset] = useState<PeriodPreset>('30d')
  const [customStartDate, setCustomStartDate] = useState(defaultStartDate)
  const [customEndDate, setCustomEndDate] = useState(defaultEndDate)
  const [exportingFormat, setExportingFormat] = useState<'csv' | 'pdf' | null>(null)
  const [exportFeedback, setExportFeedback] = useState('')
  const [respondentsPage, setRespondentsPage] = useState(1)
  const [respondentsPageSize, setRespondentsPageSize] = useState(20)
  const [winnerNameFilter, setWinnerNameFilter] = useState('')
  const [winnerPhoneFilter, setWinnerPhoneFilter] = useState('')
  const [winnerPrizeFilter, setWinnerPrizeFilter] = useState('')
  const [winnerCouponFilter, setWinnerCouponFilter] = useState('')
  const [winnerStatusFilter, setWinnerStatusFilter] = useState<WinnerStatusFilter>('all')
  const [winnerSortField, setWinnerSortField] = useState<WinnerSortField>('awardedAt')
  const [winnerSortDirection, setWinnerSortDirection] = useState<WinnerSortDirection>('desc')
  const [winnersPage, setWinnersPage] = useState(1)
  const [winnersPageSize, setWinnersPageSize] = useState(20)
  const canExportCsv = hasFeatureAccess(user, 'reports_export_csv')
  const canExportPdf = hasFeatureAccess(user, 'reports_export_pdf')

  const activeRange = useMemo(() => {
    if (preset === 'today') {
      const today = formatDateInput(getDateDaysAgo(0))
      return { startDate: today, endDate: today }
    }

    if (preset === '7d') {
      return {
        startDate: formatDateInput(getDateDaysAgo(6)),
        endDate: formatDateInput(getDateDaysAgo(0)),
      }
    }

    if (preset === '30d') {
      return {
        startDate: formatDateInput(getDateDaysAgo(29)),
        endDate: formatDateInput(getDateDaysAgo(0)),
      }
    }

    return {
      startDate: customStartDate,
      endDate: customEndDate,
    }
  }, [customEndDate, customStartDate, preset])

  const isInvalidCustomRange =
    preset === 'custom' &&
    (!activeRange.startDate || !activeRange.endDate || activeRange.startDate > activeRange.endDate)

  useEffect(() => {
    setExportFeedback('')
    setRespondentsPage(1)
    setWinnersPage(1)
  }, [activeRange.endDate, activeRange.startDate, preset])

  useEffect(() => {
    setRespondentsPage(1)
  }, [respondentsPageSize])

  useEffect(() => {
    setWinnersPage(1)
  }, [
    winnerCouponFilter,
    winnerNameFilter,
    winnerPhoneFilter,
    winnerPrizeFilter,
    winnerStatusFilter,
    winnerSortDirection,
    winnerSortField,
    winnersPageSize,
  ])

  const summaryQuery = useQuery({
    queryKey: ['reports-summary', id, activeRange.startDate, activeRange.endDate],
    queryFn: async () => {
      const params = buildReportParams(activeRange)
      return apiRequest<SummaryResponse>(`/surveys/${id}/reports/summary?${params.toString()}`)
    },
    enabled: Boolean(id) && !isInvalidCustomRange,
    retry: 0,
  })

  const questionsQuery = useQuery({
    queryKey: ['reports-questions', id, activeRange.startDate, activeRange.endDate],
    queryFn: async () => {
      const params = buildReportParams(activeRange)
      return apiRequest<QuestionsResponse>(`/surveys/${id}/reports/questions?${params.toString()}`)
    },
    enabled: Boolean(id) && !isInvalidCustomRange,
    retry: 0,
  })

  const respondentsQuery = useQuery({
    queryKey: ['reports-respondents', id, activeRange.startDate, activeRange.endDate, respondentsPage, respondentsPageSize],
    queryFn: async () => {
      const params = buildReportParams(activeRange, {
        page: respondentsPage,
        pageSize: respondentsPageSize,
      })

      return apiRequest<RespondentsResponse>(`/surveys/${id}/reports/respondents?${params.toString()}`)
    },
    enabled: Boolean(id) && !isInvalidCustomRange,
    retry: 0,
  })

  const rewardsQuery = useQuery({
    queryKey: [
      'reports-rewards',
      id,
      activeRange.startDate,
      activeRange.endDate,
      winnerNameFilter,
      winnerPhoneFilter,
      winnerPrizeFilter,
      winnerCouponFilter,
      winnerStatusFilter,
      winnerSortField,
      winnerSortDirection,
      winnersPage,
      winnersPageSize,
    ],
    queryFn: async () => {
      const params = buildReportParams(activeRange, {
        name: winnerNameFilter.trim(),
        phone: winnerPhoneFilter.trim(),
        prize: winnerPrizeFilter.trim(),
        coupon: winnerCouponFilter.trim(),
        status: winnerStatusFilter,
        sortField: winnerSortField,
        sortDirection: winnerSortDirection,
        page: winnersPage,
        pageSize: winnersPageSize,
      })

      return apiRequest<RewardsResponse>(`/surveys/${id}/reports/rewards?${params.toString()}`)
    },
    enabled: Boolean(id) && !isInvalidCustomRange,
    retry: 0,
  })

  const updateRedemptionMutation = useMutation({
    mutationFn: async (payload: { winId: string; status: 'pending' | 'delivered' | 'cancelled'; receivedBy?: string }) =>
      apiRequest<{ ok: boolean }>(`/rewards/wins/${payload.winId}/redemption`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: payload.status,
          redemptionNotes: '',
          receivedBy: payload.receivedBy ?? '',
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reports-rewards', id] })
    },
  })

  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false)
  const [deliveryModalWinId, setDeliveryModalWinId] = useState('')
  const [deliveryModalReceivedBy, setDeliveryModalReceivedBy] = useState('')

  const testResponsesQuery = useQuery({
    queryKey: ['reports-test-responses', id],
    queryFn: async () => {
      const response = await apiRequest<{ testResponseCount: number }>(`/surveys/${id}/rewards`)
      return { testResponseCount: response.testResponseCount ?? 0 }
    },
    enabled: Boolean(id),
    retry: 0,
  })

  const cleanupTestResponsesMutation = useMutation({
    mutationFn: async () =>
      apiRequest<{ ok: boolean; deletedCount: number }>(`/surveys/${id}/rewards/test-responses`, {
        method: 'DELETE',
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['reports-rewards', id] })
      await queryClient.invalidateQueries({ queryKey: ['reports-test-responses', id] })
      await queryClient.invalidateQueries({ queryKey: ['reports-summary', id] })
      setExportFeedback(`${result.deletedCount} resposta(s) de teste removida(s) com sucesso.`)
    },
  })

  const testResponseCount = testResponsesQuery.data?.testResponseCount ?? 0
  const requireReceiverIdentity = rewardsQuery.data?.requireReceiverIdentity ?? false

  const periodData =
    summaryQuery.data?.period.map((item) => ({
      label: item.day.slice(5).replace('-', '/'),
      answers: Number(item.responses),
      visits: Number(item.visits),
    })) ?? []

  const insights: InsightItem[] =
    summaryQuery.data && rewardsQuery.data
      ? [
          { category: 'responses', title: 'Total de respostas', value: `${summaryQuery.data.summary.total_responses} respostas válidas registradas` },
          { category: 'responses', title: 'Taxa de conversão', value: `${summaryQuery.data.summary.conversion_rate}% das visitas viraram respostas` },
          { category: 'responses', title: 'Participação identificada', value: `${summaryQuery.data.summary.identified_responses} respostas com identificação` },
          { category: 'access', title: 'Acessos totais', value: `${summaryQuery.data.summary.total_visits} visitas rastreadas na pesquisa` },
          { category: 'access', title: 'Cliques no link', value: `${summaryQuery.data.summary.link_clicks} acessos vieram pelo link divulgado` },
          { category: 'access', title: 'Leituras do QR code', value: `${summaryQuery.data.summary.qr_scans} acessos vieram pelo QR code` },
          { category: 'contacts', title: 'E-mails coletados', value: `${summaryQuery.data.summary.emails_collected} participantes informaram e-mail` },
          { category: 'contacts', title: 'Aniversários coletados', value: `${summaryQuery.data.summary.birthdays_collected} aniversários ficaram salvos para campanhas futuras` },
          { category: 'rewards', title: 'Prêmios sorteados', value: `${summaryQuery.data.summary.reward_wins} prêmios realmente sorteados` },
          { category: 'rewards', title: 'Resgates pendentes', value: `${rewardsQuery.data.summary.pending_redemptions} prêmios ainda aguardam retirada` },
          { category: 'rewards', title: 'Entregues ao cliente', value: `${rewardsQuery.data.summary.delivered_redemptions} resgates já foram concluídos` },
          { category: 'rewards', title: 'Cancelados', value: `${rewardsQuery.data.summary.cancelled_redemptions} resgates foram cancelados` },
          { category: 'wheel', title: 'Giros da roleta', value: `${rewardsQuery.data.summary.total_spins} giros registrados no período` },
          { category: 'wheel', title: 'Sem prêmio', value: `${rewardsQuery.data.summary.total_no_prize} giros terminaram em opção sem prêmio` },
        ]
      : []

  const hasAnyError =
    summaryQuery.isError || questionsQuery.isError || respondentsQuery.isError || rewardsQuery.isError
  const hasReportData = Boolean(summaryQuery.data)
  const totalWinnersInRange = Number(rewardsQuery.data?.summary.total_wins ?? 0)

  async function handleExport(format: 'csv' | 'pdf') {
    if (!id || isInvalidCustomRange || !hasReportData) {
      return
    }

    setExportingFormat(format)
    setExportFeedback('')

    try {
      const params = buildReportParams(activeRange)

      await downloadApiFile(
        `/surveys/${id}/reports/export.${format}?${params.toString()}`,
        `relatorio-pesquisa-${activeRange.startDate}-${activeRange.endDate}.${format}`,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível exportar o relatório agora.'

      setExportFeedback(message)
    } finally {
      setExportingFormat(null)
    }
  }

  return (
    <AppShell
      title="Relatórios da pesquisa"
      subtitle=""
      hideHeader
    >
      <SurveyNavBar
        surveyId={id!}
        surveyTitle={surveyTitleQuery.data}
        activeTab="results"
      />

      <div className="p-3 sm:p-4 lg:p-5">
      <section className="mb-6 flex flex-wrap items-center gap-3">
        <div className="grid flex-1 gap-2 sm:grid-cols-3">
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Respostas</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{summaryQuery.data?.summary.total_responses ?? '-'}</p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Conversão</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{summaryQuery.data?.summary.conversion_rate ?? '-'}%</p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Ganhadores</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{rewardsQuery.data?.summary.total_wins ?? '-'}</p>
          </div>
        </div>
      </section>

      <SectionCard
        eyebrow="Período"
        title="Filtro do relatório"
        description="Escolha um recorte rápido ou defina um intervalo personalizado para comparar acessos, respostas e desempenho das perguntas."
      >
        <div className="flex flex-wrap gap-3">
          {[
            ['today', 'Hoje'],
            ['7d', '7 dias'],
            ['30d', '30 dias'],
            ['custom', 'Personalizado'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPreset(value as PeriodPreset)}
              className={`px-4 py-2 text-sm font-semibold transition ${
                preset === value
                  ? 'bg-slate-950 text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
              style={{ borderRadius: 8 }}
            >
              {label}
            </button>
          ))}
        </div>

        {preset === 'custom' ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Data inicial</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(event) => setCustomStartDate(event.target.value)}
                className="admin-input"
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Data final</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(event) => setCustomEndDate(event.target.value)}
                className="admin-input"
              />
            </label>
          </div>
        ) : null}

        <div className="admin-alert mt-4 border-slate-200 bg-slate-50 text-slate-600">
          Exibindo dados de <strong>{formatPeriodDate(activeRange.startDate)}</strong> até <strong>{formatPeriodDate(activeRange.endDate)}</strong>.
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {canExportCsv ? (
            <button
              type="button"
              onClick={() => void handleExport('csv')}
              disabled={isInvalidCustomRange || !hasReportData || exportingFormat !== null}
              className="admin-button-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {exportingFormat === 'csv' ? 'Exportando CSV...' : 'Exportar CSV'}
            </button>
          ) : null}

          {canExportPdf ? (
            <button
              type="button"
              onClick={() => void handleExport('pdf')}
              disabled={isInvalidCustomRange || !hasReportData || exportingFormat !== null}
              className="admin-button disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {exportingFormat === 'pdf' ? 'Exportando PDF...' : 'Exportar PDF'}
            </button>
          ) : null}
        </div>

        {isInvalidCustomRange ? (
          <div className="admin-alert mt-4 border-rose-200 bg-rose-50 text-rose-900">
            Ajuste o período personalizado para que a data final não fique antes da data inicial.
          </div>
        ) : null}

        {!canExportCsv && !canExportPdf ? (
          <div className="admin-alert mt-4 border-amber-200 bg-amber-50 text-amber-900">
            Exportação de relatórios indisponível no plano atual.
          </div>
        ) : null}

        {exportFeedback ? (
          <div className="admin-alert mt-4 border-rose-200 bg-rose-50 text-rose-900">{exportFeedback}</div>
        ) : null}
      </SectionCard>

      {hasAnyError ? (
        <div className="admin-alert mt-6 border-amber-200 bg-amber-50 text-amber-900">
          Não foi possível carregar os relatórios agora. Verifique a API e tente novamente.
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard
          eyebrow="Série temporal"
          title="Acessos e respostas por dia"
          description="Compare o volume diário de visitas com as respostas concluídas para acompanhar a conversão."
        >
          {summaryQuery.isPending ? (
            <div className="admin-empty-state py-16">Carregando série temporal...</div>
          ) : hasReportData && periodData.length ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={periodData}>
                  <defs>
                    <linearGradient id="visitsGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="answersGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#0b5cff" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0b5cff" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="visits" name="Acessos" stroke="#14b8a6" strokeWidth={3} fill="url(#visitsGradient)" />
                  <Area type="monotone" dataKey="answers" name="Respostas" stroke="#0b5cff" strokeWidth={3} fill="url(#answersGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="admin-empty-state py-16">Nenhum dado disponível para o período selecionado.</div>
          )}
        </SectionCard>

        <SectionCard
          eyebrow="Insights"
          title="Leituras úteis da V1"
          description="Um resumo objetivo do que a pesquisa entregou no período selecionado."
        >
          {summaryQuery.isPending || rewardsQuery.isPending ? (
            <div className="admin-empty-state py-16">Carregando indicadores...</div>
          ) : insights.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {insights.map((insight) => {
                const style = insightCategoryStyles[insight.category]
                return (
                  <div key={insight.title} className="report-insight-card">
                    <div className="mb-3 flex items-center gap-2">
                      <div className={`h-1.5 w-10 ${style.bar}`} style={{ borderRadius: 999 }} />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{style.label}</span>
                    </div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{insight.title}</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-950">{insight.value}</p>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="admin-empty-state py-16">Nenhum resumo disponível para exibir neste momento.</div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <SectionCard
          eyebrow="Roleta"
          title="Desempenho da campanha"
          description="Veja quantos giros aconteceram, quantas vezes saiu prêmio e quantas vezes a roleta caiu em opção sem prêmio."
        >
          {rewardsQuery.isPending ? (
            <div className="admin-empty-state py-16">Carregando dados da roleta...</div>
          ) : rewardsQuery.data ? (
            <div className="admin-table-shell">
              <div className="report-table-head hidden grid-cols-4 gap-3 md:grid">
                <div>Giros</div>
                <div>Prêmios</div>
                <div>Sem prêmio</div>
                <div>Cancelados</div>
              </div>

              <div className="divide-y divide-slate-200 md:divide-y-0">
                <div className="grid gap-3 px-4 py-3 md:grid-cols-4">
                  <div className="flex items-center gap-3">
                    <div className="admin-icon-chip border-slate-200 bg-slate-50 text-slate-600">
                      <ChartColumnBig className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 md:hidden">Giros</p>
                      <p className="text-lg font-semibold text-slate-950">{rewardsQuery.data.summary.total_spins}</p>
                      <p className="text-sm text-slate-600">Participações que giraram.</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="admin-icon-chip border-emerald-100 bg-emerald-50 text-emerald-700">
                      <Trophy className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 md:hidden">Prêmios</p>
                      <p className="text-lg font-semibold text-emerald-700">{rewardsQuery.data.summary.total_wins}</p>
                      <p className="text-sm text-slate-600">Premiações registradas.</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="admin-icon-chip border-amber-100 bg-amber-50 text-amber-700">
                      <Users className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 md:hidden">Sem prêmio</p>
                      <p className="text-lg font-semibold text-amber-700">{rewardsQuery.data.summary.total_no_prize}</p>
                      <p className="text-sm text-slate-600">Mensagens neutras.</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="admin-icon-chip border-rose-100 bg-rose-50 text-rose-700">
                      <Download className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 md:hidden">Cancelados</p>
                      <p className="text-lg font-semibold text-rose-700">{rewardsQuery.data.summary.cancelled_redemptions}</p>
                      <p className="text-sm text-slate-600">Resgates cancelados.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="admin-empty-state py-16">Nenhum dado da roleta disponível para o período selecionado.</div>
          )}
        </SectionCard>

        <SectionCard
          eyebrow="Sem prêmio"
          title="Mensagens que mais apareceram"
          description="Entenda quais opções sem prêmio apareceram mais vezes na roleta."
        >
          {rewardsQuery.isPending ? (
            <div className="admin-empty-state py-16">Carregando mensagens sem prêmio...</div>
          ) : rewardsQuery.data?.noPrizeBreakdown.length ? (
            <div className="admin-table-shell">
              <div className="report-table-head hidden grid-cols-[minmax(0,1fr)_120px] gap-3 sm:grid">
                <div>Mensagem</div>
                <div>Ocorrências</div>
              </div>

              <div className="divide-y divide-slate-200">
                {rewardsQuery.data.noPrizeBreakdown.map((item) => (
                  <div key={item.label} className="report-table-row grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px] sm:items-center sm:gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 sm:hidden">Mensagem</p>
                      <p className="truncate text-sm font-semibold text-slate-950">{item.label}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 sm:hidden">Ocorrências</p>
                      <span className="admin-badge bg-white">{item.count} vez(es)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="admin-empty-state py-16">
              Nenhuma opção sem prêmio foi registrada no período selecionado.
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          eyebrow="Estoque"
          title="Prêmios e saldo restante"
          description="Acompanhe o que já saiu, o estoque restante por prêmio e quantas vezes cada item saiu no período."
        >
          {rewardsQuery.isPending ? (
            <div className="admin-empty-state py-16">Carregando estoque da campanha...</div>
          ) : rewardsQuery.data?.stock.length ? (
            <div className="admin-table-shell">
              <div className="report-table-head hidden grid-cols-[minmax(0,1.3fr)_120px_140px_140px] gap-3 lg:grid">
                <div>Prêmio</div>
                <div>No período</div>
                <div>Entregues</div>
                <div>Estoque restante</div>
              </div>

              <div className="divide-y divide-slate-200">
                {rewardsQuery.data.stock.map((item) => (
                  <article key={item.id} className="report-table-row">
                    <div className="hidden items-center gap-3 lg:grid lg:grid-cols-[minmax(0,1.3fr)_120px_140px_140px]">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">{item.title}</p>
                      </div>
                      <div className="text-sm text-slate-700">{item.winsInRange}</div>
                      <div className="text-sm text-slate-700">
                        {item.quantityAwarded}/{item.quantityTotal}
                      </div>
                      <div className="text-sm font-semibold text-slate-950">{item.remainingStock}</div>
                    </div>

                    <div className="grid gap-2 lg:hidden">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Prêmio</p>
                          <p className="truncate text-sm font-semibold text-slate-950">{item.title}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Restante</p>
                          <p className="text-sm font-semibold text-slate-950">{item.remainingStock}</p>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">No período</p>
                          <p className="text-sm text-slate-700">{item.winsInRange}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Entregues</p>
                          <p className="text-sm text-slate-700">
                            {item.quantityAwarded}/{item.quantityTotal}
                          </p>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="admin-empty-state py-16">
              Nenhum prêmio cadastrado ou nenhuma campanha de roleta encontrada para esta pesquisa.
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          eyebrow="Participantes"
          title="Dados coletados"
          description="Nome, WhatsApp, email e aniversário ficam disponíveis aqui para leitura operacional e futuras campanhas."
        >
          {respondentsQuery.isPending ? (
            <div className="admin-empty-state py-16">Carregando participantes...</div>
          ) : respondentsQuery.data?.pagination.totalItems ? (
            <div className="space-y-3">
              <div className="report-summary-strip">
                Total coletado no período: <strong>{respondentsQuery.data.pagination.totalItems}</strong> participante(s).
              </div>

              <div className="admin-table-shell">
                <div className="report-table-head hidden grid-cols-[minmax(0,1.2fr)_minmax(0,0.95fr)_minmax(0,1fr)_120px_220px] gap-3 lg:grid">
                  <div>Participante</div>
                  <div>WhatsApp</div>
                  <div>E-mail</div>
                  <div>Aniversário</div>
                  <div>Data</div>
                </div>

                <div className="divide-y divide-slate-200">
                  {respondentsQuery.data.respondents.map((respondent) => (
                    <article key={respondent.id} className="report-table-row">
                      <div className="hidden items-center gap-3 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.95fr)_minmax(0,1fr)_120px_220px]">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-950">
                            {respondent.name || 'Sem nome informado'}
                          </p>
                        </div>
                        <div className="min-w-0 text-sm text-slate-700">{respondent.phone || '-'}</div>
                        <div className="min-w-0 truncate text-sm text-slate-700">{respondent.email || '-'}</div>
                        <div className="text-sm text-slate-700">{respondent.birthdayLabel || '-'}</div>
                        <div className="text-sm text-slate-500">{respondent.submittedAt}</div>
                      </div>

                      <div className="grid gap-2 lg:hidden">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Participante</p>
                            <p className="truncate text-sm font-semibold text-slate-950">
                              {respondent.name || 'Sem nome informado'}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Aniversário</p>
                            <p className="text-sm text-slate-700">{respondent.birthdayLabel || '-'}</p>
                          </div>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">WhatsApp</p>
                            <p className="text-sm text-slate-700">{respondent.phone || '-'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">E-mail</p>
                            <p className="truncate text-sm text-slate-700">{respondent.email || '-'}</p>
                          </div>
                        </div>

                        <div>
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Data</p>
                          <p className="text-sm text-slate-500">{respondent.submittedAt}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                <PaginationControls
                  pagination={respondentsQuery.data.pagination}
                  onPageChange={setRespondentsPage}
                  onPageSizeChange={setRespondentsPageSize}
                />
              </div>
            </div>
          ) : (
            <div className="admin-empty-state py-16">
              Nenhum participante disponível para o período selecionado.
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          eyebrow="Ganhadores"
          title="Quem ganhou e o que ganhou"
          description="Registro operacional da campanha com nome, WhatsApp, email, prêmio e protocolo entregue."
        >
          {rewardsQuery.isPending ? (
            <div className="admin-empty-state py-16">Carregando ganhadores...</div>
          ) : rewardsQuery.data ? (
            <div className="space-y-3">
              <div className="report-filter-panel grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_180px_220px_180px_auto]">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-slate-600">Nome</span>
                  <input
                    value={winnerNameFilter}
                    onChange={(event) => setWinnerNameFilter(event.target.value)}
                    placeholder="Ex: Maria"
                    className="admin-input"
                  />
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-slate-600">WhatsApp</span>
                  <input
                    value={winnerPhoneFilter}
                    onChange={(event) => setWinnerPhoneFilter(event.target.value)}
                    placeholder="Ex: 2199"
                    className="admin-input"
                  />
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-slate-600">Prêmio</span>
                  <input
                    value={winnerPrizeFilter}
                    onChange={(event) => setWinnerPrizeFilter(event.target.value)}
                    placeholder="Ex: Vale-compras"
                    className="admin-input"
                  />
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-slate-600">Protocolo</span>
                  <input
                    value={winnerCouponFilter}
                    onChange={(event) => setWinnerCouponFilter(event.target.value)}
                    placeholder="Ex: 202607281234567"
                    className="admin-input"
                  />
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-slate-600">Status</span>
                  <select
                    value={winnerStatusFilter}
                    onChange={(event) => setWinnerStatusFilter(event.target.value as WinnerStatusFilter)}
                    className="admin-select"
                  >
                    <option value="all">Todos</option>
                    <option value="pending">Pendentes</option>
                    <option value="delivered">Entregues</option>
                    <option value="cancelled">Cancelados</option>
                  </select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-slate-600">Ordenar por</span>
                  <select
                    value={winnerSortField}
                    onChange={(event) => setWinnerSortField(event.target.value as WinnerSortField)}
                    className="admin-select"
                  >
                    <option value="awardedAt">Data da premiação</option>
                    <option value="name">Nome</option>
                    <option value="itemTitle">Prêmio</option>
                  </select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-slate-600">Direção</span>
                  <select
                    value={winnerSortDirection}
                    onChange={(event) => setWinnerSortDirection(event.target.value as WinnerSortDirection)}
                    className="admin-select"
                  >
                    <option value="desc">Decrescente</option>
                    <option value="asc">Crescente</option>
                  </select>
                </label>

                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setWinnerNameFilter('')
                      setWinnerPhoneFilter('')
                      setWinnerPrizeFilter('')
                      setWinnerCouponFilter('')
                      setWinnerStatusFilter('all')
                      setWinnerSortField('awardedAt')
                      setWinnerSortDirection('desc')
                      setWinnersPageSize(20)
                    }}
                    className="admin-button w-full"
                  >
                    Limpar filtros
                  </button>
                </div>
              </div>

              <div className="report-summary-strip">
                Exibindo <strong>{rewardsQuery.data.winnersPagination.totalItems}</strong> ganhador(es) filtrado(s) no período.
                {' '}Pendentes: <strong>{rewardsQuery.data.summary.pending_redemptions}</strong>. Entregues:{' '}
                <strong>{rewardsQuery.data.summary.delivered_redemptions}</strong>. Local de retirada:{' '}
                <strong>{rewardsQuery.data.pickupAddress || 'Não informado'}</strong>.
              </div>

              {testResponseCount > 0 && (
                <div className="admin-alert flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 text-amber-900">
                  <span>
                    Há <strong>{testResponseCount}</strong> resposta(s) de teste nesta pesquisa.
                  </span>
                  <button
                    type="button"
                    disabled={cleanupTestResponsesMutation.isPending}
                    onClick={() => {
                      if (confirm(`Tem certeza que deseja remover todas as ${testResponseCount} resposta(s) de teste?\n\nPrêmios ganhos serão devolvidos ao estoque.`)) {
                        void cleanupTestResponsesMutation.mutateAsync()
                      }
                    }}
                    className="admin-button whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cleanupTestResponsesMutation.isPending ? 'Limpando...' : 'Limpar respostas de teste'}
                  </button>
                </div>
              )}

              {rewardsQuery.data.winnersPagination.totalItems ? (
                <div className="admin-table-shell">
                  <div className="report-table-head hidden grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,0.8fr)_140px_180px_160px_220px] gap-3 xl:grid">
                    <div>Ganhador</div>
                    <div>WhatsApp</div>
                    <div>E-mail</div>
                    <div>Prêmio</div>
                    <div>Protocolo</div>
                    <div>Status</div>
                    <div>Retirado em</div>
                    <div>Recebido por</div>
                    <div>Ações</div>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {rewardsQuery.data.winners.map((winner) => {
                      const isUpdating =
                        updateRedemptionMutation.isPending &&
                        updateRedemptionMutation.variables?.winId === winner.id

                      const statusLabel =
                        winner.redemptionStatus === 'delivered'
                          ? 'Entregue'
                          : winner.redemptionStatus === 'cancelled'
                            ? 'Cancelado'
                            : 'Pendente'

                      const statusClass =
                        winner.redemptionStatus === 'delivered'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : winner.redemptionStatus === 'cancelled'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'bg-white'
                      const expirationLabel = winner.isExpired ? 'Expirado' : 'No prazo'
                      const expirationClass = winner.isExpired
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : 'border-sky-200 bg-sky-50 text-sky-700'

                      return (
                        <article key={winner.id} className="report-table-row">
                          <div className="hidden items-center gap-3 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,0.8fr)_140px_180px_160px_220px]">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-950">{winner.name || 'Sem nome informado'}</p>
                              <p className="truncate text-xs text-slate-500">{formatDateTimeLabel(winner.awardedAt)}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={`admin-badge ${expirationClass}`}>{expirationLabel}</span>
                                <span className="text-xs text-slate-500">Válido até {formatDateLabel(winner.expiresAt)}</span>
                              </div>
                            </div>
                            <div className="min-w-0 text-sm text-slate-700">{winner.phone || '-'}</div>
                            <div className="min-w-0 truncate text-sm text-slate-700">{winner.email || '-'}</div>
                            <div className="min-w-0 truncate text-sm text-slate-700">{winner.itemTitle}</div>
                            <div className="min-w-0 truncate text-sm font-medium text-slate-900">{winner.couponCode}</div>
                            <div>
                              <span className={`admin-badge ${statusClass}`}>{statusLabel}</span>
                            </div>
                            <div className="text-sm text-slate-500">{formatDateTimeLabel(winner.deliveredAt)}</div>
                            <div className="min-w-0 truncate text-sm text-slate-700">{winner.receivedBy || '-'}</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'pending' })}
                                className="admin-button disabled:opacity-60"
                              >
                                Pendente
                              </button>
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => {
                                  if (requireReceiverIdentity) {
                                    setDeliveryModalWinId(winner.id)
                                    setDeliveryModalReceivedBy('')
                                    setDeliveryModalOpen(true)
                                  } else {
                                    void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'delivered' })
                                  }
                                }}
                                className="admin-button-primary disabled:opacity-60"
                              >
                                Entregue
                              </button>
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'cancelled' })}
                                className="admin-button-danger disabled:opacity-60"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>

                          <div className="grid gap-2 xl:hidden">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Ganhador</p>
                                <p className="truncate text-sm font-semibold text-slate-950">{winner.name || 'Sem nome informado'}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span className={`admin-badge ${expirationClass}`}>{expirationLabel}</span>
                                  <span className="text-xs text-slate-500">Válido até {formatDateLabel(winner.expiresAt)}</span>
                                </div>
                              </div>
                              <span className={`admin-badge ${statusClass}`}>{statusLabel}</span>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">WhatsApp</p>
                                <p className="text-sm text-slate-700">{winner.phone || '-'}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">E-mail</p>
                                <p className="truncate text-sm text-slate-700">{winner.email || '-'}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Prêmio</p>
                                <p className="truncate text-sm text-slate-700">{winner.itemTitle}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Protocolo</p>
                                <p className="text-sm font-medium text-slate-900">{winner.couponCode}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Premiação</p>
                                <p className="text-sm text-slate-500">{formatDateTimeLabel(winner.awardedAt)}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Validade</p>
                                <p className="text-sm text-slate-700">{formatDateLabel(winner.expiresAt)}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Retirado em</p>
                                <p className="text-sm text-slate-500">{formatDateTimeLabel(winner.deliveredAt)}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Recebido por</p>
                                <p className="text-sm text-slate-700">{winner.receivedBy || '-'}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'pending' })}
                                className="admin-button disabled:opacity-60"
                              >
                                Pendente
                              </button>
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => {
                                  if (requireReceiverIdentity) {
                                    setDeliveryModalWinId(winner.id)
                                    setDeliveryModalReceivedBy('')
                                    setDeliveryModalOpen(true)
                                  } else {
                                    void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'delivered' })
                                  }
                                }}
                                className="admin-button-primary disabled:opacity-60"
                              >
                                Entregue
                              </button>
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'cancelled' })}
                                className="admin-button-danger disabled:opacity-60"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>

                  <PaginationControls
                    pagination={rewardsQuery.data.winnersPagination}
                    onPageChange={setWinnersPage}
                    onPageSizeChange={setWinnersPageSize}
                  />
                </div>
              ) : (
                <div className="admin-empty-state py-16">
                  {totalWinnersInRange
                    ? 'Nenhum ganhador encontrado com os filtros informados.'
                    : 'Nenhum ganhador registrado para o período selecionado.'}
                </div>
              )}
            </div>
          ) : (
            <div className="admin-empty-state py-16">
              Nenhum ganhador registrado para o período selecionado.
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          eyebrow="Perguntas"
          title="Desempenho por pergunta"
          description="Veja distribuição, taxa de conclusão, médias e uma leitura mais rica de NPS e campos abertos."
        >
          {questionsQuery.isPending ? (
            <div className="admin-empty-state py-16">Carregando desempenho por pergunta...</div>
          ) : questionsQuery.data?.questions.length ? (
            <div className="space-y-3">
              {questionsQuery.data.questions.map((question, index) => (
                <article key={question.id} className="report-filter-panel">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Pergunta {index + 1}</p>
                        <span className="admin-badge border-slate-900 bg-slate-950 text-white">
                          {getQuestionTypeLabel(question.type)}
                        </span>
                      </div>
                      <h3 className="mt-2 text-base font-semibold text-slate-950">{question.title}</h3>
                      {question.description ? <p className="mt-1 text-sm text-slate-600">{question.description}</p> : null}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[420px] xl:grid-cols-4">
                      <div className="admin-subcard px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Respostas</p>
                        <p className="mt-1 text-sm font-semibold text-slate-950">{question.totalAnswers}</p>
                      </div>
                      <div className="admin-subcard px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Conclusão</p>
                        <p className="mt-1 text-sm font-semibold text-slate-950">{question.completionRate}%</p>
                      </div>
                      {question.averageScore !== undefined ? (
                        <div className="admin-subcard px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Média</p>
                          <p className="mt-1 text-sm font-semibold text-slate-950">{question.averageScore}</p>
                        </div>
                      ) : null}
                      {question.nps ? (
                        <div className="admin-subcard px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">NPS</p>
                          <p className="mt-1 text-sm font-semibold text-slate-950">{question.nps.score}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {question.nps ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="admin-subcard px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Promotores</p>
                        <p className="mt-1 text-sm font-semibold text-emerald-600">{question.nps.promoters}</p>
                      </div>
                      <div className="admin-subcard px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Neutros</p>
                        <p className="mt-1 text-sm font-semibold text-amber-600">{question.nps.neutrals}</p>
                      </div>
                      <div className="admin-subcard px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Detratores</p>
                        <p className="mt-1 text-sm font-semibold text-rose-600">{question.nps.detractors}</p>
                      </div>
                    </div>
                  ) : null}

                  {question.distribution?.length ? (
                    <div className="mt-3 space-y-2">
                      {question.distribution.slice(0, 8).map((item, barIndex) => (
                        <div key={`${question.id}-${item.label}`}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                            <span className="truncate font-medium text-slate-700">{item.label}</span>
                            <span className="shrink-0 text-slate-500">
                              {item.count} ({item.percentage}%)
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden bg-slate-100" style={{ borderRadius: 999 }}>
                            <div
                              className={`h-full ${getDistributionBarColor(barIndex)}`}
                              style={{ width: `${Math.max(item.percentage, item.count > 0 ? 2 : 0)}%`, borderRadius: 999 }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {question.textSamples?.length ? (
                    <TextSamplesList samples={question.textSamples} questionId={question.id} />
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="admin-empty-state py-16">
              Nenhum dado por pergunta disponível para o período selecionado.
            </div>
          )}
        </SectionCard>
      </div>

      {deliveryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Confirmar entrega</h3>
            <p className="mt-1 text-sm text-slate-500">
              Informe o nome ou documento de quem está retirando o prêmio.
            </p>
            <label className="mt-4 grid gap-2 text-sm">
              <span className="text-slate-600">Recebido por</span>
              <input
                className="admin-input"
                value={deliveryModalReceivedBy}
                onChange={(event) => setDeliveryModalReceivedBy(event.target.value)}
                placeholder="Ex: João da Silva ou CPF 123.456.789-00"
                autoFocus
                required
              />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeliveryModalOpen(false)}
                className="admin-button"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={updateRedemptionMutation.isPending || !deliveryModalReceivedBy.trim()}
                onClick={() => {
                  void updateRedemptionMutation
                    .mutateAsync({
                      winId: deliveryModalWinId,
                      status: 'delivered',
                      receivedBy: deliveryModalReceivedBy.trim(),
                    })
                    .then(() => setDeliveryModalOpen(false))
                }}
                className="admin-button-primary disabled:opacity-60"
              >
                {updateRedemptionMutation.isPending ? 'Confirmando...' : 'Confirmar entrega'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </AppShell>
  )
}
