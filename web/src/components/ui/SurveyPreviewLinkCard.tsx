import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Copy, ExternalLink, Link2, ShieldCheck, Sparkles } from 'lucide-react'

import { apiRequest } from '@/lib/api-client'
import { copyText } from '@/lib/public-survey'

type PreviewLinkResponse = {
  token: string
  path: string
  url: string
  message: string
}

type SurveyPreviewLinkCardProps = {
  surveyId: string
  isDraft: boolean
}

export function SurveyPreviewLinkCard({ surveyId, isDraft }: SurveyPreviewLinkCardProps) {
  const [previewUrl, setPreviewUrl] = useState('')
  const [feedback, setFeedback] = useState('')

  const generateLinkMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<PreviewLinkResponse>(`/surveys/${surveyId}/preview-link`)
    },
    onSuccess: async (result) => {
      setPreviewUrl(result.url)
      setFeedback(result.message)

      try {
        await copyText(result.url)
        setFeedback('Link de teste gerado e copiado. Ele fica claramente marcado como teste e expira ao publicar.')
      } catch {
        setFeedback(result.message)
      }
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível gerar o link de teste agora.')
    },
  })

  const canOpenPreview = useMemo(() => previewUrl.trim().length > 0, [previewUrl])

  async function handleCopyPreviewLink() {
    if (!previewUrl) {
      return
    }

    try {
      await copyText(previewUrl)
      setFeedback('Link de teste copiado com sucesso.')
    } catch {
      setFeedback('Não consegui copiar automaticamente. Você ainda pode copiar a URL abaixo.')
    }
  }

  return (
    <div className="border border-sky-200 p-4 shadow-card" style={{ borderRadius: 8, background: 'linear-gradient(180deg, var(--surface-0) 0%, var(--surface-1) 100%)' }}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sky-700">
            <Sparkles className="h-4 w-4" />
            <p className="text-xs uppercase tracking-[0.18em]">Link de teste compartilhável</p>
          </div>
          <h3 className="mt-2 text-base font-semibold text-slate-950">Envie a pesquisa em modo teste sem publicar de verdade</h3>
          <p className="mt-2 text-sm text-slate-600">
            O formulário abre com aviso explícito de <strong>MODO TESTE</strong>, não salva respostas reais e deixa de funcionar automaticamente quando a pesquisa for publicada.
          </p>
        </div>

        <button
          type="button"
          disabled={!isDraft || generateLinkMutation.isPending}
          onClick={() => void generateLinkMutation.mutateAsync()}
          className="admin-button-primary self-start disabled:opacity-60"
        >
          <Link2 className="h-4 w-4" />
          {generateLinkMutation.isPending ? 'Gerando...' : previewUrl ? 'Gerar novamente' : 'Gerar link de teste'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="admin-subcard">
          <div className="flex items-center gap-2 text-slate-900">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold">Regras desse link</p>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>Abre com aviso visual explícito de teste.</li>
            <li>Não grava resposta real, relatório nem prêmio real.</li>
            <li>Expira automaticamente quando a pesquisa sai de rascunho.</li>
          </ul>
        </div>

        <div className="admin-subcard">
          <p className="text-sm font-semibold text-slate-900">Status atual</p>
          <p className="mt-3 text-sm text-slate-600">
            {isDraft
              ? 'A pesquisa está em rascunho, então o link de teste pode ser gerado normalmente.'
              : 'A pesquisa já foi publicada ou pausada. Por boa prática, o link de teste deixa de ficar disponível.'}
          </p>
        </div>
      </div>

      {previewUrl ? (
        <div className="mt-4 border border-sky-200 p-4" style={{ borderRadius: 8, background: 'var(--surface-0)' }}>
          <p className="text-xs uppercase tracking-[0.18em] text-sky-700">URL de teste</p>
          <p className="mt-2 break-all text-sm text-slate-700">{previewUrl}</p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => void handleCopyPreviewLink()} className="admin-button">
              <Copy className="h-4 w-4" />
              Copiar link
            </button>
            <a href={previewUrl} target="_blank" rel="noreferrer" className="admin-button">
              <ExternalLink className="h-4 w-4" />
              Abrir teste
            </a>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <div className="mt-4 border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" style={{ borderRadius: 8 }}>
          {feedback}
        </div>
      ) : null}
    </div>
  )
}
