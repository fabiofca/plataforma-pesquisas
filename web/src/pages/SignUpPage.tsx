import { useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Moon, ShieldCheck, Sun } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { defaultBrandingSettings, useBrandingSettings } from '@/hooks/useBrandingSettings'
import { useTheme } from '@/hooks/useTheme'
import { useAuthStore } from '@/store/use-auth-store'

export function SignUpPage() {
  const navigate = useNavigate()
  const signUp = useAuthStore((state) => state.signUp)
  const { isDark, toggleTheme } = useTheme()
  const branding = useBrandingSettings().data ?? defaultBrandingSettings

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }

    setIsSubmitting(true)
    const result = await signUp({
      name,
      email,
      password,
      phone,
    })
    setIsSubmitting(false)

    if (!result.ok) {
      setError(result.message ?? 'Não foi possível criar sua conta agora.')
      return
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
        <section className="admin-panel flex flex-col justify-between p-6 lg:p-8">
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

            <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-slate-500">Criar conta</p>
            <h1 className="mt-2 font-display text-4xl text-slate-950 lg:text-5xl">Comece a usar sem depender de suporte.</h1>
            <p className="mt-4 max-w-xl text-sm text-slate-600">
              Depois do cadastro você já entra no painel para criar pesquisas e acompanhar os resultados.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Conta cliente', 'Acesso comum'],
              ['Painel simples', 'Desktop e celular'],
              ['Pesquisa ao vivo', 'Publicar e acompanhar'],
            ].map(([title, description]) => (
              <article key={title} className="admin-subcard">
                <p className="text-sm font-semibold text-slate-950">{title}</p>
                <p className="mt-1 text-sm text-slate-600">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border border-slate-200 bg-white p-6 shadow-card lg:p-8" style={{ borderRadius: 8 }}>
          <div className="w-full">
            <div className="mb-8">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cadastro</p>
              <h2 className="mt-2 font-display text-4xl text-slate-950">Criar conta</h2>
              <p className="mt-3 text-sm text-slate-600">Preencha os dados para acessar o painel.</p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm text-slate-700">Nome</span>
                <input
                  aria-label="Nome"
                  className="admin-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Seu nome ou nome da empresa"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm text-slate-700">E-mail</span>
                <input
                  aria-label="E-mail"
                  type="email"
                  className="admin-input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="voce@empresa.com"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm text-slate-700">Telefone</span>
                <input
                  aria-label="Telefone"
                  className="admin-input"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Opcional"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm text-slate-700">Senha</span>
                  <input
                    aria-label="Senha"
                    type="password"
                    className="admin-input"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Mínimo de 6 caracteres"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm text-slate-700">Confirmar senha</span>
                  <input
                    aria-label="Confirmar senha"
                    type="password"
                    className="admin-input"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repita a senha"
                  />
                </label>
              </div>

              {error ? <p className="admin-alert border-rose-200 bg-rose-50 text-rose-900">{error}</p> : null}

              <button type="submit" disabled={isSubmitting} className="admin-button-primary w-full min-h-[44px]">
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Criando conta...
                  </>
                ) : (
                  <>
                    Criar conta e entrar
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 admin-alert border-emerald-200 bg-emerald-50 text-emerald-900">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4" />
                Perfil criado com segurança
              </div>
              <p className="mt-2">O cadastro público cria apenas contas do tipo cliente. O usuário master continua reservado para a administração global.</p>
            </div>

            <Link to="/login" className="mt-6 inline-flex items-center gap-2 text-sm text-slate-600 transition hover:text-slate-950">
              <ArrowLeft className="h-4 w-4" />
              Voltar para o login
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
