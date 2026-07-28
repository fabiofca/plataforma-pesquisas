import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import App from '@/App'
import { useAuthStore } from '@/store/use-auth-store'

describe('App', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isBootstrapping: false,
      bootstrapSession: async () => {},
    })
  })

  it('renderiza a página de login quando não há usuário autenticado', async () => {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )

    expect(await screen.findByText(/entrar no painel/i)).toBeTruthy()
  })
})
