import type { ReactNode } from 'react'
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { BrandingEffects } from '@/components/BrandingEffects'
import Home from '@/pages/Home'
import { useAuthStore } from '@/store/use-auth-store'

const DashboardPage = lazy(async () => {
  const module = await import('@/pages/DashboardPage')
  return { default: module.DashboardPage }
})

const BirthdayAutomationPage = lazy(async () => {
  const module = await import('@/pages/BirthdayAutomationPage')
  return { default: module.BirthdayAutomationPage }
})

const LoginPage = lazy(async () => {
  const module = await import('@/pages/LoginPage')
  return { default: module.LoginPage }
})

const PlansPage = lazy(async () => {
  const module = await import('@/pages/PlansPage')
  return { default: module.PlansPage }
})

const NpsSurveysPage = lazy(async () => {
  const module = await import('@/pages/NpsSurveysPage')
  return { default: module.NpsSurveysPage }
})

const PublicSurveyPage = lazy(async () => {
  const module = await import('@/pages/PublicSurveyPage')
  return { default: module.PublicSurveyPage }
})

const ReportsPage = lazy(async () => {
  const module = await import('@/pages/ReportsPage')
  return { default: module.ReportsPage }
})

const RewardsPage = lazy(async () => {
  const module = await import('@/pages/RewardsPage')
  return { default: module.RewardsPage }
})

const SettingsPage = lazy(async () => {
  const module = await import('@/pages/SettingsPage')
  return { default: module.SettingsPage }
})

const SignUpPage = lazy(async () => {
  const module = await import('@/pages/SignUpPage')
  return { default: module.SignUpPage }
})

const SurveyBuilderPage = lazy(async () => {
  const module = await import('@/pages/SurveyBuilderPage')
  return { default: module.SurveyBuilderPage }
})

const SurveyDetailsPage = lazy(async () => {
  const module = await import('@/pages/SurveyDetailsPage')
  return { default: module.SurveyDetailsPage }
})

const SurveysPage = lazy(async () => {
  const module = await import('@/pages/SurveysPage')
  return { default: module.SurveysPage }
})

const UsersPage = lazy(async () => {
  const module = await import('@/pages/UsersPage')
  return { default: module.UsersPage }
})

function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="text-center">
        <p className="font-display text-3xl">Carregando tela</p>
              <p className="mt-3 text-sm text-slate-300">Preparando a interface para você.</p>
      </div>
    </div>
  )
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user)
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping)

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <p className="font-display text-3xl">Carregando sessão</p>
          <p className="mt-3 text-sm text-slate-300">Preparando seu painel administrativo.</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}

function MasterRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user)
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping)

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <p className="font-display text-3xl">Carregando sessão</p>
          <p className="mt-3 text-sm text-slate-300">Validando permissões do painel.</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user.roleCode !== 'master') {
    return <Navigate to="/app" replace />
  }

  return children
}

function UserRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user)
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping)

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <p className="font-display text-3xl">Carregando sessão</p>
          <p className="mt-3 text-sm text-slate-300">Validando permissões do painel.</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user.roleCode !== 'user') {
    return <Navigate to="/app" replace />
  }

  return children
}

export default function App() {
  const user = useAuthStore((state) => state.user)
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping)
  const bootstrapSession = useAuthStore((state) => state.bootstrapSession)

  useEffect(() => {
    sessionStorage.removeItem('app:chunk-reload-once')
  }, [])

  useEffect(() => {
    void bootstrapSession()
  }, [bootstrapSession])

  useEffect(() => {
    if (!user) {
      return
    }

    const syncSession = () => {
      void bootstrapSession({ silent: true })
    }

    const intervalId = window.setInterval(syncSession, 15000)
    const handleFocus = () => syncSession()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncSession()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [bootstrapSession, user])

  return (
    <BrowserRouter>
      <BrandingEffects />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={user || isBootstrapping ? <Navigate to="/app" replace /> : <Home />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/criar-conta" element={<SignUpPage />} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/usuarios"
            element={
              <MasterRoute>
                <UsersPage />
              </MasterRoute>
            }
          />
          <Route
            path="/app/planos"
            element={
              <MasterRoute>
                <PlansPage />
              </MasterRoute>
            }
          />
          <Route
            path="/app/pesquisas"
            element={
              <UserRoute>
                <SurveysPage />
              </UserRoute>
            }
          />
          <Route
            path="/app/pesquisas/nps"
            element={
              <UserRoute>
                <NpsSurveysPage />
              </UserRoute>
            }
          />
          <Route
            path="/app/pesquisas/nova"
            element={
              <UserRoute>
                <SurveyBuilderPage />
              </UserRoute>
            }
          />
          <Route
            path="/app/pesquisas/:id"
            element={
              <UserRoute>
                <SurveyDetailsPage />
              </UserRoute>
            }
          />
          <Route
            path="/app/pesquisas/:id/editar"
            element={
              <UserRoute>
                <SurveyBuilderPage />
              </UserRoute>
            }
          />
          <Route
            path="/app/pesquisas/:id/teste"
            element={
              <UserRoute>
                <PublicSurveyPage />
              </UserRoute>
            }
          />
          <Route
            path="/app/pesquisas/:id/relatorios"
            element={
              <UserRoute>
                <ReportsPage />
              </UserRoute>
            }
          />
          <Route
            path="/app/pesquisas/:id/premios"
            element={
              <UserRoute>
                <RewardsPage />
              </UserRoute>
            }
          />
          <Route
            path="/app/automacoes/aniversario"
            element={
              <UserRoute>
                <BirthdayAutomationPage />
              </UserRoute>
            }
          />
          <Route
            path="/app/configuracoes"
            element={
              <MasterRoute>
                <SettingsPage />
              </MasterRoute>
            }
          />
          <Route path="/teste/:token" element={<PublicSurveyPage />} />
          <Route path="/:slug" element={<PublicSurveyPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
