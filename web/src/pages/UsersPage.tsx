import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { AppShell } from '@/components/layout/AppShell'
import { AdminModal } from '@/components/ui/AdminModal'
import { SectionCard } from '@/components/ui/SectionCard'
import { apiRequest } from '@/lib/api-client'
import { mapApiUser } from '@/lib/mappers'
import type { UserListItem } from '@/types/domain'

type UserFormState = {
  name: string
  email: string
  password: string
  phone: string
  roleCode: 'master' | 'user'
  status: 'active' | 'blocked'
}

const emptyForm: UserFormState = {
  name: '',
  email: '',
  password: '',
  phone: '',
  roleCode: 'user',
  status: 'active',
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const [isFormModalOpen, setIsFormModalOpen] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [form, setForm] = useState<UserFormState>(emptyForm)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await apiRequest<{
        users: Array<{
          id: string
          name: string
          email: string
          phone?: string | null
          status: string
          role_code: string
          surveys_count: string
          plan_name?: string | null
          plan_code?: string | null
          is_default_master?: boolean
        }>
      }>('/users')

      return response.users.map(mapApiUser)
    },
    retry: 0,
  })

  const data = usersQuery.data ?? []
  const editingUser = editingUserId ? data.find((user) => user.id === editingUserId) : null

  const saveUserMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        email: form.email,
        roleCode: form.roleCode,
        status: form.status,
        phone: form.phone,
        ...(form.password ? { password: form.password } : {}),
      }

      if (editingUserId) {
        await apiRequest<{ ok: boolean }>(`/users/${editingUserId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
        return 'Usuário atualizado com sucesso.'
      }

      await apiRequest<{ id: string }>('/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      return 'Usuário criado com sucesso.'
    },
    onSuccess: async (message) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setFeedback({ type: 'success', message })
      handleCloseModal()
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível salvar o usuário.',
      })
    },
  })

  const statusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: 'active' | 'blocked' }) => {
      await apiRequest<{ ok: boolean }>(`/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setFeedback({ type: 'success', message: 'Status do usuário atualizado com sucesso.' })
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível alterar o status do usuário.',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest<{ ok: boolean }>(`/users/${userId}`, {
        method: 'DELETE',
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setFeedback({ type: 'success', message: 'Usuário removido com sucesso.' })
      handleCloseModal()
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível remover o usuário.',
      })
    },
  })

  function handleEdit(user: UserListItem) {
    setFeedback(null)
    setEditingUserId(user.id)
    setIsFormModalOpen(true)
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      phone: user.phone ?? '',
      roleCode: user.roleCode,
      status: user.status === 'Bloqueado' ? 'blocked' : 'active',
    })
  }

  function handleOpenCreateModal() {
    setFeedback(null)
    setEditingUserId(null)
    setForm(emptyForm)
    setIsFormModalOpen(true)
  }

  function handleCloseModal() {
    setEditingUserId(null)
    setForm(emptyForm)
    setIsFormModalOpen(false)
  }

  function handleDelete(user: UserListItem) {
    const confirmed = window.confirm(`Deseja remover o usuário "${user.name}"?`)

    if (!confirmed) {
      return
    }

    void deleteMutation.mutateAsync(user.id)
  }

  function shouldShowSurveys(user: UserListItem) {
    return user.roleCode !== 'master'
  }

  function canManageStatus(user: UserListItem) {
    return !user.isDefaultMaster
  }

  function canRemoveUser(user: UserListItem) {
    return !user.isDefaultMaster
  }

  return (
    <AppShell
      title="Gestão de usuários"
      subtitle="O usuário master controla todo o acesso administrativo da plataforma, com ações rápidas para criar, editar, bloquear e remover usuários."
    >
      <AdminModal
        open={isFormModalOpen}
        title={editingUserId ? 'Editar usuário' : 'Novo usuário'}
        description="Crie contas administrativas e ajuste perfil, status e contato sem sair desta tela."
        onClose={handleCloseModal}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void saveUserMutation.mutateAsync()
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Nome</span>
              <input
                className="admin-input"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">E-mail</span>
              <input
                type="email"
                className="admin-input"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">{editingUserId ? 'Nova senha (opcional)' : 'Senha inicial'}</span>
              <input
                type="password"
                className="admin-input"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                required={!editingUserId}
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Telefone</span>
              <input
                className="admin-input"
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Perfil</span>
              <select
                className="admin-select"
                value={form.roleCode}
                disabled={editingUser?.isDefaultMaster}
                onChange={(event) =>
                  setForm((current) => ({ ...current, roleCode: event.target.value as UserFormState['roleCode'] }))
                }
              >
                <option value="user">Usuário comum</option>
                <option value="master">Usuário master</option>
              </select>
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Status</span>
              <select
                className="admin-select"
                value={form.status}
                disabled={editingUser?.isDefaultMaster}
                onChange={(event) =>
                  setForm((current) => ({ ...current, status: event.target.value as UserFormState['status'] }))
                }
              >
                <option value="active">Ativo</option>
                {!editingUser?.isDefaultMaster ? <option value="blocked">Bloqueado</option> : null}
              </select>
            </label>
          </div>

          {editingUser?.isDefaultMaster ? (
            <p className="text-sm text-slate-500">
              O master padrão pode ser editado, mas não pode virar usuário comum, nem ser bloqueado ou removido.
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" onClick={handleCloseModal} className="admin-button">
              Cancelar
            </button>

            <button type="submit" disabled={saveUserMutation.isPending} className="admin-button-primary">
              {saveUserMutation.isPending ? 'Salvando...' : editingUserId ? 'Salvar alterações' : 'Criar usuário'}
            </button>
          </div>
        </form>
      </AdminModal>

      {feedback ? (
        <div
          className={`mb-6 px-4 py-3 text-sm ${
            feedback.type === 'error'
              ? 'border border-rose-200 bg-rose-50 text-rose-900'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
          style={{ borderRadius: 8 }}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="mb-6 flex justify-end">
        <button type="button" onClick={handleOpenCreateModal} className="admin-button-primary">
          Criar usuário
        </button>
      </div>

      <div>
        <SectionCard
          eyebrow="Controle de acesso"
          title="Usuários da plataforma"
          description="Listagem com ações reais para manter o painel organizado."
        >
          {usersQuery.isError ? (
            <div className="mb-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" style={{ borderRadius: 8 }}>
              Não foi possível carregar os usuários agora. Verifique a API e tente novamente.
            </div>
          ) : null}

          {!usersQuery.isError && !data.length ? (
            <div className="mb-4 border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600" style={{ borderRadius: 8 }}>
              Nenhum usuário administrativo encontrado até o momento.
            </div>
          ) : null}

          <div className="grid gap-4 md:hidden">
            {data.map((user) => (
              <article key={user.id} className="admin-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{user.name}</p>
                    <p className="text-sm text-slate-500">{user.email}</p>
                  </div>
                  <span className="admin-badge border-slate-900 bg-slate-950 text-white">{user.status}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600">
                  <div>
                    <p className="text-xs text-slate-500">Perfil</p>
                    <p>{user.role}</p>
                  </div>
                  {shouldShowSurveys(user) ? (
                    <div>
                      <p className="text-xs text-slate-500">Pesquisas</p>
                      <p>{user.surveys}</p>
                    </div>
                  ) : null}
                  <div className="col-span-2">
                    <p className="text-xs text-slate-500">Plano atual</p>
                    <p>{user.roleCode === 'master' ? 'Acesso total master' : user.planName ?? 'Sem plano vinculado'}</p>
                  </div>
                </div>
                {user.isDefaultMaster ? (
                  <p className="mt-4 text-xs font-medium text-slate-500">
                    Este é o master padrão da plataforma. Ele pode ser editado, mas não pode ser bloqueado nem removido.
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(user)}
                    className="admin-button"
                  >
                    Editar
                  </button>
                  {canManageStatus(user) ? (
                    <button
                      type="button"
                      onClick={() =>
                        void statusMutation.mutateAsync({
                          userId: user.id,
                          status: user.status === 'Bloqueado' ? 'active' : 'blocked',
                        })
                      }
                      className="admin-button"
                    >
                      {user.status === 'Bloqueado' ? 'Reativar' : 'Bloquear'}
                    </button>
                  ) : null}
                  {canRemoveUser(user) ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(user)}
                      className="admin-button-danger"
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          <div className="admin-table-shell hidden md:block">
            <table className="min-w-full bg-white">
              <thead className="bg-slate-50 text-left text-sm text-slate-500">
                <tr>
                  <th className="px-4 py-4 font-medium">Nome</th>
                  <th className="px-4 py-4 font-medium">E-mail</th>
                  <th className="px-4 py-4 font-medium">Perfil</th>
                  <th className="px-4 py-4 font-medium">Status</th>
                  <th className="px-4 py-4 font-medium">Plano</th>
                  <th className="px-4 py-4 font-medium">Pesquisas</th>
                  <th className="px-4 py-4 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {data.map((user) => (
                  <tr key={user.id} className="border-t border-slate-100 text-sm text-slate-700">
                    <td className="px-4 py-4 font-semibold text-slate-950">{user.name}</td>
                    <td className="px-4 py-4">{user.email}</td>
                    <td className="px-4 py-4">{user.role}</td>
                    <td className="px-4 py-4">
                      <span className="admin-badge border-slate-900 bg-slate-950 text-white">{user.status}</span>
                    </td>
                    <td className="px-4 py-4">
                      {user.roleCode === 'master' ? 'Acesso total master' : user.planName ?? 'Sem plano'}
                    </td>
                    <td className="px-4 py-4">{shouldShowSurveys(user) ? user.surveys : ''}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(user)}
                          className="admin-button"
                        >
                          Editar
                        </button>
                        {canManageStatus(user) ? (
                          <button
                            type="button"
                            onClick={() =>
                              void statusMutation.mutateAsync({
                                userId: user.id,
                                status: user.status === 'Bloqueado' ? 'active' : 'blocked',
                              })
                            }
                            className="admin-button"
                          >
                            {user.status === 'Bloqueado' ? 'Reativar' : 'Bloquear'}
                          </button>
                        ) : null}
                        {canRemoveUser(user) ? (
                          <button
                            type="button"
                            onClick={() => handleDelete(user)}
                            className="admin-button-danger"
                          >
                            Remover
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  )
}
