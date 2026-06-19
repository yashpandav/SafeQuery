'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from '../lib/session'

export function NavBar() {
  const { session, setSession } = useSession()
  const router = useRouter()

  function handleLogout() {
    setSession(null)
    router.push('/login')
  }

  return (
    <nav className="flex items-center justify-between border-b border-border px-6 py-3" aria-label="Main navigation">
      <Link href="/" className="text-base font-bold">
        SafeQuery
      </Link>
      {session && (
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:underline">
            Chat
          </Link>
          <Link href="/approvals" className="hover:underline">
            Approvals
          </Link>
          <span className="text-muted">{session.email}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded border border-border px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10"
          >
            Log out
          </button>
        </div>
      )}
    </nav>
  )
}
