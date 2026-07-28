import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift, Plus, Target, Trash2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { PrizeWheel, getSegmentTargetRotation, type PrizeWheelSegment } from '@/components/public/PrizeWheel'
import { AdminModal } from '@/components/ui/AdminModal'
import { SectionCard } from '@/components/ui/SectionCard'
import { apiRequest } from '@/lib/api-client'

type RewardFrequencyMode = 'frequent' | 'balanced' | 'rare' | 'custom'

type RewardFormItem = {
  id?: string
  title: string
  description: string
  quantityTotal: number
  isActive: boolean
  delivered: number
  frequencyMode: RewardFrequencyMode
  customFrequencyTarget: number
}

type RewardRetryTask = {
  id: string
  type: 'google_review' | 'instagram_follow' | 'custom_link'
  title: string
  url: string
}

const maxRealRewards = 3
const maxWheelOptions = 6
const neutralLabels = [
  'Não foi dessa vez',
  'Quase!',
  'Obrigado por participar.',
  'Boa sorte na próxima',
  'Você não teve sorte',
  'Continue participando',
]

function createDefaultRewardItem(): RewardFormItem {
  return {
    title: 'Vale-compras de R$ 50',
    description: 'Exemplo de prêmio real para a roleta.',
    quantityTotal: 4,
    isActive: true,
    delivered: 0,
    frequencyMode: 'balanced',
    customFrequencyTarget: 100,
  }
}

function createEmptyRewardItem(): RewardFormItem {
  return {
    title: '',
    description: '',
    quantityTotal: 1,
    isActive: true,
    delivered: 0,
    frequencyMode: 'balanced',
    customFrequencyTarget: 100,
  }
}

function createRewardRetryTask(index: number): RewardRetryTask {
  return {
    id: `task-${Date.now()}-${index}`,
    type: 'google_review',
    title: '',
    url: '',
  }
}

function buildDemoWheelSegments(items: RewardFormItem[]) {
  const activeRewards = items.filter((item) => item.isActive && item.title.trim()).slice(0, maxRealRewards)
  const segments: PrizeWheelSegment[] = activeRewards.map((item, index) => ({
    id: item.id ?? `reward-${index}`,
    label: item.title.trim(),
    kind: 'reward',
  }))
  const missingSlots = Math.max(0, maxWheelOptions - segments.length)

  for (let index = 0; index < missingSlots; index += 1) {
    segments.push({
      id: `neutral-${index}`,
      label: neutralLabels[index % neutralLabels.length],
      kind: 'neutral',
    })
  }

  return segments
}

function getFrequencySummary(item: RewardFormItem) {
  if (item.frequencyMode === 'frequent') {
    return 'Entrega aproximada de 1 prêmio a cada 30 participações.'
  }

  if (item.frequencyMode === 'balanced') {
    return 'Entrega aproximada de 1 prêmio a cada 60 participações.'
  }

  if (item.frequencyMode === 'rare') {
    return 'Entrega aproximada de 1 prêmio a cada 120 participações.'
  }

  return `Entrega aproximada de 1 prêmio a cada ${item.customFrequencyTarget || 100} participações.`
}

