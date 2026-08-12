import {
  BarChart3,
  ClipboardCheck,
  Gift,
  Link2,
  ListChecks,
  PieChart,
  Users,
  Workflow,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

type SurveyTabId = 'summary' | 'questions' | 'share' | 'results' | 'flow' | 'prizes' | 'delivery' | 'attendants'

type NavTab = {
  id: SurveyTabId
  label: string
  icon: typeof PieChart
  href: string
}

/**
 * Shared sticky navigation bar for all survey pages.
 * Renders tabs linking to all survey sections, always fixed at the top below the header.
 */
export function SurveyNavBar({
  surveyId,
  surveyTitle,
  activeTab,
  onTabClick,
}: {
  surveyId: string
  surveyTitle?: string
  activeTab: SurveyTabId
  onTabClick?: (tab: SurveyTabId) => void
}) {
  const location = useLocation()
  const basePath = `/app/pesquisas/${surveyId}`

  const tabs: NavTab[] = [
    { id: 'summary', label: 'Resumo', icon: PieChart, href: basePath },
    { id: 'questions', label: 'Perguntas', icon: ListChecks, href: `${basePath}#perguntas` },
    { id: 'share', label: 'Compartilhar', icon: Link2, href: `${basePath}#compartilhar` },
    { id: 'results', label: 'Resultados', icon: BarChart3, href: `${basePath}/relatorios` },
    { id: 'flow', label: 'Fluxo', icon: Workflow, href: `${basePath}/editar` },
    { id: 'prizes', label: 'Prêmios', icon: Gift, href: `${basePath}/premios` },
    { id: 'delivery', label: 'Controle de entrega', icon: ClipboardCheck, href: `${basePath}/entregas` },
    { id: 'attendants', label: 'Atendentes', icon: Users, href: `${basePath}/atendentes` },
  ]

  function isTabActive(tab: NavTab) {
    if (onTabClick) {
      return tab.id === activeTab
    }

    if (tab.id === 'results' && location.pathname.endsWith('/relatorios')) return true
    if (tab.id === 'flow' && location.pathname.endsWith('/editar')) return true
    if (tab.id === 'prizes' && location.pathname.endsWith('/premios')) return true
    if (tab.id === 'delivery' && location.pathname.endsWith('/entregas')) return true
    if (tab.id === 'attendants' && location.pathname.endsWith('/atendentes')) return true

    if (location.pathname === basePath || location.pathname === `${basePath}/`) {
      const hash = location.hash
      if (tab.id === 'share' && hash === '#compartilhar') return true
      if (tab.id === 'questions' && hash === '#perguntas') return true
      if (tab.id === 'summary' && !hash) return true
    }

    return false
  }

  return (
    <div className="sticky top-[56px] z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="border-b border-slate-200/80 px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Pesquisa atual
          </span>
          <p className="min-w-0 truncate text-sm font-semibold text-slate-950 sm:text-base">
            {surveyTitle?.trim() || 'Pesquisa sem título'}
          </p>
        </div>
      </div>

      <div className="px-2 py-2 sm:px-3">
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = isTabActive(tab)

            const className = `relative flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition sm:px-4 ${
              isActive
                ? 'border-blue-200 bg-blue-50 text-blue-700 shadow-[0_8px_24px_rgba(37,99,235,0.12)]'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
            }`

            if (onTabClick && ['summary', 'questions', 'share'].includes(tab.id)) {
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabClick(tab.id)}
                  className={className}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap text-xs sm:text-sm">{tab.label}</span>
                </button>
              )
            }

            return (
              <Link key={tab.id} to={tab.href} className={className}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap text-xs sm:text-sm">{tab.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
