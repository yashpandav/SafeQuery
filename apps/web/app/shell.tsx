'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from './sidebar'

const AUTH_PATHS = ['/login', '/register']

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuth = AUTH_PATHS.includes(pathname)

  if (isAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        {children}
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
