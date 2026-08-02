import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, Loader2, Moon, Sun } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { defaultBrandingSettings, useBrandingSettings } from '@/hooks/useBrandingSettings'
import { useTheme } from '@/hooks/useTheme'
import { useAuthStore } from '@/store/use-auth-store'

export function LoginPage() {
  const navigate = useNavigate()
  const signIn = useAuthStore((state) => state.signIn)
  const { isDark, toggleTheme } = useTheme()
  const branding = useBrandingSettings().data ?? defaultBrandingSettings
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setHint('')
    setIsSubmitting(true)

    const result = await signIn(email, password)
    setIsSubmitting(false)

    if (!result.ok) {
      setError(result.message ?? 'Credenciais inválidas.')
      return
    }

    if (result.message) {
      setHint(result.message)
    }

    navigate('/app')
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 lg:px-6">
      <button
        type="button"
        onClick={toggleTheme}
        className="fixed right-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100"
        style={{ borderRadius: 8 }}
        aria-label={isDark ? 'Ativar modo claro' : 'Ativar modo escuro'}
        title={isDark ? 'Modo claro' : 'Modo escuro'}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="admin-panel flex flex-col justify-between p-6 animate-fade-in-up lg:p-8">
          <div>
            {branding.brandLogoUrl ? (
              <img
                src={branding.brandLogoUrl}
                alt={branding.platformName}
                className="h-12 w-auto max-w-[220px] object-contain"
              />
            ) : (
              <p className="font-display text-3xl text-slate-950">{branding.platformName}</p>
            )}

            <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-slate-500">Acesso ao painel</p>
            <h1 className="mt-2 font-display text-4xl text-slate-950 lg:text-5xl">Acesse suas pesquisas.</h1>
            <p className="mt-4 max-w-xl text-sm text-slate-600">
              Entre com seu e-mail e senha para gerenciar pesquisas, acompanhar respostas e controlar prêmios.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Pesquisas', 'Criar e publicar'],
              ['Relatórios', 'Ler resultados'],
              ['Roleta', 'Controlar prêmios'],
            ].map(([title, description], index) => (
              <article key={title} className={`admin-subcard animate-fade-in-up delay-${(index + 1) * 100}`}>
                <p className="text-sm font-semibold text-slate-950">{title}</p>
                <p className="mt-1 text-sm text-slate-600">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border border-slate-200 bg-white p-6 shadow-card animate-fade-in-scale lg:p-8" style={{ borderRadius: 8 }}>
          <div className="w-full">
            <div className="mb-8">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Login</p>
              <h2 className="mt-2 font-display text-4xl text-slate-950">Entrar no painel</h2>
              <p className="mt-3 text-sm text-slate-600">Use seu e-mail e senha para acessar.</p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm text-slate-700">E-mail</span>
                <input aria-label="E-mail" className="admin-input" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm text-slate-700">Senha</span>
                <div className="relative">
                  <input
                    aria-label="Senha"
                    type={showPassword ? 'text' : 'password'}
                    className="admin-input pr-10"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition hover:text-slate-600"
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              {error ? <p className="admin-alert border-rose-200 bg-rose-50 text-rose-900">{error}</p> : null}
              {hint ? <p className="admin-alert border-amber-200 bg-amber-50 text-amber-900">{hint}</p> : null}

              <button type="submit" disabled={isSubmitting} className="admin-button-primary w-full min-h-[44px]">
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    Entrar
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 admin-subcard text-sm text-slate-700">
              <p className="font-medium text-slate-950">Ainda não tem conta?</p>
              <p className="mt-2">Crie um acesso de cliente para usar a plataforma sem depender do usuário master.</p>
              <Link to="/criar-conta" className="mt-4 admin-button">
                Criar conta
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>


          </div>
        </section>
      </div>
    </div>
  )
}
