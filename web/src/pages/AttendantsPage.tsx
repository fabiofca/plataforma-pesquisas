import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Pencil, Trash2, Check, X, Users } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { SurveyNavBar } from '@/components/surveys/SurveyNavBar'
import { apiRequest, ApiError } from '@/lib/api-client'
import { mapApiSurvey } from '@/lib/mappers'

type Attendant = {
  id: string
  name: string
  isActive: boolean
  createdAt: string
}

export function AttendantsPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formError, setFormError] = useState('')

  const surveyQuery = useQuery({
    queryKey: ['survey', id],
    queryFn: () =>
      apiRequest<{ survey: ReturnType<typeof mapApiSurvey> }>(`/surveys/${id}`).then((data) => data.survey),
    enabled: Boolean(id),
  })

  const attendantsQuery = useQuery({
    queryKey: ['attendants', id],
    queryFn: () => apiRequest<Attendant[]>(`/surveys/${id}/attendants`),
    enabled: Boolean(id),
  })

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest<Attendant>(`/surveys/${id}/attendants`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendants', id] })
      setShowForm(false)
      setFormName('')
      setFormError('')
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setFormError(error.message)
      } else {
        setFormError('Erro ao cadastrar atendente.')
      }
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ attendantId, name }: { attendantId: string; name?: string }) =>
      apiRequest<Attendant>(`/surveys/${id}/attendants/${attendantId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendants', id] })
      setEditingId(null)
      setFormName('')
      setFormError('')
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setFormError(error.message)
      } else {
        setFormError('Erro ao atualizar atendente.')
      }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (attendantId: string) =>
      apiRequest(`/surveys/${id}/attendants/${attendantId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendants', id] })
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ attendantId, isActive }: { attendantId: string; isActive: boolean }) =>
      apiRequest<Attendant>(`/surveys/${id}/attendants/${attendantId}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendants', id] })
    },
  })

  const attendants = attendantsQuery.data ?? []

  const filteredAttendants = attendants.filter((att) =>
    att.name.toLowerCase().includes(search.toLowerCase()),
  )

  function openCreateForm() {
    setFormName('')
    setFormError('')
    setEditingId(null)
    setShowForm(true)
  }

  function openEditForm(attendant: Attendant) {
    setFormName(attendant.name)
    setFormError('')
    setEditingId(attendant.id)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setFormName('')
    setFormError('')
    setEditingId(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formName.trim()) {
      setFormError('Informe o nome do atendente.')
      return
    }

    if (editingId) {
      updateMutation.mutate({ attendantId: editingId, name: formName.trim() })
    } else {
      createMutation.mutate(formName.trim())
    }
  }

  const surveyTitle = surveyQuery.data?.title ?? ''

  return (
    <AppShell title="Atendentes" subtitle="" hideHeader>
      <SurveyNavBar surveyId={id ?? ''} surveyTitle={surveyTitle} activeTab="attendants" />

      <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Atendentes</h1>
            <p className="mt-1 text-sm text-slate-500">
              Cadastre os nomes dos atendentes para melhorar a precisão do relatório de desempenho.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            Novo atendente
          </button>
        </div>

        {showForm && (
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="attendant-name" className="mb-1 block text-sm font-medium text-slate-700">
                  Nome do atendente
                </label>
                <input
                  id="attendant-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: João Silva"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  {editingId ? 'Salvar' : 'Cadastrar'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                  Cancelar
                </button>
              </div>
            </form>
            {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
          </div>
        )}

        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar atendente..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        {attendantsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : filteredAttendants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="mb-3 h-12 w-12 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">
              {search ? 'Nenhum atendente encontrado.' : 'Nenhum atendente cadastrado.'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {search ? 'Tente outra busca.' : 'Cadastre o primeiro atendente para começar.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {filteredAttendants.map((attendant) => (
                <li
                  key={attendant.id}
                  className="flex items-center justify-between px-4 py-3 transition hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                        attendant.isActive
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {attendant.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p
                        className={`text-sm font-medium ${
                          attendant.isActive ? 'text-slate-900' : 'text-slate-400 line-through'
                        }`}
                      >
                        {attendant.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {attendant.isActive ? 'Ativo' : 'Inativo'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        toggleActiveMutation.mutate({
                          attendantId: attendant.id,
                          isActive: !attendant.isActive,
                        })
                      }
                      title={attendant.isActive ? 'Desativar' : 'Ativar'}
                      className={`rounded-lg p-2 text-sm transition ${
                        attendant.isActive
                          ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                          : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500'
                      }`}
                    >
                      {attendant.isActive ? (
                        <X className="h-4 w-4" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditForm(attendant)}
                      title="Editar"
                      className="rounded-lg p-2 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remover "${attendant.name}"?`)) {
                          deleteMutation.mutate(attendant.id)
                        }
                      }}
                      title="Remover"
                      className="rounded-lg p-2 text-sm text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 text-xs text-slate-400">
          {attendants.length} atendente{attendants.length !== 1 ? 's' : ''} cadastrado
          {attendants.length !== 1 ? 's' : ''}
        </div>
      </div>
    </AppShell>
  )
}
