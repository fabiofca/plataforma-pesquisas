import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cake, MessageSquareText, Send } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { SectionCard } from '@/components/ui/SectionCard'
import { apiRequest } from '@/lib/api-client'

type BirthdayAutomationResponse = {
  settings: {
    isEnabled: boolean
    messageTemplate: string
  }
  capabilities: {
    canSendRealMessages: boolean
  }
  todayRecipients: Array<{
    responseId: string
    surveyId: string
    surveyTitle: string
    brandName: string
    name: string
    phone: string
    email?: string | null
    birthdayLabel: string
    submittedAt: string
    previewMessage: string
  }>
  recentDispatches: Array<{
    id: string
    dispatchDate: string
    participantName?: string | null
    participantPhone: string
    participantEmail?: string | null
    renderedMessage: string
    status: string
    queuedAt: string
    sentAt?: string | null
  }>
}

const defaultTemplate =
  'Feliz aniversário, {{name}}! A equipe da {{brand_name}} deseja um dia maravilhoso para você.'

export function BirthdayAutomationPage() {
  const queryClient = useQueryClient()
  const [isEnabled, setIsEnabled] = useState(false)
  const [messageTemplate, setMessageTemplate] = useState(defaultTemplate)
  const [feedback, setFeedback] = useState('')

  const automationQuery = useQuery({
    queryKey: ['birthday-automation'],
    queryFn: async () => apiRequest<BirthdayAutomationResponse>('/birthday-automation'),
    retry: 0,
  })

  const data = automationQuery.data
  const canSendRealMessages = data?.capabilities.canSendRealMessages ?? false

  useEffect(() => {
    if (!data) {
      return
    }

    setIsEnabled(data.settings.isEnabled)
    setMessageTemplate(data.settings.messageTemplate)
  }, [data])

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiRequest('/birthday-automation', {
        method: 'PATCH',
        body: JSON.stringify({
          isEnabled,
          messageTemplate,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['birthday-automation'] })
      setFeedback('Automação de aniversário salva com sucesso.')
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar a automação agora.')
    },
  })

  const runMutation = useMutation({
    mutationFn: async () =>
      apiRequest<{ ok: boolean; message: string; queuedCount: number }>('/birthday-automation/run', {
        method: 'POST',
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['birthday-automation'] })
      setFeedback(result.message)
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível executar o envio diário agora.')
    },
  })

  const previewText = useMemo(
    () =>
      messageTemplate
        .split('{{name}}')
        .join('Maria')
        .split('{{brand_name}}')
        .join('Sua marca')
        .trim(),
    [messageTemplate],
  )

  return (
    <AppShell
      title="Automação de aniversário"
      subtitle="Prepare a base do envio por WhatsApp com mensagem personalizável, aniversariantes do dia e trava por plano no envio real."
    >
      <section className="admin-page-hero mb-6 grid gap-3 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Relacionamento</p>
          <h2 className="mt-1 font-display text-[22px] leading-tight text-slate-950">
            Deixe a automação mais elegante e pronta para gerar lembrança de marca.
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] text-slate-600">
            Organize aniversariantes, refine a mensagem e acompanhe a fila de envio com uma leitura mais clara e agradável.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Automação</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{isEnabled ? 'Ativa' : 'Desligada'}</p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Hoje</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{data?.todayRecipients.length ?? 0} aniversariante(s)</p>
          </div>
          <div className="admin-inline-stat">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Envio real</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{canSendRealMessages ? 'Liberado' : 'Bloqueado no plano'}</p>
          </div>
        </div>
      </section>

      {feedback ? (
        <div
          className={`admin-alert mb-6 ${
            saveMutation.isError || runMutation.isError
              ? 'border border-rose-200 bg-rose-50 text-rose-900'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {feedback}
        </div>
      ) : null}

      <SectionCard
        eyebrow="Configuração"
        title="Mensagem de aniversário"
        description="Ative a automação, monte o texto padrão e deixe o sistema pronto para o envio diário."
      >
        {!canSendRealMessages ? (
          <div className="admin-alert mb-4 border-amber-200 bg-amber-50 text-amber-900">
            O envio real por WhatsApp está travado no plano atual. Você ainda pode configurar a automação e visualizar os aniversariantes de hoje.
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void saveMutation.mutateAsync()}
            disabled={saveMutation.isPending}
            className="admin-button-primary"
          >
            <MessageSquareText className="h-4 w-4" />
            {saveMutation.isPending ? 'Salvando...' : 'Salvar automação'}
          </button>

          <button
            type="button"
            onClick={() => void runMutation.mutateAsync()}
            disabled={runMutation.isPending || !isEnabled || !canSendRealMessages}
            className="admin-button disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {runMutation.isPending ? 'Executando...' : 'Executar envio de hoje'}
          </button>
        </div>

        <div className="grid gap-4">
          <label className="admin-checkrow">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(event) => setIsEnabled(event.target.checked)}
            />
            <span>
              <span className="block font-semibold text-slate-950">Ativar automação de aniversário</span>
              <span className="text-slate-500">Quando ativa, a rotina diária procura aniversariantes e monta a fila de envio.</span>
            </span>
          </label>

          <label className="grid gap-2 text-sm">
            <span className="text-slate-600">Modelo da mensagem</span>
            <textarea
              className="admin-input min-h-32"
              value={messageTemplate}
              onChange={(event) => setMessageTemplate(event.target.value)}
            />
          </label>

          <div className="admin-panel p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-950">Variáveis disponíveis</p>
            <p className="mt-2">
              Use <code>{'{{name}}'}</code> para o nome do cliente e <code>{'{{brand_name}}'}</code> para a marca da pesquisa.
            </p>
          </div>

          <div className="admin-subcard">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Prévia da mensagem</p>
            <p className="mt-3 text-sm text-slate-800">{previewText}</p>
          </div>
        </div>
      </SectionCard>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <SectionCard
          eyebrow="Hoje"
          title="Aniversariantes do dia"
          description="Visualize quem entraria no envio de hoje com base no nome, WhatsApp e aniversário salvos nas pesquisas."
        >
          {automationQuery.data?.todayRecipients.length ? (
            <div className="space-y-4">
              {automationQuery.data.todayRecipients.map((recipient) => (
                <article key={recipient.phone} className="admin-panel p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{recipient.surveyTitle}</p>
                      <h3 className="mt-2 flex items-center gap-2 text-lg font-semibold text-slate-950">
                        <Cake className="h-4 w-4 text-rose-500" />
                        {recipient.name}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {recipient.phone} {recipient.email ? `• ${recipient.email}` : ''} • aniversário em {recipient.birthdayLabel}
                      </p>
                    </div>
                    <span className="admin-badge bg-white">
                      Última resposta em {recipient.submittedAt}
                    </span>
                  </div>

                  <div className="admin-subcard mt-4 text-sm text-slate-700">
                    {recipient.previewMessage}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="admin-empty-state py-16">
              Nenhum aniversariante encontrado para hoje.
            </div>
          )}
        </SectionCard>

        <SectionCard
          eyebrow="Histórico"
          title="Fila e execuções recentes"
          description="A base do envio fica registrada aqui para auditoria e para a futura integração real com WhatsApp."
        >
          {automationQuery.data?.recentDispatches.length ? (
            <div className="space-y-4">
              {automationQuery.data.recentDispatches.map((dispatch) => (
                <article key={dispatch.id} className="admin-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{dispatch.dispatchDate}</p>
                      <p className="mt-2 font-semibold text-slate-950">{dispatch.participantName || dispatch.participantPhone}</p>
                    </div>
                    <span className="admin-badge border-slate-900 bg-slate-950 text-white">
                      {dispatch.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">
                    {dispatch.participantPhone} {dispatch.participantEmail ? `• ${dispatch.participantEmail}` : ''}
                  </p>
                  <div className="admin-subcard mt-4 text-sm text-slate-700">
                    {dispatch.renderedMessage}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="admin-empty-state py-16">
              Ainda não há execuções registradas para esta automação.
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  )
}
