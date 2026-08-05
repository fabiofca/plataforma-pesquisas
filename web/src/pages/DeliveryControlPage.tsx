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
  const [startDate, setStartDate] = useState(defaultStartDate)
  const [endDate, setEndDate] = useState(defaultEndDate)
  const [useFullPeriod, setUseFullPeriod] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<WinnerStatusFilter>('all')
  const [sortField, setSortField] = useState<WinnerSortField>('awardedAt')
  const [sortDirection, setSortDirection] = useState<WinnerSortDirection>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false)
  const [deliveryModalWinId, setDeliveryModalWinId] = useState('')
  const [deliveryModalReceivedBy, setDeliveryModalReceivedBy] = useState('')

  useEffect(() => { setPage(1) }, [searchQuery, statusFilter, sortField, sortDirection, pageSize, startDate, endDate, useFullPeriod])

  const effectiveStartDate = useFullPeriod ? '2020-01-01' : startDate
  const effectiveEndDate = useFullPeriod ? defaultEndDate : endDate
  const isInvalidRange = !useFullPeriod && (!startDate || !endDate || startDate > endDate)

  // Parse search: if it's a short number (4+ digits), treat as protocol suffix
  const parsedSearch = useMemo(() => {
    const trimmed = searchQuery.trim()
    if (/^\d{4,}$/.test(trimmed)) return { coupon: trimmed, name: '', phone: '', prize: '' }
    return { coupon: '', name: trimmed, phone: trimmed, prize: trimmed }
  }, [searchQuery])

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

  return (
    <AppShell title="Controle de entrega" subtitle="" hideHeader>
      <SurveyNavBar surveyId={id!} surveyTitle={surveyTitleQuery.data} activeTab="delivery" />

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
              {/* Date range */}
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={useFullPeriod}
                    onChange={(e) => setUseFullPeriod(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="font-medium text-slate-700">Período da campanha</span>
                </label>
                {!useFullPeriod && (
                  <>
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-slate-600">De</span>
                      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="admin-input" />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-slate-600">Até</span>
                      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="admin-input" />
                    </label>
                  </>
                )}
              </div>

              {/* Unified search + filters */}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_180px_180px_160px]">
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
                  <span className="text-slate-600">Ordenar por</span>
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

              {/* Summary strip */}
              <div className="report-summary-strip">
                Exibindo <strong>{pagination?.totalItems ?? 0}</strong> ganhador(es).
                {' '}Pendentes: <strong>{pendingCount}</strong>. Entregues: <strong>{deliveredCount}</strong>.
                {' '}Local de retirada: <strong>{pickupAddress || 'Não informado'}</strong>.
              </div>

              {/* Table */}
              {winners.length > 0 ? (
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
                    {winners.map((winner) => {
                      const isUpdating = updateRedemptionMutation.isPending && updateRedemptionMutation.variables?.winId === winner.id
                      const statusLabel = winner.redemptionStatus === 'delivered' ? 'Entregue' : winner.redemptionStatus === 'cancelled' ? 'Cancelado' : 'Pendente'
                      const statusClass = winner.redemptionStatus === 'delivered' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : winner.redemptionStatus === 'cancelled' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'bg-white'
                      const expirationLabel = winner.isExpired ? 'Expirado' : 'No prazo'
                      const expirationClass = winner.isExpired ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-sky-200 bg-sky-50 text-sky-700'

                      return (
                        <article key={winner.id} className="report-table-row">
                          {/* Desktop */}
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
                            <div><span className={`admin-badge ${statusClass}`}>{statusLabel}</span></div>
                            <div className="text-sm text-slate-500">{formatDateTimeLabel(winner.deliveredAt)}</div>
                            <div className="min-w-0 truncate text-sm text-slate-700">{winner.receivedBy || '-'}</div>
                            <div className="flex flex-wrap gap-2">
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
                              <div><p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">WhatsApp</p><p className="text-sm text-slate-700">{winner.phone || '-'}</p></div>
                              <div><p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Prêmio</p><p className="truncate text-sm text-slate-700">{winner.itemTitle}</p></div>
                              <div><p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Protocolo</p><p className="text-sm font-medium text-slate-900">{winner.couponCode}</p></div>
                              <div><p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Retirado em</p><p className="text-sm text-slate-500">{formatDateTimeLabel(winner.deliveredAt)}</p></div>
                              <div><p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Recebido por</p><p className="text-sm text-slate-700">{winner.receivedBy || '-'}</p></div>
                            </div>
                            <div className="flex flex-wrap gap-2">
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
