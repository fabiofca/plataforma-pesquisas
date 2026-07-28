import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, ExternalLink, QrCode } from 'lucide-react'

import { buildApiUrl, downloadApiFile } from '@/lib/api-client'
import { hasFeatureAccess } from '@/lib/features'
import { copyText, getPublicSurveyPath, getPublicSurveyUrl } from '@/lib/public-survey'
import { useAuthStore } from '@/store/use-auth-store'

export function SurveyShareCard({
  surveyId,
  slug,
  compact = false,
  linkClicks = 0,
  qrScans = 0,
}: {
  surveyId: string
  slug: string
  compact?: boolean
  linkClicks?: number
  qrScans?: number
}) {
  const user = useAuthStore((state) => state.user)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [qrPreviewFailed, setQrPreviewFailed] = useState(false)
  const [qrFeedback, setQrFeedback] = useState('')
  const [isDownloadingQr, setIsDownloadingQr] = useState(false)
  const canUseQr = hasFeatureAccess(user, 'survey_share_qr')
  const canUseTracking = hasFeatureAccess(user, 'survey_share_tracking')
  const trackedPublicPath = useMemo(() => getPublicSurveyPath(slug, 'link'), [slug])
  const trackedPublicUrl = useMemo(() => getPublicSurveyUrl(slug, 'link'), [slug])
  const previewPublicPath = useMemo(() => getPublicSurveyPath(slug), [slug])
  const qrPreviewUrl = useMemo(
    () => (canUseQr ? buildApiUrl(`/surveys/${surveyId}/share/qr`) : ''),
    [canUseQr, surveyId],
  )

  useEffect(() => {
    if (copyStatus !== 'success') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setCopyStatus('idle')
    }, 2200)

    return () => window.clearTimeout(timeoutId)
  }, [copyStatus])

  useEffect(() => {
    setQrPreviewFailed(false)
    setQrFeedback('')
  }, [qrPreviewUrl])

  async function handleCopy() {
    try {
      await copyText(trackedPublicUrl)
      setCopyStatus('success')
    } catch {
      setCopyStatus('error')
    }
  }

  async function handleDownloadQr() {
    if (!canUseQr) {
      return
    }

    setIsDownloadingQr(true)
    setQrFeedback('')

    try {
      await downloadApiFile(`/surveys/${surveyId}/share/qr?download=1`, `qrcode-pesquisa-${slug}.png`)
    } catch (error) {
      setQrFeedback(error instanceof Error ? error.message : 'Não foi possível baixar o QR code agora.')
    } finally {
      setIsDownloadingQr(false)
    }
  }

  return (
    <section
      className={`rounded-[28px] border border-slate-200 bg-white ${compact ? 'p-4' : 'p-5 shadow-card'}`}
    >
      <div className={`gap-5 ${compact ? 'grid lg:grid-cols-[1fr_auto]' : 'grid xl:grid-cols-[1.2fr_0.8fr]'}`}>
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-slate-500">
            <QrCode className="h-4 w-4" />
            Compartilhamento
          </div>
          <h3 className={`mt-3 font-display text-slate-950 ${compact ? 'text-xl' : 'text-2xl'}`}>
            URL pronta para copiar
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            Use este link para divulgar a pesquisa e baixe o QR code para materiais impressos ou telas.
          </p>

          <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Link público</p>
            <p className="mt-2 break-all text-sm font-medium text-slate-950">{trackedPublicUrl}</p>
            <p className="mt-2 text-xs text-slate-500">Rota rastreada: {trackedPublicPath}</p>
          </div>

          {canUseTracking ? (
            <div className={`mt-4 grid gap-3 ${compact ? 'grid-cols-2' : 'sm:grid-cols-3'}`}>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cliques no link</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{linkClicks}</p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Leituras do QR</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{qrScans}</p>
              </div>
              {!compact ? (
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total de acessos</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{linkClicks + qrScans}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              aria-label="Copiar URL pública da pesquisa"
            >
              {copyStatus === 'success' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copyStatus === 'success' ? 'Link copiado' : 'Copiar link'}
            </button>
            {canUseQr ? (
              <button
                type="button"
                onClick={() => void handleDownloadQr()}
                disabled={isDownloadingQr}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Baixar QR code da pesquisa"
              >
                <Download className="h-4 w-4" />
                {isDownloadingQr ? 'Baixando QR code...' : 'Baixar QR code'}
              </button>
            ) : null}
            <a
              href={previewPublicPath}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              aria-label="Abrir pesquisa pública"
            >
              <ExternalLink className="h-4 w-4" />
              Abrir pesquisa
            </a>
          </div>

          {copyStatus === 'error' ? (
            <p className="mt-3 text-sm text-rose-700">Não consegui copiar automaticamente. Você ainda pode copiar a URL acima.</p>
          ) : null}

          {qrFeedback ? <p className="mt-3 text-sm text-rose-700">{qrFeedback}</p> : null}
        </div>

        <div className="flex items-center justify-center">
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
            {canUseQr && qrPreviewUrl && !qrPreviewFailed ? (
              <img
                src={qrPreviewUrl}
                alt={`QR code da pesquisa ${slug}`}
                crossOrigin="use-credentials"
                onError={() => setQrPreviewFailed(true)}
                className={compact ? 'h-28 w-28 rounded-2xl bg-white p-2' : 'h-56 w-56 rounded-[24px] bg-white p-3'}
              />
            ) : (
              <div
                className={`flex items-center justify-center rounded-[24px] bg-white text-slate-400 ${
                  compact ? 'h-28 w-28' : 'h-56 w-56'
                }`}
              >
                {canUseQr ? (
                  <div className="px-4 text-center">
                    <QrCode className={`mx-auto text-slate-400 ${compact ? 'h-10 w-10' : 'h-16 w-16'}`} />
              <p className="mt-3 text-xs font-medium text-slate-500">Não foi possível carregar a prévia do QR agora.</p>
                  </div>
                ) : (
                  <p className="max-w-[11rem] text-center text-xs font-medium text-slate-500">
            QR code indisponível no plano atual.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
