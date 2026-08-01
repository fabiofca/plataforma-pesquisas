import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { AdminModal } from '@/components/ui/AdminModal'
import { SectionCard } from '@/components/ui/SectionCard'
import { apiRequest } from '@/lib/api-client'
import { mapApiSurvey } from '@/lib/mappers'
import {
  buildCustomSurveyPayload,
  createEmptySurveyForm,
  slugify,
  type SurveyCreateFormState,
} from '@/lib/survey-templates'

const emptySurveyForm = createEmptySurveyForm()

export function SurveysPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isSlugDirty, setIsSlugDirty] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [createForm, setCreateForm] = useState<SurveyCreateFormState>(emptySurveyForm)

  const surveysQuery = useQuery({
    queryKey: ['surveys'],
    queryFn: async () => {
      const response = await apiRequest<{
        surveys: Array<{
          id: string
          survey_kind?: string
          title: string
          description?: string | null
          status: string
          participation_mode: string
          primary_color: string
          reward_enabled: boolean
          slug: string | null
          responses: string
          link_clicks: string
          qr_scans: string
        }>
      }>('/surveys')

      return response.surveys.map(mapApiSurvey)
    },
    retry: 0,
  })

  const createSurveyMutation = useMutation({
    mutationFn: async () => {
      const created = await apiRequest<{ id: string }>('/surveys', {
        method: 'POST',
        body: JSON.stringify(buildCustomSurveyPayload(createForm)),
      })

      return created.id
    },
    onSuccess: async (surveyId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'surveys'] }),
      ])
      setIsCreateModalOpen(false)
      setIsSlugDirty(false)
      setCreateForm(emptySurveyForm)
      navigate(`/app/pesquisas/${surveyId}/editar`, {
        state: { feedback: 'Pesquisa criada com sucesso. Continue a edição nos detalhes abaixo.' },
      })
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível criar a pesquisa.')
    },
  })

  const data = (surveysQuery.data ?? []).filter((survey) => survey.kind === 'custom')

  function handleOpenCreateModal() {
    setFeedback('')
    setIsSlugDirty(false)
    setCreateForm(emptySurveyForm)
    setIsCreateModalOpen(true)
  }

  function handleCloseCreateModal() {
    setIsCreateModalOpen(false)
    setIsSlugDirty(false)
    setCreateForm(emptySurveyForm)
  }

  return (
    <AppShell
      title="Pesquisas personalizadas"
      subtitle="Crie, publique e acompanhe pesquisas livres, com perguntas e fluxos montados do seu jeito."
      breadcrumbs={[{ label: 'Pesquisas' }, { label: 'Personalizadas' }]}
    >
      <AdminModal
        open={isCreateModalOpen}
        title="Nova pesquisa personalizada"
        description="Crie a base da pesquisa por modal e depois siga para o editor completo."
        onClose={handleCloseCreateModal}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void createSurveyMutation.mutateAsync()
          }}
        >
          <label className="grid gap-2 text-sm">
            <span className="text-slate-600">Título da pesquisa</span>
            <input
              className="admin-input"
              value={createForm.title}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  title: event.target.value,
                  slug: isSlugDirty ? current.slug : slugify(event.target.value),
                }))
              }
              required
            />
          </label>

          <label className="grid gap-2 text-sm">
            <span className="text-slate-600">Descrição</span>
            <textarea
              className="admin-input min-h-24"
              value={createForm.description}
              onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Slug</span>
              <input
                className="admin-input"
                value={createForm.slug}
                onChange={(event) => {
                  setIsSlugDirty(true)
                  setCreateForm((current) => ({ ...current, slug: slugify(event.target.value) }))
                }}
                required
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-600">Nome da marca</span>
              <input
                className="admin-input"
                value={createForm.brandName}
                onChange={(event) => setCreateForm((current) => ({ ...current, brandName: event.target.value }))}
                required
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="text-slate-600">Cor principal</span>
            <input
              className="admin-input"
              value={createForm.primaryColor}
              onChange={(event) => setCreateForm((current) => ({ ...current, primaryColor: event.target.value }))}
              required
            />
          </label>

          <div className="admin-alert border-sky-200 bg-sky-50 text-sky-900">
            A pesquisa será criada com uma pergunta inicial para abrir o editor sem travar. Depois você pode ajustar tudo normalmente.
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" onClick={handleCloseCreateModal} className="admin-button">
              Cancelar
            </button>

            <button type="submit" disabled={createSurveyMutation.isPending} className="admin-button-primary">
              {createSurveyMutation.isPending ? 'Criando...' : 'Criar pesquisa personalizada'}
            </button>
          </div>
        </form>
      </AdminModal>

      {feedback ? <div className="admin-alert mb-6 border-rose-200 bg-rose-50 text-rose-900">{feedback}</div> : null}

      <section className="admin-page-hero mb-6 grid gap-3 animate-fade-in-up lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Pesquisas livres</p>
          <h2 className="mt-1 font-display text-[22px] leading-tight text-slate-950">
            Crie jornadas personalizadas com uma apresentação mais refinada.
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] text-slate-600">
            Use pesquisas sob medida para campanhas, atendimento, cadastro, roleta e fluxos condicionais sem deixar o painel pesado.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Catálogo</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{data.length} pesquisa(s)</p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">No ar</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {data.filter((survey) => survey.status === 'Publicada').length} publicada(s)
            </p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Com prêmio</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {data.filter((survey) => survey.rewardEnabled).length} campanha(s)
            </p>
          </div>
        </div>
      </section>

      <div className="mb-6 flex flex-wrap justify-end gap-3">
        <Link to="/app/pesquisas/nps" className="admin-button">
          Ir para pesquisas NPS
        </Link>
        <button type="button" onClick={handleOpenCreateModal} className="admin-button-primary">
          Nova pesquisa personalizada
        </button>
      </div>

      <SectionCard
        eyebrow="Personalizadas"
        title="Catálogo de pesquisas livres"
        description="Aqui ficam as pesquisas montadas do zero. A lista abre os detalhes só quando você clicar, para a página ficar mais leve."
      >
        {surveysQuery.isError ? (
          <div className="mb-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" style={{ borderRadius: 8 }}>
        Não foi possível carregar as pesquisas agora. Verifique a API e tente novamente.
          </div>
        ) : null}

        {!surveysQuery.isError && !data.length ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600" style={{ borderRadius: 8 }}>
            Nenhuma pesquisa personalizada cadastrada ainda. Crie a primeira para começar.
          </div>
        ) : null}

        <div className="space-y-3">
          {data.map((survey, index) => (
            <Link
              key={survey.id}
              to={`/app/pesquisas/${survey.id}`}
              className={`admin-panel block overflow-hidden transition hover:border-slate-300 hover:bg-white animate-fade-in-up delay-${Math.min(index * 50, 350)}`}>
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 h-2 w-14" style={{ backgroundColor: survey.primaryColor, borderRadius: 2 }} />
                  <p className="truncate font-display text-xl text-slate-950">{survey.title}</p>
                  <p className="mt-1 truncate text-sm text-slate-500">/{survey.slug}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className="admin-badge bg-white">{survey.responses} resposta(s)</span>
                  <span className="admin-badge bg-white">{survey.participationMode}</span>
                  <span className="admin-badge border-slate-900 bg-slate-950 text-white">{survey.status}</span>
                  <span className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-slate-600" style={{ borderRadius: 8 }}>
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  )
}
