import { BarChart3, LogIn } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 py-12 text-center">
      <div className="mx-auto w-full max-w-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
          <BarChart3 className="h-8 w-8" />
        </div>

        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Plataforma de Pesquisas
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400 sm:text-base">
          Crie pesquisas, engaje seus clientes com prêmios e acompanhe os resultados em tempo real.
        </p>

        <div className="mt-8 space-y-3">
          <Link
            to="/login"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            <LogIn className="h-4 w-4" />
            Entrar no painel
          </Link>

          <Link
            to="/criar-conta"
            className="inline-flex w-full items-center justify-center rounded-xl border border-slate-700 bg-transparent px-6 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Criar conta
          </Link>
        </div>

        <p className="mt-8 text-xs text-slate-500">
          Acesse suas pesquisas, relatórios e campanhas de prêmios em um só lugar.
        </p>
      </div>
    </div>
  )
}
