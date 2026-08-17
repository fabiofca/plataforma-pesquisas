import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { SurveyNavBar } from '@/components/surveys/SurveyNavBar'
import { SectionCard } from '@/components/ui/SectionCard'
import { apiRequest } from '@/lib/api-client'

type PaginationMeta = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

type Winner = {
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
  winners: Winner[]
  winnersPagination: PaginationMeta
}

type WinnerStatusFilter = 'all' | 'pending' | 'delivered' | 'cancelled'
type WinnerSortField = 'awardedAt' | 'name' | 'itemTitle'
type WinnerSortDirection = 'asc' | 'desc'
type DeliveryPeriodPreset = 'today' | '7d' | '30d' | 'all_time' | 'custom'

function formatDateTimeLabel(value?: string | null) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(parsed)
}

function formatDateLabel(value?: string | null) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed)
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

function buildReportParams(
  range: { startDate: string; endDate: string },
  extra?: Record<string, string | number | undefined>,
) {
  const params = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate })
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== '') params.set(key, String(value))
    }
  }
  return params
}

export function DeliveryControlPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()

  const surveyMetaQuery = useQuery({
    queryKey: ['survey-title', id],
    queryFn: async () => {
      const response = await apiRequest<{ survey: { title: string; created_at?: string | null } }>(`/surveys/${id}`)
      return response.survey
    },
    enabled: Boolean(id),
  })

  const defaultEndDate = formatDateInput(getDateDaysAgo(0))
  const defaultStartDate = formatDateInput(getDateDaysAgo(29))
  const [startDate, setStartDate] = useState(defaultStartDate)
  const [endDate, setEndDate] = useState(defaultEndDate)
  const [periodPreset, setPeriodPreset] = useState<DeliveryPeriodPreset>('all_time')

  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<WinnerStatusFilter>('all')
  const [sortField, setSortField] = useState<WinnerSortField>('awardedAt')
  const [sortDirection, setSortDirection] = useState<WinnerSortDirection>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false)
  const [deliveryModalWinId, setDeliveryModalWinId] = useState('')
  const [deliveryModalReceivedBy, setDeliveryModalReceivedBy] = useState('')

  useEffect(() => { setPage(1) }, [debouncedSearch, statusFilter, sortField, sortDirection, pageSize, startDate, endDate, periodPreset])

  // Debounce search to avoid losing input focus on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 400)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const surveyCreatedDate = useMemo(() => {
    const createdAt = surveyMetaQuery.data?.created_at

    if (!createdAt) {
      return defaultStartDate
    }

    const normalizedCreatedAt = formatDateInput(new Date(createdAt))
    return normalizedCreatedAt && normalizedCreatedAt !== 'NaN-NaN-NaN' ? normalizedCreatedAt : defaultStartDate
  }, [defaultStartDate, surveyMetaQuery.data?.created_at])

  const effectiveRange = useMemo(() => {
    switch (periodPreset) {
      case 'today':
        return { startDate: defaultEndDate, endDate: defaultEndDate }
      case '7d':
        return { startDate: formatDateInput(getDateDaysAgo(6)), endDate: defaultEndDate }
      case '30d':
        return { startDate: formatDateInput(getDateDaysAgo(29)), endDate: defaultEndDate }
      case 'all_time':
        return { startDate: surveyCreatedDate, endDate: defaultEndDate }
      case 'custom':
      default:
        return { startDate, endDate }
    }
  }, [defaultEndDate, endDate, periodPreset, startDate, surveyCreatedDate])

  const effectiveStartDate = effectiveRange.startDate
  const effectiveEndDate = effectiveRange.endDate
  const isInvalidRange = periodPreset === 'custom' && (!startDate || !endDate || startDate > endDate)

  // Parse search: if it's a short number (4+ digits), treat as protocol suffix
  const parsedSearch = useMemo(() => {
    const trimmed = debouncedSearch.trim()
    if (/^\d{4,}$/.test(trimmed)) return { coupon: trimmed, name: '', phone: '', prize: '' }
    return { coupon: '', name: trimmed, phone: trimmed, prize: trimmed }
  }, [debouncedSearch])

  const rewardsQuery = useQuery({
    queryKey: ['delivery-control', id, effectiveStartDate, effectiveEndDate, parsedSearch, statusFilter, sortField, sortDirection, page, pageSize],
    queryFn: async () => {
      const params = buildReportParams({ startDate: effectiveStartDate, endDate: effectiveEndDate }, {
        name: parsedSearch.name || undefined,
        phone: parsedSearch.phone || undefined,
        prize: parsedSearch.prize || undefined,
        coupon: parsedSearch.coupon || undefined,
        status: statusFilter,
        sortField,
        sortDirection,
        page,
        pageSize,
      })
      return apiRequest<RewardsResponse>(`/surveys/${id}/reports/rewards?${params.toString()}`)
    },
    enabled: Boolean(id) && !isInvalidRange,
    retry: 0,
  })

  const requireReceiverIdentity = rewardsQuery.data?.requireReceiverIdentity ?? false

  const updateRedemptionMutation = useMutation({
    mutationFn: async (payload: { winId: string; status: 'pending' | 'delivered' | 'cancelled'; receivedBy?: string }) =>
      apiRequest<{ ok: boolean }>(`/rewards/wins/${payload.winId}/redemption`, {
        method: 'PATCH',
        body: JSON.stringify({ status: payload.status, redemptionNotes: '', receivedBy: payload.receivedBy ?? '' }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery-control', id] })
    },
  })

  const winners = rewardsQuery.data?.winners ?? []
  const pagination = rewardsQuery.data?.winnersPagination
  const pendingCount = Number(rewardsQuery.data?.summary.pending_redemptions ?? 0)
  const deliveredCount = Number(rewardsQuery.data?.summary.delivered_redemptions ?? 0)
  const pickupAddress = rewardsQuery.data?.pickupAddress
  const surveyCreatedLabel = useMemo(() => formatDateLabel(surveyMetaQuery.data?.created_at ?? surveyCreatedDate), [surveyCreatedDate, surveyMetaQuery.data?.created_at])

  return (
    <AppShell title="Controle de entrega" subtitle="" hideHeader>
      <SurveyNavBar surveyId={id!} surveyTitle={surveyMetaQuery.data?.title} activeTab="delivery" />

      <div className="p-3 sm:p-4 lg:p-5">
        <SectionCard
          eyebrow="Entregas"
          title="Controle de entrega dos prêmios"
          description="Gerencie a entrega dos prêmios, busque ganhadores por nome, telefone, prêmio ou protocolo."
        >
          {rewardsQuery.isPending ? (
            <div className="admin-empty-state py-16">Carregando...</div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.15fr)]">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Período analisado</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {[
                        ['today', 'Hoje'],
                        ['7d', '7 dias'],
                        ['30d', '30 dias'],
                        ['all_time', 'Desde a criação'],
                        ['custom', 'Personalizado'],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setPeriodPreset(value as DeliveryPeriodPreset)}
                          className={`px-4 py-2 text-sm font-semibold transition ${
                            periodPreset === value
                              ? 'bg-slate-950 text-white'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                          style={{ borderRadius: 8 }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-lg font-semibold text-slate-950">
                      {periodPreset === 'all_time'
                        ? `Desde ${surveyCreatedLabel}`
                        : `${formatDateLabel(effectiveStartDate)} até ${formatDateLabel(effectiveEndDate)}`}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {periodPreset === 'all_time'
                        ? 'Toda a campanha desde a criação da pesquisa.'
                        : periodPreset === 'custom'
                          ? 'Janela manual definida para a consulta atual.'
                          : 'Período rápido aplicado para facilitar a operação.'}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Resumo rápido</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-[repeat(3,minmax(120px,1fr))]">
                      <div>
                        <p className="text-2xl font-semibold text-slate-950">{pagination?.totalItems ?? 0}</p>
                        <p className="text-sm text-slate-500">Ganhadores exibidos</p>
                      </div>
                      <div>
                        <p className="text-2xl font-semibold text-amber-600">{pendingCount}</p>
                        <p className="text-sm text-slate-500">Pendentes</p>
                      </div>
                      <div>
                        <p className="text-2xl font-semibold text-emerald-600">{deliveredCount}</p>
                        <p className="text-sm text-slate-500">Entregues</p>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Local de retirada</p>
                      <p className="mt-1 text-sm text-slate-700">{pickupAddress || 'Não informado'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Filtro principal</p>
                    <p className="text-sm text-slate-600">
                      Busque rapidamente por protocolo, nome, telefone ou prêmio para localizar o ganhador.
                    </p>
                  </div>

                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(320px,1.4fr)_190px_220px_180px]">
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-slate-600">Buscar ganhador</span>
                      <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Nome, telefone, prêmio ou 4 últimos dígitos do protocolo"
                        className="admin-input"
                      />
                    </label>

                    <label className="grid gap-1.5 text-sm">
                      <span className="text-slate-600">Status</span>
                      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as WinnerStatusFilter)} className="admin-select">
                        <option value="all">Todos</option>
                        <option value="pending">Pendentes</option>
                        <option value="delivered">Entregues</option>
                        <option value="cancelled">Cancelados</option>
                      </select>
                    </label>

                    <label className="grid gap-1.5 text-sm">
                      <span className="text-slate-600">Ordenação</span>
                      <select value={sortField} onChange={(e) => setSortField(e.target.value as WinnerSortField)} className="admin-select">
                        <option value="awardedAt">Data da premiação</option>
                        <option value="name">Nome</option>
                        <option value="itemTitle">Prêmio</option>
                      </select>
                    </label>

                    <label className="grid gap-1.5 text-sm">
                      <span className="text-slate-600">Direção</span>
                      <select value={sortDirection} onChange={(e) => setSortDirection(e.target.value as WinnerSortDirection)} className="admin-select">
                        <option value="desc">Decrescente</option>
                        <option value="asc">Crescente</option>
                      </select>
                    </label>
                  </div>

                  {periodPreset === 'custom' ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:max-w-[420px]">
                      <label className="grid gap-1.5 text-sm">
                        <span className="text-slate-600">De</span>
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="admin-input" />
                      </label>
                      <label className="grid gap-1.5 text-sm">
                        <span className="text-slate-600">Até</span>
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="admin-input" />
                      </label>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Table */}
              {winners.length > 0 ? (
                <div className="admin-table-shell">
                  <div className="report-table-head hidden grid-cols-[minmax(220px,1.15fr)_minmax(220px,1fr)_minmax(160px,0.9fr)_minmax(190px,0.95fr)_170px_210px] gap-4 xl:grid">
                    <div>Ganhador</div>
                    <div>Contato</div>
                    <div>Prêmio</div>
                    <div>Protocolo e status</div>
                    <div>Retirado em</div>
                    <div>Ações</div>
                  </div>

                  <div className="space-y-3 p-3">
                    {winners.map((winner) => {
                      const isUpdating = updateRedemptionMutation.isPending && updateRedemptionMutation.variables?.winId === winner.id
                      const statusLabel = winner.redemptionStatus === 'delivered' ? 'Entregue' : winner.redemptionStatus === 'cancelled' ? 'Cancelado' : 'Pendente'
                      const statusClass = winner.redemptionStatus === 'delivered' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : winner.redemptionStatus === 'cancelled' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'bg-white'
                      const expirationLabel = winner.isExpired ? 'Expirado' : 'No prazo'
                      const expirationClass = winner.isExpired ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-sky-200 bg-sky-50 text-sky-700'
                      const rowClass =
                        winner.redemptionStatus === 'delivered'
                          ? 'border-emerald-200 bg-emerald-50/70 shadow-[0_10px_30px_rgba(16,185,129,0.08)]'
                          : winner.redemptionStatus === 'cancelled'
                            ? 'border-rose-200 bg-rose-50/40'
                            : 'border-slate-200 bg-white'

                      return (
                        <article key={winner.id} className={`report-table-row rounded-2xl border p-4 ${rowClass}`}>
                          {/* Desktop */}
                          <div className="hidden items-center gap-4 xl:grid xl:grid-cols-[minmax(220px,1.15fr)_minmax(220px,1fr)_minmax(160px,0.9fr)_minmax(190px,0.95fr)_170px_210px]">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-950">{winner.name || 'Sem nome informado'}</p>
                              <p className="truncate text-xs text-slate-500">{formatDateTimeLabel(winner.awardedAt)}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={`admin-badge ${expirationClass}`}>{expirationLabel}</span>
                                <span className="text-xs text-slate-500">Válido até {formatDateLabel(winner.expiresAt)}</span>
                              </div>
                            </div>
                            <div className="min-w-0 space-y-2">
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">WhatsApp</p>
                                <p className="text-sm text-slate-700 break-all">{winner.phone || '-'}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">E-mail</p>
                                <p className="truncate text-sm text-slate-700">{winner.email || '-'}</p>
                              </div>
                            </div>
                            <div className="min-w-0">
                              <p className="break-words text-sm text-slate-700">{winner.itemTitle}</p>
                            </div>
                            <div className="min-w-0 space-y-2">
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Protocolo</p>
                                <p className="text-sm font-medium text-slate-900 break-all">{winner.couponCode}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`admin-badge ${statusClass}`}>{statusLabel}</span>
                                {winner.redemptionStatus === 'delivered' ? (
                                  <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                    Ja entregue
                                  </span>
                                ) : null}
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Recebido por</p>
                                <p className="truncate text-sm text-slate-700">{winner.receivedBy || '-'}</p>
                              </div>
                            </div>
                            <div className="text-sm text-slate-500">{formatDateTimeLabel(winner.deliveredAt)}</div>
                            <div className="grid gap-2">
                              <button type="button" disabled={isUpdating} onClick={() => void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'pending' })} className="admin-button disabled:opacity-60">Pendente</button>
                              <button type="button" disabled={isUpdating} onClick={() => {
                                if (requireReceiverIdentity) {
                                  setDeliveryModalWinId(winner.id)
                                  setDeliveryModalReceivedBy('')
                                  setDeliveryModalOpen(true)
                                } else {
                                  void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'delivered' })
                                }
                              }} className="admin-button-primary disabled:opacity-60">Entregue</button>
                              <button type="button" disabled={isUpdating} onClick={() => void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'cancelled' })} className="admin-button-danger disabled:opacity-60">Cancelar</button>
                            </div>
                          </div>

                          {/* Mobile */}
                          <div className="grid gap-3 xl:hidden">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Ganhador</p>
                                <p className="text-sm font-semibold text-slate-950 break-words">{winner.name || 'Sem nome informado'}</p>
                                <p className="mt-1 text-xs text-slate-500">{formatDateTimeLabel(winner.awardedAt)}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span className={`admin-badge ${expirationClass}`}>{expirationLabel}</span>
                                  <span className="text-xs text-slate-500">Válido até {formatDateLabel(winner.expiresAt)}</span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <span className={`admin-badge ${statusClass}`}>{statusLabel}</span>
                                {winner.redemptionStatus === 'delivered' ? (
                                  <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                    Ja entregue
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">WhatsApp</p>
                                <p className="mt-1 text-sm text-slate-700 break-all">{winner.phone || '-'}</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">E-mail</p>
                                <p className="mt-1 text-sm text-slate-700 break-all">{winner.email || '-'}</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Prêmio</p>
                                <p className="mt-1 text-sm text-slate-700 break-words">{winner.itemTitle}</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Protocolo</p>
                                <p className="mt-1 text-sm font-medium text-slate-900 break-all">{winner.couponCode}</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Retirado em</p>
                                <p className="mt-1 text-sm text-slate-500">{formatDateTimeLabel(winner.deliveredAt)}</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Recebido por</p>
                                <p className="mt-1 text-sm text-slate-700 break-words">{winner.receivedBy || '-'}</p>
                              </div>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-3">
                              <button type="button" disabled={isUpdating} onClick={() => void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'pending' })} className="admin-button disabled:opacity-60">Pendente</button>
                              <button type="button" disabled={isUpdating} onClick={() => {
                                if (requireReceiverIdentity) {
                                  setDeliveryModalWinId(winner.id)
                                  setDeliveryModalReceivedBy('')
                                  setDeliveryModalOpen(true)
                                } else {
                                  void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'delivered' })
                                }
                              }} className="admin-button-primary disabled:opacity-60">Entregue</button>
                              <button type="button" disabled={isUpdating} onClick={() => void updateRedemptionMutation.mutateAsync({ winId: winner.id, status: 'cancelled' })} className="admin-button-danger disabled:opacity-60">Cancelar</button>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>

                  {/* Pagination */}
                  {pagination && (
                    <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-slate-600">
                        Página <strong>{pagination.page}</strong> de <strong>{pagination.totalPages}</strong>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                          <span>Por página</span>
                          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="admin-select min-w-[90px]">
                            {[20, 50, 100].map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        </label>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pagination.page <= 1} className="admin-button disabled:cursor-not-allowed disabled:opacity-50">Anterior</button>
                          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={pagination.page >= pagination.totalPages} className="admin-button disabled:cursor-not-allowed disabled:opacity-50">Próxima</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="admin-empty-state py-16">
                  {searchQuery ? 'Nenhum ganhador encontrado para a busca informada.' : 'Nenhum ganhador registrado para o período selecionado.'}
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Delivery confirmation modal */}
      {deliveryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Confirmar entrega</h3>
            <p className="mt-1 text-sm text-slate-500">Informe o nome ou documento de quem está retirando o prêmio.</p>
            <label className="mt-4 grid gap-2 text-sm">
              <span className="text-slate-600">Recebido por</span>
              <input className="admin-input" value={deliveryModalReceivedBy} onChange={(e) => setDeliveryModalReceivedBy(e.target.value)} placeholder="Ex: João da Silva ou CPF 123.456.789-00" autoFocus required />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setDeliveryModalOpen(false)} className="admin-button">Cancelar</button>
              <button type="button" disabled={updateRedemptionMutation.isPending || !deliveryModalReceivedBy.trim()} onClick={() => {
                void updateRedemptionMutation.mutateAsync({ winId: deliveryModalWinId, status: 'delivered', receivedBy: deliveryModalReceivedBy.trim() }).then(() => setDeliveryModalOpen(false))
              }} className="admin-button-primary disabled:opacity-60">
                {updateRedemptionMutation.isPending ? 'Confirmando...' : 'Confirmar entrega'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
