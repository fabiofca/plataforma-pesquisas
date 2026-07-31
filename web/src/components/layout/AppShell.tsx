import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Cake,
  ChevronRight,
  CreditCard,
  FileBarChart2,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users2,
  X,
} from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { defaultBrandingSettings, useBrandingSettings } from '@/hooks/useBrandingSettings'
import { useAuthStore } from '@/store/use-auth-store'

const DESKTOP_BREAKPOINT = 900
const DESKTOP_SIDEBAR_OPEN_WIDTH = 248
const DESKTOP_SIDEBAR_CLOSED_WIDTH = 76
const MOBILE_SIDEBAR_WIDTH = 280
const HEADER_HEIGHT = 56
const APP_COMMIT_SHA = __APP_COMMIT_SHA__

function normalizeHexColor(value: string, fallback: string) {
  return /^#([0-9a-f]{6})$/i.test(value) ? value : fallback
}

function hexToRgb(value: string) {
  const normalized = normalizeHexColor(value, '#11284a').replace('#', '')

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function withAlpha(value: string, alpha: number) {
  const { r, g, b } = hexToRgb(value)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

type NavigationItem = {
  to: string
  label: string
  icon: typeof LayoutDashboard
}

type SidebarBodyProps = {
  compact: boolean
  platformName: string
  brandLogoUrl: string
  roleCode?: string
  userName?: string
  userEmail?: string
  sidebarColor: string
  navigation: NavigationItem[]
  onNavigate?: () => void
  onSignOut: () => void
}

function SidebarBody({
  compact,
  platformName,
  brandLogoUrl,
  roleCode,
  userName,
  userEmail,
  sidebarColor,
  navigation,
  onNavigate,
  onSignOut,
}: SidebarBodyProps) {
  const location = useLocation()

  function isNavigationActive(path: string) {
    if (path === '/app') {
      return location.pathname === '/app'
    }

    if (path === '/app/pesquisas/nps') {
      return location.pathname.startsWith('/app/pesquisas/nps')
    }

    if (path === '/app/pesquisas') {
      return location.pathname.startsWith('/app/pesquisas') && !location.pathname.startsWith('/app/pesquisas/nps')
    }

    return location.pathname.startsWith(path)
  }

  return (
    <div className="flex h-full min-h-screen flex-col">
      <div
        className={`flex h-14 items-center border-b px-4 ${compact ? 'justify-center' : 'justify-between gap-3'}`}
        style={{ borderColor: withAlpha('#ffffff', 0.1) }}
      >
        {compact ? (
          brandLogoUrl ? (
            <img src={brandLogoUrl} alt={platformName} className="h-7 w-7 object-contain" />
          ) : (
            <span className="font-display text-lg text-white">{platformName.slice(0, 1)}</span>
          )
        ) : brandLogoUrl ? (
          <img src={brandLogoUrl} alt={platformName} className="h-8 w-auto max-w-[150px] object-contain" />
        ) : (
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] leading-tight text-white">{platformName}</p>
          </div>
        )}

        {!compact && roleCode ? (
          <span
            className="shrink-0 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white"
            style={{ backgroundColor: withAlpha('#ffffff', 0.1), borderRadius: 6 }}
          >
            {roleCode}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-2 py-2">
        {!compact ? (
          <div
            className="mb-2 border px-3 py-3"
            style={{
              borderColor: withAlpha('#ffffff', 0.08),
              backgroundColor: withAlpha('#ffffff', 0.05),
              borderRadius: 6,
            }}
          >
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Usuário atual</p>
            <p className="mt-2 text-sm font-semibold text-white">{userName}</p>
            <p className="truncate text-xs text-slate-400">{userEmail}</p>
          </div>
        ) : null}

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon

            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                title={compact ? item.label : undefined}
                className={() =>
                  `flex items-center gap-3 px-3 py-2 text-sm transition ${
                    compact ? 'justify-center' : ''
                  } ${isNavigationActive(item.to) ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`
                }
                style={{ borderRadius: 6 }}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!compact ? <span className="truncate">{item.label}</span> : null}
              </NavLink>
            )
          })}
        </nav>

        <button
          type="button"
          onClick={onSignOut}
          className={`mt-2 flex items-center justify-center gap-2 border px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 ${
            compact ? '' : 'w-full'
          }`}
          style={{
            borderColor: withAlpha('#ffffff', 0.08),
            backgroundColor: withAlpha('#ffffff', 0.06),
            borderRadius: 6,
          }}
          title={compact ? 'Sair' : undefined}
        >
          <LogOut className="h-4 w-4" />
          {!compact ? 'Sair' : null}
        </button>

        <div
          className={`mt-2 border px-3 py-2 text-[11px] ${compact ? 'text-center' : ''}`}
          style={{
            borderColor: withAlpha('#ffffff', 0.08),
            backgroundColor: withAlpha('#ffffff', 0.04),
            borderRadius: 6,
          }}
          title={`Commit ${APP_COMMIT_SHA}`}
        >
          {compact ? (
            <span className="font-semibold uppercase tracking-[0.12em] text-slate-300">#{APP_COMMIT_SHA}</span>
          ) : (
            <>
              <p className="uppercase tracking-[0.16em] text-slate-400">Versão atual</p>
              <p className="mt-1 font-semibold text-white">Commit {APP_COMMIT_SHA}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function AppShell({
  title,
  subtitle,
  children,
  backHref,
  backLabel = 'Voltar',
  breadcrumbs,
  hideHeader,
}: {
  title: string
  subtitle: string
  children: ReactNode
  backHref?: string
  backLabel?: string
  breadcrumbs?: Array<{
    label: string
    href?: string
  }>
  hideHeader?: boolean
}) {
  const { user, signOut } = useAuthStore()
  const navigate = useNavigate()
  const branding = useBrandingSettings().data ?? defaultBrandingSettings
  const [isDesktopViewport, setIsDesktopViewport] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= DESKTOP_BREAKPOINT,
  )
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const sidebarColor = normalizeHexColor(branding.sidebarColor, defaultBrandingSettings.sidebarColor)

  useEffect(() => {
    const saved = window.localStorage.getItem('app-shell-sidebar-open')

    if (saved === 'false') {
      setIsDesktopSidebarOpen(false)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('app-shell-sidebar-open', String(isDesktopSidebarOpen))
  }, [isDesktopSidebarOpen])

  useEffect(() => {
    const handleResize = () => {
      const nextIsDesktop = window.innerWidth >= DESKTOP_BREAKPOINT
      setIsDesktopViewport(nextIsDesktop)

      if (nextIsDesktop) {
        setIsMobileSidebarOpen(false)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const navigation = useMemo(
    () => [
      { to: '/app', label: 'Resumo', icon: LayoutDashboard },
      ...(user?.roleCode === 'master' ? [{ to: '/app/usuarios', label: 'Usuários', icon: Users2 }] : []),
      ...(user?.roleCode === 'master' ? [{ to: '/app/planos', label: 'Planos', icon: CreditCard }] : []),
      ...(user?.roleCode !== 'master' ? [{ to: '/app/pesquisas', label: 'Pesquisas', icon: BarChart3 }] : []),
      ...(user?.roleCode !== 'master' ? [{ to: '/app/pesquisas/nps', label: 'NPS', icon: FileBarChart2 }] : []),
      ...(user?.roleCode !== 'master'
        ? [{ to: '/app/automacoes/aniversario', label: 'Aniversário', icon: Cake }]
        : []),
      ...(user?.roleCode === 'master' ? [{ to: '/app/configuracoes', label: 'Configurações', icon: Settings }] : []),
    ],
    [user?.roleCode],
  )

  const desktopSidebarWidth = isDesktopSidebarOpen ? DESKTOP_SIDEBAR_OPEN_WIDTH : DESKTOP_SIDEBAR_CLOSED_WIDTH
  const contentOffset = isDesktopViewport ? desktopSidebarWidth : 0

  function handleSidebarToggle() {
    if (isDesktopViewport) {
      setIsDesktopSidebarOpen((current) => !current)
      return
    }

    setIsMobileSidebarOpen((current) => !current)
  }

  function handleMobileClose() {
    setIsMobileSidebarOpen(false)
  }

  function handleBackNavigation() {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }

    if (backHref) {
      navigate(backHref)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {!isDesktopViewport && isMobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Fechar menu lateral"
          className="fixed inset-0 z-40 bg-slate-950/45"
          onClick={handleMobileClose}
        />
      ) : null}

      {isDesktopViewport ? (
        <aside
          className="fixed inset-y-0 left-0 z-30 flex h-screen flex-col overflow-hidden border-r text-white transition-[width] duration-200"
          style={{
            width: desktopSidebarWidth,
            backgroundColor: sidebarColor,
            borderColor: withAlpha(sidebarColor, 0.72),
          }}
        >
          <SidebarBody
            compact={!isDesktopSidebarOpen}
            platformName={branding.platformName}
            brandLogoUrl={branding.brandLogoUrl}
            roleCode={user?.roleCode}
            userName={user?.name}
            userEmail={user?.email}
            sidebarColor={sidebarColor}
            navigation={navigation}
            onSignOut={() => {
              void signOut()
            }}
          />
        </aside>
      ) : (
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex h-screen flex-col overflow-hidden border-r text-white transition-transform duration-200 ${
            isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{
            width: MOBILE_SIDEBAR_WIDTH,
            backgroundColor: sidebarColor,
            borderColor: withAlpha(sidebarColor, 0.72),
          }}
        >
          <div className="flex h-14 items-center justify-end border-b px-3" style={{ borderColor: withAlpha('#ffffff', 0.1) }}>
            <button
              type="button"
              onClick={handleMobileClose}
              className="inline-flex h-9 w-9 items-center justify-center border text-white"
              style={{ borderColor: withAlpha('#ffffff', 0.12), borderRadius: 6 }}
              aria-label="Fechar menu lateral"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <SidebarBody
            compact={false}
            platformName={branding.platformName}
            brandLogoUrl={branding.brandLogoUrl}
            roleCode={user?.roleCode}
            userName={user?.name}
            userEmail={user?.email}
            sidebarColor={sidebarColor}
            navigation={navigation}
            onNavigate={handleMobileClose}
            onSignOut={() => {
              handleMobileClose()
              void signOut()
            }}
          />
        </aside>
      )}

      <div
        className="transition-[margin-left] duration-200"
        style={{ marginLeft: contentOffset }}
      >
        <header
          className="fixed top-0 right-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur"
          style={{
            left: contentOffset,
            height: HEADER_HEIGHT,
          }}
        >
          <div className="flex h-full items-center justify-between gap-3 px-3 md:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={handleSidebarToggle}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100"
                style={{ borderRadius: 6 }}
                aria-label={isDesktopViewport ? 'Abrir ou fechar barra lateral' : 'Abrir menu lateral'}
              >
                <Menu className="h-4 w-4" />
              </button>

              <div className="min-w-0">
                <p className="truncate text-[11px] uppercase tracking-[0.18em] text-slate-500">{branding.platformName}</p>
                <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="admin-badge hidden sm:block">Painel rápido</div>
              <div className="admin-badge hidden md:block">{user?.roleCode === 'master' ? 'Conta master' : 'Seu painel'}</div>
            </div>
          </div>
        </header>

        <main className="px-2 pb-2 pt-[64px] md:px-3">
          <div className={`min-h-[calc(100vh-4.5rem)] w-full border border-slate-200 bg-white shadow-card ${hideHeader ? '' : 'p-3 md:p-4 xl:p-5'}`}>
            {!hideHeader ? (
              <header className="mb-4 border-b border-slate-200 pb-3">
                {(backHref || breadcrumbs?.length) ? (
                  <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      {backHref ? (
                        <button
                          type="button"
                          onClick={handleBackNavigation}
                          className="inline-flex items-center gap-2 border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                          style={{ borderRadius: 6 }}
                        >
                          <ArrowLeft className="h-4 w-4" />
                          {backLabel}
                        </button>
                      ) : null}
                    </div>

                    {breadcrumbs?.length ? (
                      <nav
                        className="flex flex-wrap items-center gap-2 text-sm text-slate-500 lg:justify-end"
                        aria-label="Caminho da pÃ¡gina"
                      >
                        {breadcrumbs.map((item, index) => (
                          <div key={`${item.label}-${index}`} className="flex items-center gap-2">
                            {item.href ? (
                              <Link to={item.href} className="transition hover:text-slate-900">
                                {item.label}
                              </Link>
                            ) : (
                              <span className="font-medium text-slate-900">{item.label}</span>
                            )}

                            {index < breadcrumbs.length - 1 ? <ChevronRight className="h-4 w-4 text-slate-400" /> : null}
                          </div>
                        ))}
                      </nav>
                    ) : null}
                  </div>
                ) : null}
                <h1 className="font-display text-[26px] leading-none text-slate-950 sm:text-[30px] lg:text-[34px]">{title}</h1>
                {subtitle ? <p className="mt-1 text-[13px] text-slate-600">{subtitle}</p> : null}
              </header>
            ) : null}

            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
