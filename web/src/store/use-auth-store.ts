import { create } from 'zustand'

import { ApiError, apiRequest } from '@/lib/api-client'
import type { AuthUser } from '@/types/domain'

interface AuthState {
  user: AuthUser | null
  isBootstrapping: boolean
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>
  signUp: (payload: {
    name: string
    email: string
    password: string
    phone?: string
  }) => Promise<{ ok: boolean; message?: string }>
  bootstrapSession: (options?: { silent?: boolean }) => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isBootstrapping: true,
  async signIn(email, password) {
    try {
      const response = await apiRequest<{ user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })

      set({ user: response.user })
      return { ok: true }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return { ok: false, message: error.message }
      }

      return {
        ok: false,
        message: 'Não foi possível autenticar agora. Verifique a API e o banco.',
      }
    }
  },
  async signUp(payload) {
    try {
      const response = await apiRequest<{ user: AuthUser }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      set({ user: response.user })
      return { ok: true }
    } catch (error) {
      if (error instanceof ApiError) {
        return { ok: false, message: error.message }
      }

      return {
        ok: false,
        message: 'Não foi possível criar a conta agora. Verifique a API e tente novamente.',
      }
    }
  },
  async bootstrapSession(options) {
    if (!options?.silent) {
      set({ isBootstrapping: true })
    }

    try {
      const response = await apiRequest<{ user: AuthUser }>('/auth/me')
      set({ user: response.user, isBootstrapping: false })
    } catch {
      set({ user: null, isBootstrapping: false })
    }
  },
  async signOut() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' })
    } catch {
      // O logout local continua mesmo se a API estiver fora.
    }

    set({ user: null })
  },
}))
