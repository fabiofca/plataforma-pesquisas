import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { AppShell } from '@/components/layout/AppShell'
import { AdminModal } from '@/components/ui/AdminModal'
import { SectionCard } from '@/components/ui/SectionCard'
import { apiRequest } from '@/lib/api-client'
import { featureCatalog, getDefaultFeatureAccess, type FeatureAccess } from '@/lib/features'
import type { PlanHistoryItem, PlanItem, PlanUserAssignmentItem } from '@/types/domain'

type PlanFormState = {
  code: string
  name: string
  description: string
  isActive: boolean
  features: FeatureAccess
}

const emptyPlanForm: PlanFormState = {
  code: '',
  name: '',
  description: '',
  isActive: true,
  features: getDefaultFeatureAccess(),
}

export function PlansPage() {
  const queryClient = useQueryClient()
  const [isFormModalOpen, setIsFormModalOpen] = useState(false)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const plansQuery = useQuery({
    queryKey: ['plans'],
    queryFn: async () =>
      apiRequest<{
        plans: PlanItem[]
        users: PlanUserAssignmentItem[]
        history: PlanHistoryItem[]
      }>('/plans'),
    retry: 0,
  })

  const plans = plansQuery.data?.plans ?? []
  const users = plansQuery.data?.users ?? []
  const history = plansQuery.data?.history ?? []
  const assignableUsers = users.filter((user) => user.roleCode !== 'master')

  const savePlanMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: planForm.code.trim().toLowerCase(),
        name: planForm.name.trim(),
        description: planForm.description.trim(),
        isActive: planForm.isActive,
        features: planForm.features,
      }

      if (editingPlanId) {
        await apiRequest<{ ok: boolean }>(`/plans/${editingPlanId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
        return 'Plano atualizado com sucesso.'
      }

      await apiRequest<{ id: string }>('/plans', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      return 'Plano criado com sucesso.'
    },
    onSuccess: async (message) => {
      await queryClient.invalidateQueries({ queryKey: ['plans'] })
      setFeedback({ type: 'success', message })
      handleCloseModal()
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível salvar o plano.',
      })
    },
  })

  const assignPlanMutation = useMutation({
    mutationFn: async ({ userId, planId }: { userId: string; planId: string }) =>
      apiRequest<{ ok: boolean }>(`/plans/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ planId }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plans'] })
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setFeedback({ type: 'success', message: 'Plano vinculado ao usuário com sucesso.' })
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível vincular o plano ao usuário.',
      })
    },
  })

  function handleEditPlan(plan: PlanItem) {
    setFeedback(null)
    setEditingPlanId(plan.id)
    setIsFormModalOpen(true)
    setPlanForm({
      code: plan.code,
      name: plan.name,
      description: plan.description,
      isActive: plan.isActive,
      features: plan.features,
    })
  }

  function handleOpenCreateModal() {
    setFeedback(null)
    setEditingPlanId(null)
    setPlanForm(emptyPlanForm)
    setIsFormModalOpen(true)
  }

  function handleCloseModal() {
    setEditingPlanId(null)
    setPlanForm(emptyPlanForm)
    setIsFormModalOpen(false)
  }

  return (
    <AppShell
      title="Gestão de planos"
      subtitle="Crie planos, ative ou desative recursos e defina qual plano controla as liberações de cada usuário."
    >
      <AdminModal
        open={isFormModalOpen}
        title={editingPlanId ? 'Editar plano' : 'Novo plano'}
        description="Os recursos ligados aqui já controlam exportação, QR code e rastreio dos usuários comuns."
        onClose={handleCloseModal}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void savePlanMutation.mutateAsync()
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Código do plano</span>
              <input
                className="admin-input"
                value={planForm.code}
                onChange={(event) => setPlanForm((current) => ({ ...current, code: event.target.value }))}
                required
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Nome do plano</span>
              <input
                className="admin-input"
                value={planForm.name}
                onChange={(event) => setPlanForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="text-slate-600">Descrição</span>
            <textarea
              className="admin-input min-h-24"
              value={planForm.description}
              onChange={(event) => setPlanForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <label className="admin-checkrow">
            <input
              type="checkbox"
              checked={planForm.isActive}
              onChange={(event) => setPlanForm((current) => ({ ...current, isActive: event.target.checked }))}
            />
            Plano ativo para novas atribuições e resolução de recursos
          </label>

          <div className="grid gap-3">
            {featureCatalog.map((feature) => (
              <label key={feature.key} className="admin-panel flex items-start gap-3 p-4">
                <input
                  type="checkbox"
                  checked={planForm.features[feature.key]}
                  onChange={(event) =>
                    setPlanForm((current) => ({
                      ...current,
                      features: {
                        ...current.features,
                        [feature.key]: event.target.checked,
                      },
                    }))
                  }
                />
                <div>
                  <p className="font-semibold text-slate-950">{feature.label}</p>
                  <p className="mt-1 text-sm text-slate-600">{feature.description}</p>
                </div>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" onClick={handleCloseModal} className="admin-button">
              Cancelar
            </button>

            <button type="submit" disabled={savePlanMutation.isPending} className="admin-button-primary">
              {savePlanMutation.isPending ? 'Salvando...' : editingPlanId ? 'Salvar plano' : 'Criar plano'}
            </button>
          </div>
        </form>
      </AdminModal>

      {feedback ? (
        <div
          className={`admin-alert mb-6 ${
            feedback.type === 'error'
              ? 'border border-rose-200 bg-rose-50 text-rose-900'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="mb-6 flex justify-end">
        <button type="button" onClick={handleOpenCreateModal} className="admin-button-primary">
          Criar plano
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard
          eyebrow="Planos"
          title="Catálogo atual"
          description="Edite os recursos e o status de cada plano já cadastrado."
        >
          {plansQuery.isError ? (
            <div className="admin-alert border-amber-200 bg-amber-50 text-amber-900">
              Não foi possível carregar os planos agora. Verifique a API e tente novamente.
            </div>
          ) : null}

          {!plansQuery.isError && !plans.length ? (
            <div className="admin-empty-state py-12">
              Nenhum plano cadastrado ainda.
            </div>
          ) : null}

          <div className="space-y-4">
            {plans.map((plan) => (
              <article key={plan.id} className="admin-panel p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-display text-2xl text-slate-950">{plan.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{plan.code}</p>
                    {plan.description ? <p className="mt-3 text-sm text-slate-600">{plan.description}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`admin-badge ${plan.isActive ? 'border-emerald-200 bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>
                      {plan.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleEditPlan(plan)}
                      className="admin-button"
                    >
                      Editar plano
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {featureCatalog.map((feature) => (
                    <div key={`${plan.id}-${feature.key}`} className="admin-subcard flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="font-medium text-slate-900">{feature.label}</p>
                        <p className="text-xs text-slate-500">{feature.description}</p>
                      </div>
                      <span
                        className={`admin-badge ${
                          plan.features[feature.key] ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {plan.features[feature.key] ? 'Liberado' : 'Bloqueado'}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Atribuições"
          title="Plano por usuário"
          description="Defina qual plano governa os recursos disponíveis para cada usuário comum."
        >
          {!assignableUsers.length ? (
            <div className="admin-empty-state py-12">
              Nenhum usuário comum disponível para atribuição de plano.
            </div>
          ) : (
            <div className="space-y-4">
              {assignableUsers.map((user) => (
                <article key={user.id} className="admin-panel p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{user.name}</p>
                      <p className="text-sm text-slate-500">{user.email}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                        Plano atual: {user.planName ?? 'Sem plano'}
                      </p>
                    </div>

                    <div className="flex w-full flex-col gap-3 md:w-[280px]">
                      <select
                        value={user.planId ?? ''}
                        onChange={(event) => {
                          if (!event.target.value) {
                            return
                          }

                          void assignPlanMutation.mutateAsync({
                            userId: user.id,
                            planId: event.target.value,
                          })
                        }}
                        className="admin-select"
                        disabled={assignPlanMutation.isPending}
                      >
                        <option value="" disabled>
                          Selecionar plano
                        </option>
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name} {plan.isActive ? '' : '(Inativo)'}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500">
                        Status do usuário: {user.status === 'active' ? 'Ativo' : 'Bloqueado'}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          eyebrow="Auditoria"
          title="Histórico de troca de plano"
          description="Cada alteração de plano fica registrada com o usuário afetado, o plano anterior, o novo plano e o responsável pela mudança."
        >
          {!history.length ? (
            <div className="admin-empty-state py-12">
              Nenhuma troca de plano registrada até o momento.
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((entry) => (
                <article key={entry.id} className="admin-panel p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{entry.userName}</p>
                      <p className="text-sm text-slate-500">{entry.userEmail}</p>
                      <p className="mt-2 text-sm text-slate-600">
                        {entry.previousPlanName ?? 'Sem plano'} {' -> '} {entry.nextPlanName ?? 'Sem plano'}
                      </p>
                    </div>

                    <div className="text-right text-sm text-slate-500">
                      <p>Por: {entry.actorName}</p>
                      <p className="mt-1">{new Date(entry.createdAt).toLocaleString('pt-BR')}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  )
}
