import {
  BarChart3,
  ClipboardCheck,
  Gift,
  Link2,
  ListChecks,
  PieChart,
  Workflow,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

type SurveyTabId = 'summary' | 'questions' | 'share' | 'results' | 'flow' | 'prizes' | 'delivery'

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
  ]

  function isTabActive(tab: NavTab) {
    if (onTabClick) {
      return tab.id === activeTab
    }

    if (tab.id === 'results' && location.pathname.endsWith('/relatorios')) return true
    if (tab.id === 'flow' && location.pathname.endsWith('/editar')) return true
    if (tab.id === 'prizes' && location.pathname.endsWith('/premios')) return true
    if (tab.id === 'delivery' && location.pathname.endsWith('/entregas')) return true

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
      <div className="flex items-center px-2 sm:px-3">
        {surveyTitle ? (
          <div className="mr-3 hidden shrink-0 lg:block">
            <p className="max-w-[160px] truncate text-sm font-semibold text-slate-900">{surveyTitle}</p>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = isTabActive(tab)

            const className = `relative flex shrink-0 items-center gap-1.5 px-2.5 py-3 text-sm font-medium transition sm:gap-2 sm:px-4 ${
              isActive ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'
            }`

            const underline = (
              <span
                className={`absolute inset-x-0 -bottom-px h-0.5 transition-colors ${
                  isActive ? 'bg-blue-600' : 'bg-transparent'
                }`}
              />
            )

            if (onTabClick && ['summary', 'questions', 'share'].includes(tab.id)) {
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabClick(tab.id)}
                  className={className}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {underline}
                </button>
              )
            }

            return (
              <Link key={tab.id} to={tab.href} className={className}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{tab.label}</span>
                {underline}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
