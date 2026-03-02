/**
 * 登录状态管理
 * 单用户登录，状态由后端 Cookie + /api/auth/status 决定
 */

import { create } from 'zustand'

interface AuthState {
  isAuthenticated: boolean
  authInitialized: boolean
  username: string | null
  setAuthState: (isAuthenticated: boolean, username?: string | null) => void
  clearAuthState: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  authInitialized: false,
  username: null,
  setAuthState: (isAuthenticated, username = null) =>
    set({
      isAuthenticated,
      username: isAuthenticated ? username : null,
      authInitialized: true,
    }),
  clearAuthState: () =>
    set({
      isAuthenticated: false,
      username: null,
      authInitialized: true,
    }),
}))