export function RewardsPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const demoTimeoutRef = useRef<number | null>(null)
  const [campaignForm, setCampaignForm] = useState({
    status: 'active' as 'active' | 'paused' | 'ended',
    expiresAt: '',
    pickupAddress: '',
    contactWhatsApp: '',
    retryUnlockEnabled: false,
    retryUnlockTasks: [] as RewardRetryTask[],
  })
  const [itemsForm, setItemsForm] = useState<RewardFormItem[]>([])
  const [feedback, setFeedback] = useState('')
  const [deletingItemKey, setDeletingItemKey] = useState('')
  const [isCreateRewardModalOpen, setIsCreateRewardModalOpen] = useState(false)
  const [newRewardForm, setNewRewardForm] = useState<RewardFormItem>(createEmptyRewardItem())
  const [showDemo, setShowDemo] = useState(false)
  const [demoRotation, setDemoRotation] = useState(0)
  const [demoSpinning, setDemoSpinning] = useState(false)
  const [demoResult, setDemoResult] = useState<PrizeWheelSegment | null>(null)
  const [demoCelebrationKey, setDemoCelebrationKey] = useState(0)

  const rewardsQuery = useQuery({
    queryKey: ['rewards', id],
    queryFn: async () => {
      const response = await apiRequest<{
        campaign: {
          id?: string
          status: 'active' | 'paused' | 'ended'
          expires_at?: string | null
          pickup_address?: string | null
          contact_whatsapp?: string | null
          retry_unlock_enabled?: boolean
          retry_unlock_tasks_json?: RewardRetryTask[]
          spin_count?: number
        } | null
        items: Array<{
          id: string
          title: string
          description?: string | null
          quantity_total: number
          quantity_awarded: number
          is_active: boolean
          frequency_mode: RewardFrequencyMode
          frequency_target: number
        }>
        redemptionSummary: {
          pendingCount: number
          deliveredCount: number
          cancelledCount: number
        }
        wins: Array<{
          id: string
          awardedAt: string
          deliveredAt?: string | null
          couponCode: string
          redemptionStatus: 'pending' | 'delivered' | 'cancelled'
          redemptionNotes?: string | null
          name?: string | null
          phone?: string | null
          email?: string | null
          itemTitle: string
        }>
      }>(`/surveys/${id}/rewards`)

      return response
    },
    enabled: Boolean(id),
    retry: 0,
  })

  useEffect(() => {
    if (rewardsQuery.data?.campaign) {
      setCampaignForm({
        status: rewardsQuery.data.campaign.status,
        expiresAt: rewardsQuery.data.campaign.expires_at ?? '',
        pickupAddress: rewardsQuery.data.campaign.pickup_address ?? '',
        contactWhatsApp: rewardsQuery.data.campaign.contact_whatsapp ?? '',
        retryUnlockEnabled: rewardsQuery.data.campaign.retry_unlock_enabled ?? false,
        retryUnlockTasks: rewardsQuery.data.campaign.retry_unlock_tasks_json ?? [],
      })
    } else {
      setCampaignForm({
        status: 'active',
        expiresAt: '',
        pickupAddress: '',
        contactWhatsApp: '',
        retryUnlockEnabled: false,
        retryUnlockTasks: [],
      })
    }

    const mappedItems = (rewardsQuery.data?.items ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description ?? '',
      quantityTotal: item.quantity_total,
      isActive: item.is_active,
      delivered: item.quantity_awarded,
      frequencyMode: item.frequency_mode,
      customFrequencyTarget: item.frequency_target,
    }))

    setItemsForm(mappedItems.length ? mappedItems : [createDefaultRewardItem()])
  }, [rewardsQuery.data])

  useEffect(() => {
    return () => {
      if (demoTimeoutRef.current) {
        window.clearTimeout(demoTimeoutRef.current)
      }
    }
  }, [])

  const saveCampaignMutation = useMutation({
    mutationFn: async () =>
      apiRequest<{ ok: boolean }>(`/surveys/${id}/rewards`, {
        method: 'POST',
        body: JSON.stringify(campaignForm),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rewards', id] })
      setFeedback('Campanha da roleta salva com sucesso.')
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar a campanha.')
    },
  })

  const saveItemsMutation = useMutation({
    mutationFn: async () => {
      const filledItems = itemsForm.filter((entry) => entry.title.trim())

      if (filledItems.length > maxRealRewards) {
        throw new Error('A roleta aceita no máximo 3 tipos de prêmio.')
      }

      await apiRequest<{ ok: boolean }>(`/surveys/${id}/rewards`, {
        method: 'POST',
        body: JSON.stringify(campaignForm),
      })

      for (const item of filledItems) {
        const payload = {
          title: item.title.trim(),
          description: item.description.trim(),
          quantityTotal: Number(item.quantityTotal),
          isActive: item.isActive,
          frequencyMode: item.frequencyMode,
          customFrequencyTarget:
            item.frequencyMode === 'custom' ? Number(item.customFrequencyTarget) || 100 : undefined,
        }

        if (item.id) {
          await apiRequest<{ ok: boolean }>(`/rewards/items/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        } else {
          await apiRequest<{ ok: boolean }>(`/surveys/${id}/rewards/items`, {
            method: 'POST',
            body: JSON.stringify(payload),
          })
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rewards', id] })
      setFeedback('Prêmios da roleta atualizados com sucesso.')
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar os prêmios.')
    },
  })

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) =>
      apiRequest<{ ok: boolean }>(`/rewards/items/${itemId}`, {
        method: 'DELETE',
      }),
    onSuccess: async (_result, itemId) => {
      setItemsForm((current) => {
        const nextItems = current.filter((entry) => entry.id !== itemId)
        return nextItems.length ? nextItems : [createDefaultRewardItem()]
      })
      setDeletingItemKey('')
      await queryClient.invalidateQueries({ queryKey: ['rewards', id] })
      setFeedback('Prêmio removido com sucesso.')
    },
    onError: (error) => {
      setDeletingItemKey('')
      setFeedback(error instanceof Error ? error.message : 'Não foi possível remover o prêmio.')
    },
  })

  const updateWinStatusMutation = useMutation({
    mutationFn: async (payload: { winId: string; status: 'pending' | 'delivered' | 'cancelled' }) =>
      apiRequest<{ ok: boolean }>(`/rewards/wins/${payload.winId}/redemption`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: payload.status,
          redemptionNotes: '',
        }),
      }),
    onSuccess: async (_result, payload) => {
      await queryClient.invalidateQueries({ queryKey: ['rewards', id] })
      setFeedback(
        payload.status === 'delivered'
          ? 'Prêmio marcado como entregue.'
          : payload.status === 'cancelled'
            ? 'Premiação marcada como cancelada.'
            : 'Premiação voltou para pendente.',
      )
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível atualizar o resgate agora.')
    },
  })

  function handleOpenCreateRewardModal() {
    if (itemsForm.length >= maxRealRewards) {
      setFeedback('A roleta aceita no máximo 3 tipos de prêmio.')
      return
    }

    setFeedback('')
    setNewRewardForm(createEmptyRewardItem())
    setIsCreateRewardModalOpen(true)
  }

  function handleCloseCreateRewardModal() {
    setIsCreateRewardModalOpen(false)
    setNewRewardForm(createEmptyRewardItem())
  }

  function handleCreateRewardItem() {
    if (!newRewardForm.title.trim()) {
      setFeedback('Informe o nome do prêmio antes de criar.')
      return
    }

    setItemsForm((current) => {
      if (current.length >= maxRealRewards) {
        setFeedback('A roleta aceita no máximo 3 tipos de prêmio.')
        return current
      }

      return [
        ...current,
        {
          ...newRewardForm,
          title: newRewardForm.title.trim(),
          description: newRewardForm.description.trim(),
        },
      ]
    })
    handleCloseCreateRewardModal()
  }

  function removeLocalItem(index: number) {
    setItemsForm((current) => {
      const nextItems = current.filter((_, currentIndex) => currentIndex !== index)
      return nextItems.length ? nextItems : [createDefaultRewardItem()]
    })
    setFeedback('Prêmio removido com sucesso.')
  }

  const activeRewardsCount = useMemo(
    () => itemsForm.filter((item) => item.isActive && item.title.trim()).length,
    [itemsForm],
  )
  const demoSegments = useMemo(() => buildDemoWheelSegments(itemsForm), [itemsForm])

  const configItems = rewardsQuery.data?.campaign
    ? [
        ['Status', rewardsQuery.data.campaign.status === 'active' ? 'Ativa' : rewardsQuery.data.campaign.status === 'paused' ? 'Pausada' : 'Encerrada'],
        ['Prêmios ativos', `${activeRewardsCount}/${maxRealRewards}`],
        ['Opções na roleta', `${maxWheelOptions} no total`],
        ['Validade', rewardsQuery.data.campaign.expires_at ? rewardsQuery.data.campaign.expires_at : 'Sem validade'],
        ['Retirada', rewardsQuery.data.campaign.pickup_address ? rewardsQuery.data.campaign.pickup_address : 'Não informada'],
        ['WhatsApp de resgate', rewardsQuery.data.campaign.contact_whatsapp ? rewardsQuery.data.campaign.contact_whatsapp : 'Não informado'],
        ['Chance extra', rewardsQuery.data.campaign.retry_unlock_enabled ? `${rewardsQuery.data.campaign.retry_unlock_tasks_json?.length ?? 0} tarefa(s)` : 'Desligada'],
      ]
    : [
        ['Status', campaignForm.status === 'active' ? 'Ativa' : campaignForm.status === 'paused' ? 'Pausada' : 'Encerrada'],
        ['Prêmios ativos', `${activeRewardsCount}/${maxRealRewards}`],
        ['Opções na roleta', `${maxWheelOptions} no total`],
        ['Validade', campaignForm.expiresAt ? campaignForm.expiresAt : 'Sem validade'],
        ['Retirada', campaignForm.pickupAddress ? campaignForm.pickupAddress : 'Não informada'],
        ['WhatsApp de resgate', campaignForm.contactWhatsApp ? campaignForm.contactWhatsApp : 'Não informado'],
        ['Chance extra', campaignForm.retryUnlockEnabled ? `${campaignForm.retryUnlockTasks.length} tarefa(s)` : 'Desligada'],
      ]

  return (
    <AppShell
      title="Roleta de prêmios"
      subtitle="Configuração simples: até 3 prêmios reais e o restante da roleta preenchido automaticamente com mensagens sem prêmio."
      backHref={`/app/pesquisas/${id}`}
      backLabel="Voltar para a pesquisa"
      breadcrumbs={[
        { label: 'Pesquisas', href: '/app/pesquisas' },
        { label: 'Pesquisa', href: `/app/pesquisas/${id}` },
        { label: 'Prêmios' },
      ]}
    >
      <AdminModal
        open={isCreateRewardModalOpen}
        title="Novo prêmio"
        description="Cadastre um prêmio real pelo modal e depois salve a lista para aplicar na roleta."
        onClose={handleCloseCreateRewardModal}
      >
        <div className="grid gap-4">
          <label className="grid gap-2 text-sm">
            <span className="text-slate-600">Nome do prêmio</span>
            <input
              className="admin-input"
              value={newRewardForm.title}
              onChange={(event) => setNewRewardForm((current) => ({ ...current, title: event.target.value }))}
              required
            />
            <span className="text-xs text-slate-500">
              Na roleta, nomes longos podem aparecer abreviados para manter a leitura.
            </span>
          </label>

          <label className="grid gap-2 text-sm">
            <span className="text-slate-600">Descrição</span>
            <textarea
              className="admin-input min-h-24"
              value={newRewardForm.description}
              onChange={(event) => setNewRewardForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Estoque disponível</span>
              <input
                type="number"
                min={1}
                className="admin-input"
                value={newRewardForm.quantityTotal}
                onChange={(event) =>
                  setNewRewardForm((current) => ({ ...current, quantityTotal: Number(event.target.value) || 1 }))
                }
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Frequência</span>
              <select
                className="admin-select"
                value={newRewardForm.frequencyMode}
                onChange={(event) =>
                  setNewRewardForm((current) => ({
                    ...current,
                    frequencyMode: event.target.value as RewardFrequencyMode,
                  }))
                }
              >
                <option value="frequent">Prêmio frequente</option>
                <option value="balanced">Distribuição equilibrada</option>
                <option value="rare">Prêmio raro</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>
          </div>

          {newRewardForm.frequencyMode === 'custom' ? (
            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Meta personalizada</span>
              <input
                type="number"
                min={2}
                className="admin-input"
                value={newRewardForm.customFrequencyTarget}
                onChange={(event) =>
                  setNewRewardForm((current) => ({
                    ...current,
                    customFrequencyTarget: Number(event.target.value) || 100,
                  }))
                }
              />
            </label>
          ) : null}

          <label className="admin-checkrow">
            <input
              type="checkbox"
              checked={newRewardForm.isActive}
              onChange={(event) => setNewRewardForm((current) => ({ ...current, isActive: event.target.checked }))}
            />
            Participa da roleta
          </label>

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" onClick={handleCloseCreateRewardModal} className="admin-button">
              Cancelar
            </button>
            <button type="button" onClick={handleCreateRewardItem} className="admin-button-primary">
              Criar prêmio
            </button>
          </div>
        </div>
      </AdminModal>

      {feedback ? (
        <div
          className={`admin-alert mb-6 ${
            saveCampaignMutation.isError || saveItemsMutation.isError || deleteItemMutation.isError
              ? 'border border-rose-200 bg-rose-50 text-rose-900'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {feedback}
        </div>
      ) : null}

      {rewardsQuery.isError ? (
        <div className="admin-alert mb-6 border-amber-200 bg-amber-50 text-amber-900">
          Não foi possível carregar a campanha de prêmios agora. Verifique a API antes de editar.
        </div>
      ) : null}

      <section className="admin-page-hero mb-6 grid gap-3 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Campanha de prêmio</p>
          <h2 className="mt-1 font-display text-[22px] leading-tight text-slate-950">
            Configure a roleta com mais presença visual e sem perder o controle.
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] text-slate-600">
            Cadastre os prêmios reais, ajuste a frequência e acompanhe a demonstração antes de publicar para o público.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Prêmios ativos</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{activeRewardsCount}</p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Status</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {campaignForm.status === 'active' ? 'Ativa' : campaignForm.status === 'paused' ? 'Pausada' : 'Encerrada'}
            </p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Formato</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{maxWheelOptions} opções visuais</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <SectionCard
          eyebrow="Configuração"
          title="Parâmetros da campanha"
          description="Ative, pause ou encerre a roleta e defina uma validade opcional."
        >
          <div className="mb-4 flex flex-wrap justify-between gap-3">
            <Link to={`/app/pesquisas/${id}`} className="admin-button">
              Voltar para a pesquisa
            </Link>
          </div>

          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => void saveCampaignMutation.mutateAsync()}
              disabled={saveCampaignMutation.isPending}
              className="admin-button-primary"
            >
              {saveCampaignMutation.isPending ? 'Salvando...' : 'Salvar campanha'}
            </button>
          </div>

          <div className="space-y-3">
            {configItems.map(([label, value]) => (
              <div key={label} className="admin-highlight-card">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p>
                <p className="mt-2 font-semibold text-slate-950">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4">
            <label className="admin-subcard grid gap-2 text-sm text-slate-700">
              <span className="text-slate-600">Status da campanha</span>
              <select
                className="admin-select"
                value={campaignForm.status}
                onChange={(event) =>
                  setCampaignForm((current) => ({
                    ...current,
                    status: event.target.value as 'active' | 'paused' | 'ended',
                  }))
                }
              >
                <option value="active">Ativa</option>
                <option value="paused">Pausada</option>
                <option value="ended">Encerrada</option>
              </select>
            </label>

            <label className="admin-subcard grid gap-2 text-sm text-slate-700">
              <span className="text-slate-600">Validade da campanha (opcional)</span>
              <input
                type="date"
                className="admin-input"
                value={campaignForm.expiresAt}
                onChange={(event) =>
                  setCampaignForm((current) => ({
                    ...current,
                    expiresAt: event.target.value,
                  }))
                }
              />
            </label>

            <label className="admin-subcard grid gap-2 text-sm text-slate-700">
              <span className="text-slate-600">Endereço para retirada do prêmio</span>
              <textarea
                className="admin-input min-h-24"
                placeholder="Ex: Loja Centro, Rua Exemplo, 123, balcão de atendimento, retirar das 9h às 18h."
                value={campaignForm.pickupAddress}
                onChange={(event) =>
                  setCampaignForm((current) => ({
                    ...current,
                    pickupAddress: event.target.value,
                  }))
                }
              />
            </label>

            <label className="admin-subcard grid gap-2 text-sm text-slate-700">
              <span className="text-slate-600">WhatsApp para resgate do prêmio</span>
              <input
                type="tel"
                className="admin-input"
                placeholder="Ex: 5511999998888 ou (11) 99999-8888"
                value={campaignForm.contactWhatsApp}
                onChange={(event) =>
                  setCampaignForm((current) => ({
                    ...current,
                    contactWhatsApp: event.target.value,
                  }))
                }
              />
            </label>

            <div className="admin-subcard grid gap-3 text-sm text-slate-700">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={campaignForm.retryUnlockEnabled}
                  onChange={(event) =>
                    setCampaignForm((current) => ({
                      ...current,
                      retryUnlockEnabled: event.target.checked,
                      retryUnlockTasks: event.target.checked ? current.retryUnlockTasks : [],
                    }))
                  }
                />
                Ativar mais uma chance depois que o cliente não ganhar
              </label>

              {campaignForm.retryUnlockEnabled ? (
                <div className="grid gap-3">
                  <div className="admin-alert border-amber-200 bg-amber-50 text-amber-900">
                    Se o cliente não ganhar, o sistema mostra <strong>uma tarefa por vez</strong>. Cada tarefa confirmada libera um
                    novo giro, e a próxima tarefa só aparece se ele ainda não ganhar.
                  </div>

                  {campaignForm.retryUnlockTasks.map((task, index) => (
                    <article key={task.id} className="admin-panel p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tarefa {index + 1}</p>
                        <button
                          type="button"
                          onClick={() =>
                            setCampaignForm((current) => ({
                              ...current,
                              retryUnlockTasks: current.retryUnlockTasks.filter((entry) => entry.id !== task.id),
                            }))
                          }
                          className="admin-button-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                          Excluir
                        </button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="grid gap-2">
                          <span className="text-slate-600">Tipo</span>
                          <select
                            className="admin-select"
                            value={task.type}
                            onChange={(event) =>
                              setCampaignForm((current) => ({
                                ...current,
                                retryUnlockTasks: current.retryUnlockTasks.map((entry) =>
                                  entry.id === task.id
                                    ? { ...entry, type: event.target.value as RewardRetryTask['type'] }
                                    : entry,
                                ),
                              }))
                            }
                          >
                            <option value="google_review">Avaliar no Google</option>
                            <option value="instagram_follow">Seguir no Instagram</option>
                            <option value="custom_link">Link personalizado</option>
                          </select>
                        </label>

                        <label className="grid gap-2 md:col-span-2">
                          <span className="text-slate-600">Título mostrado ao cliente</span>
                          <input
                            className="admin-input"
                            placeholder="Ex: Avalie nossa loja no Google"
                            value={task.title}
                            onChange={(event) =>
                              setCampaignForm((current) => ({
                                ...current,
                                retryUnlockTasks: current.retryUnlockTasks.map((entry) =>
                                  entry.id === task.id ? { ...entry, title: event.target.value } : entry,
                                ),
                              }))
                            }
                          />
                        </label>
                      </div>

                      <label className="mt-3 grid gap-2">
                        <span className="text-slate-600">Link da tarefa</span>
                        <input
                          className="admin-input"
                          placeholder="https://..."
                          value={task.url}
                          onChange={(event) =>
                            setCampaignForm((current) => ({
                              ...current,
                              retryUnlockTasks: current.retryUnlockTasks.map((entry) =>
                                entry.id === task.id ? { ...entry, url: event.target.value } : entry,
                              ),
                            }))
                          }
                        />
                      </label>
                    </article>
                  ))}

                  {campaignForm.retryUnlockTasks.length < 2 ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          setCampaignForm((current) => ({
                            ...current,
                            retryUnlockTasks: [
                              ...current.retryUnlockTasks,
                              createRewardRetryTask(current.retryUnlockTasks.length + 1),
                            ],
                          }))
                        }
                        className="admin-button"
                      >
                        <Plus className="h-4 w-4" />
                        Nova tarefa
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="admin-alert border-sky-200 bg-sky-50 text-sky-900">
              O sistema mantém a roleta com <strong>6 opções no total</strong>. Você cadastra até <strong>3 prêmios reais</strong>
              e o restante é preenchido automaticamente com frases sem prêmio, sem precisar configurar estoque para isso.
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Premiação"
          title="Prêmios reais"
          description="Cadastre no máximo 3 prêmios. Cada prêmio pode estar ativo ou inativo e ter sua própria frequência."
        >
          <div className="admin-alert mb-4 border-slate-200 bg-slate-50 text-slate-700">
            Prêmios reais cadastrados: <strong>{itemsForm.filter((item) => item.title.trim()).length}/{maxRealRewards}</strong>
          </div>

          <div className="mb-4 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setShowDemo(true)
                setDemoResult(null)
                setDemoRotation(0)
              }}
              className="admin-button"
            >
              <Gift className="h-4 w-4" />
              Abrir demonstração
            </button>
            <button
              type="button"
              onClick={handleOpenCreateRewardModal}
              disabled={itemsForm.length >= maxRealRewards}
              className="admin-button disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              Novo prêmio
            </button>
            <button
              type="button"
              onClick={() => void saveItemsMutation.mutateAsync()}
              disabled={saveItemsMutation.isPending}
              className="admin-button-primary"
            >
              <Target className="h-4 w-4" />
              {saveItemsMutation.isPending ? 'Salvando...' : 'Salvar prêmios'}
            </button>
          </div>

          <div className="admin-empty-state mb-4 py-4 text-left text-slate-700">
            Opções sem prêmio já incluídas automaticamente: <strong>{neutralLabels.join(' • ')}</strong>
          </div>

          <div className="space-y-3">
            {itemsForm.length ? (
              itemsForm.map((item, index) => (
                <article key={item.id ?? `new-${index}`} className="admin-panel p-4">
                  <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                    <div className="space-y-3">
                      <input
                        className="admin-input w-full font-semibold text-slate-950"
                        placeholder="Nome do prêmio"
                        value={item.title}
                        onChange={(event) =>
                          setItemsForm((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, title: event.target.value } : entry,
                            ),
                          )
                        }
                      />
                      <p className="text-xs text-slate-500">
                        Na roleta, nomes longos podem aparecer abreviados para manter a leitura.
                      </p>

                      <textarea
                        className="admin-input min-h-20 w-full"
                        placeholder="Descrição opcional"
                        value={item.description}
                        onChange={(event) =>
                          setItemsForm((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, description: event.target.value } : entry,
                            ),
                          )
                        }
                      />
                    </div>

                    <div className="grid gap-3 text-sm">
                      <div className="admin-subcard px-4 py-3">
                        <p className="text-xs text-slate-500">Estoque disponível</p>
                        <input
                          type="number"
                          min={1}
                          className="mt-1 w-full bg-transparent font-semibold text-slate-950 outline-none"
                          value={item.quantityTotal}
                          onChange={(event) =>
                            setItemsForm((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, quantityTotal: Number(event.target.value) || 1 }
                                  : entry,
                              ),
                            )
                          }
                        />
                      </div>

                        <div className="admin-subcard px-4 py-3">
                        <p className="text-xs text-slate-500">Entregues</p>
                        <p className="font-semibold text-slate-950">{item.delivered}</p>
                      </div>

                      <div className="admin-subcard px-4 py-3">
                        <p className="text-xs text-slate-500">Frequência</p>
                        <select
                          className="mt-1 w-full bg-transparent font-semibold text-slate-950 outline-none"
                          value={item.frequencyMode}
                          onChange={(event) =>
                            setItemsForm((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, frequencyMode: event.target.value as RewardFrequencyMode }
                                  : entry,
                              ),
                            )
                          }
                        >
                          <option value="frequent">Prêmio frequente</option>
                          <option value="balanced">Distribuição equilibrada</option>
                          <option value="rare">Prêmio raro</option>
                          <option value="custom">Personalizado</option>
                        </select>
                      </div>

                      {item.frequencyMode === 'custom' ? (
                        <div className="admin-subcard px-4 py-3">
                          <p className="text-xs text-slate-500">Personalizado</p>
                          <input
                            type="number"
                            min={2}
                            className="mt-1 w-full bg-transparent font-semibold text-slate-950 outline-none"
                            value={item.customFrequencyTarget}
                            onChange={(event) =>
                              setItemsForm((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, customFrequencyTarget: Number(event.target.value) || 100 }
                                    : entry,
                                ),
                              )
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <label className="flex items-center gap-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={item.isActive}
                          onChange={(event) =>
                            setItemsForm((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, isActive: event.target.checked } : entry,
                              ),
                            )
                          }
                        />
                        Participa da roleta
                      </label>
                      <p className="mt-2 text-xs text-slate-500">{getFrequencySummary(item)}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (item.id) {
                          setDeletingItemKey(item.id)
                          void deleteItemMutation.mutateAsync(item.id)
                          return
                        }

                        removeLocalItem(index)
                      }}
                      disabled={Boolean(item.id) && deleteItemMutation.isPending && deletingItemKey === item.id}
                      className="admin-button-danger disabled:opacity-60"
                    >
                      <Trash2 className="h-4 w-4" />
                      {Boolean(item.id) && deleteItemMutation.isPending && deletingItemKey === item.id ? 'Excluindo...' : 'Excluir prêmio'}
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="admin-empty-state py-8">
                Nenhum prêmio cadastrado ainda. Use o botão acima para adicionar o primeiro item da roleta.
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          eyebrow="Resgate"
          title="Controle de entrega dos ganhadores"
          description="Acompanhe quem já retirou, quem ainda está pendente e marque rapidamente a situação de cada prêmio."
        >
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <div className="admin-inline-stat">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Pendentes</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{rewardsQuery.data?.redemptionSummary.pendingCount ?? 0}</p>
            </div>
            <div className="admin-inline-stat">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Entregues</p>
              <p className="mt-1 text-sm font-semibold text-emerald-700">{rewardsQuery.data?.redemptionSummary.deliveredCount ?? 0}</p>
            </div>
            <div className="admin-inline-stat">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Cancelados</p>
              <p className="mt-1 text-sm font-semibold text-rose-700">{rewardsQuery.data?.redemptionSummary.cancelledCount ?? 0}</p>
            </div>
          </div>

          <div className="report-summary-strip mb-4">
            Local de retirada configurado: <strong>{campaignForm.pickupAddress || 'Não informado'}</strong>
          </div>

          {rewardsQuery.data?.wins.length ? (
            <div className="admin-table-shell">
              <div className="report-table-head hidden grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_140px_180px_260px] gap-3 xl:grid">
                <div>Ganhador</div>
                <div>WhatsApp</div>
                <div>Prêmio</div>
                <div>Status</div>
                <div>Retirado em</div>
                <div>Ações</div>
              </div>

              <div className="divide-y divide-slate-200">
                {rewardsQuery.data.wins.map((win) => {
                  const isUpdating = updateWinStatusMutation.isPending && updateWinStatusMutation.variables?.winId === win.id

                  return (
                    <article key={win.id} className="report-table-row">
                      <div className="hidden items-center gap-3 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_140px_180px_260px]">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-950">{win.name || 'Sem nome informado'}</p>
                          <p className="truncate text-xs text-slate-500">{win.couponCode}</p>
                        </div>
                        <div className="text-sm text-slate-700">{win.phone || '-'}</div>
                        <div className="min-w-0 truncate text-sm text-slate-700">{win.itemTitle}</div>
                        <div>
                          <span
                            className={`admin-badge ${
                              win.redemptionStatus === 'delivered'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : win.redemptionStatus === 'cancelled'
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : 'bg-white'
                            }`}
                          >
                            {win.redemptionStatus === 'delivered'
                              ? 'Entregue'
                              : win.redemptionStatus === 'cancelled'
                                ? 'Cancelado'
                                : 'Pendente'}
                          </span>
                        </div>
                        <div className="text-sm text-slate-500">{win.deliveredAt || '-'}</div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => void updateWinStatusMutation.mutateAsync({ winId: win.id, status: 'pending' })}
                            className="admin-button disabled:opacity-60"
                          >
                            Pendente
                          </button>
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => void updateWinStatusMutation.mutateAsync({ winId: win.id, status: 'delivered' })}
                            className="admin-button-primary disabled:opacity-60"
                          >
                            Entregue
                          </button>
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => void updateWinStatusMutation.mutateAsync({ winId: win.id, status: 'cancelled' })}
                            className="admin-button-danger disabled:opacity-60"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 xl:hidden">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Ganhador</p>
                            <p className="truncate text-sm font-semibold text-slate-950">{win.name || 'Sem nome informado'}</p>
                            <p className="truncate text-xs text-slate-500">{win.couponCode}</p>
                          </div>
                          <span
                            className={`admin-badge ${
                              win.redemptionStatus === 'delivered'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : win.redemptionStatus === 'cancelled'
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : 'bg-white'
                            }`}
                          >
                            {win.redemptionStatus === 'delivered'
                              ? 'Entregue'
                              : win.redemptionStatus === 'cancelled'
                                ? 'Cancelado'
                                : 'Pendente'}
                          </span>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">WhatsApp</p>
                            <p className="text-sm text-slate-700">{win.phone || '-'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Prêmio</p>
                            <p className="text-sm text-slate-700">{win.itemTitle}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Data de retirada</p>
                            <p className="text-sm text-slate-500">{win.deliveredAt || '-'}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => void updateWinStatusMutation.mutateAsync({ winId: win.id, status: 'pending' })}
                            className="admin-button disabled:opacity-60"
                          >
                            Pendente
                          </button>
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => void updateWinStatusMutation.mutateAsync({ winId: win.id, status: 'delivered' })}
                            className="admin-button-primary disabled:opacity-60"
                          >
                            Entregue
                          </button>
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => void updateWinStatusMutation.mutateAsync({ winId: win.id, status: 'cancelled' })}
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
            </div>
          ) : (
            <div className="admin-empty-state py-10">
              Ainda não há ganhadores nesta campanha.
            </div>
          )}
        </SectionCard>
      </div>

      {showDemo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[22px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(139,92,246,0.22),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(6,182,212,0.16),_transparent_24%),linear-gradient(180deg,#0f172a_0%,#111827_100%)] p-5 text-white shadow-[0_24px_60px_rgba(15,23,42,0.45)]">
            <div className="flex flex-col gap-4 border-b border-white/10 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Demonstração</p>
                <h2 className="mt-2 font-display text-2xl text-white">Prévia visual da roleta</h2>
                <p className="mt-2 max-w-xl text-sm text-slate-300">
                  Teste visual antes de publicar. O sistema monta 6 opções com os prêmios ativos e mensagens sem
                  prêmio.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowDemo(false)
                  setDemoSpinning(false)
                  setDemoResult(null)
                  if (demoTimeoutRef.current) {
                    window.clearTimeout(demoTimeoutRef.current)
                  }
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Fechar
              </button>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
              <div className="rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.04)_100%)] p-4">
                <PrizeWheel
                  segments={demoSegments}
                  rotation={demoRotation}
                  isSpinning={demoSpinning}
                  primaryColor="#7c3aed"
                  activeSegmentId={demoResult?.id}
                  showCelebration={demoResult?.kind === 'reward'}
                  celebrationKey={demoCelebrationKey}
                  disabled={demoSpinning}
                  onSpin={() => {
                    const selectedIndex = Math.floor(Math.random() * demoSegments.length)
                    const selectedSegment = demoSegments[selectedIndex] ?? null
                    const nextRotation = getSegmentTargetRotation(demoRotation, demoSegments.length, selectedIndex)

                    if (demoTimeoutRef.current) {
                      window.clearTimeout(demoTimeoutRef.current)
                    }

                    setDemoSpinning(true)
                    setDemoResult(null)
                    setDemoRotation(nextRotation)
                    demoTimeoutRef.current = window.setTimeout(() => {
                      setDemoSpinning(false)
                      if (selectedSegment?.kind === 'reward') {
                        setDemoCelebrationKey((current) => current + 1)
                      }
                      setDemoResult(selectedSegment)
                    }, 5400)
                  }}
                />

                <p className="mt-4 text-center text-[11px] uppercase tracking-[0.2em] text-slate-400">
                  {demoSpinning ? 'Girando demonstração...' : 'Teste visual sem consumir prêmio'}
                </p>
              </div>

              <div className="space-y-4">
                <div className="rounded-[18px] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(6,182,212,0.08)_0%,rgba(255,255,255,0.04)_100%)] p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Resultado</p>
                  {demoResult ? (
                    <div
                      className={`mt-3 rounded-[14px] px-4 py-3 ${
                        demoResult.kind === 'reward'
                          ? 'border border-amber-300/30 bg-[linear-gradient(180deg,rgba(250,204,21,0.18)_0%,rgba(236,72,153,0.12)_100%)] shadow-[0_14px_34px_rgba(250,204,21,0.12)]'
                          : 'border border-cyan-300/15 bg-cyan-400/10'
                      }`}
                    >
                      <p
                        className={`text-[11px] uppercase tracking-[0.18em] ${
                          demoResult.kind === 'reward' ? 'text-amber-100' : 'text-cyan-100'
                        }`}
                      >
                        {demoResult.kind === 'reward' ? 'Prêmio em destaque' : 'A roleta parou em'}
                      </p>
                      <p className="mt-1 text-lg font-semibold text-white">{demoResult.label}</p>
                    </div>
                  ) : demoSpinning ? (
                    <div className="mt-3 rounded-[14px] border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                      Aguarde o giro terminar para ver o item selecionado.
                    </div>
                  ) : (
                    <div className="mt-3 rounded-[14px] border border-white/10 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
                      Clique em <strong>Girar</strong> para ver a prévia final do resultado.
                    </div>
                  )}
                </div>

                <div className="rounded-[18px] border border-violet-300/15 bg-[linear-gradient(180deg,rgba(139,92,246,0.08)_0%,rgba(255,255,255,0.04)_100%)] p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Como vai ficar</p>
                  <p className="mt-2 text-sm text-slate-300">
                    No uso real, o servidor define o resultado antes da animação. A roleta apenas mostra visualmente o
                    item já decidido.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-[14px] border border-white/10 bg-slate-900/40 px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Prêmios ativos</p>
                      <p className="mt-1 text-lg font-semibold text-white">
                        {itemsForm.filter((item) => item.title.trim() && item.isActive).length}
                      </p>
                    </div>
                    <div className="rounded-[14px] border border-white/10 bg-slate-900/40 px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Opções na roleta</p>
                      <p className="mt-1 text-lg font-semibold text-white">{demoSegments.length}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07)_0%,rgba(255,255,255,0.03)_100%)] p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Prêmios atualmente configurados</p>
                  <div className="mt-3 space-y-2">
                    {itemsForm.filter((item) => item.title.trim()).length ? (
                      itemsForm
                        .filter((item) => item.title.trim())
                        .map((item) => (
                          <div
                            key={item.id ?? item.title}
                            className="rounded-[14px] border border-white/10 bg-slate-900/35 px-3 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="font-semibold text-white">{item.title}</p>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                  item.isActive
                                    ? 'bg-emerald-400/15 text-emerald-200'
                                    : 'bg-slate-400/10 text-slate-300'
                                }`}
                              >
                                {item.isActive ? 'Ativo' : 'Inativo'}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-slate-300">{getFrequencySummary(item)}</p>
                            {item.description.trim() ? (
                              <p className="mt-1 text-xs text-slate-400">{item.description.trim()}</p>
                            ) : null}
                          </div>
                        ))
                    ) : (
                      <div className="rounded-[14px] border border-dashed border-white/10 bg-slate-900/30 px-4 py-6 text-center text-sm text-slate-300">
                        Nenhum prêmio foi configurado ainda. A demonstração abre apenas com as mensagens neutras padrão.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
