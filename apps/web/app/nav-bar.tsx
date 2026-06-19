'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from '../lib/session'
import { Button } from './components/button'

export function NavBar() {
  const { session, setSession } = useSession()
  const router = useRouter()

  function handleLogout() {
    setSession(null)
    router.push('/login')
  }

  return (
    <nav className="flex items-center justify-between border-b border-border bg-surface px-6 py-3" aria-label="Main navigation">
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
          <Link href="/audit-log" className="hover:underline">
            Audit log
          </Link>
          <span className="text-muted">{session.email}</span>
          <Button variant="secondary" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      )}
    </nav>
  )
}
