'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface Session {
  sessionToken: string
  orgId: string
  userId: string
  email: string
  platformRole: string
}

interface SessionContextValue {
  session: Session | null
  setSession: (session: Session | null) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)
const STORAGE_KEY = 'safequery.session'

function readStoredSession(): Session | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}
export function getStoredSession(): Session | null {
  return readStoredSession()
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setSessionState(readStoredSession())
    setHydrated(true)
  }, [])

  function setSession(next: Session | null) {
    setSessionState(next)
    if (next) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else window.localStorage.removeItem(STORAGE_KEY)
  }

  if (!hydrated) return null

  return <SessionContext.Provider value={{ session, setSession }}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
