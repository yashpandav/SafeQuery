'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useSession } from '../lib/session'

function IconChat() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px] flex-shrink-0">
      <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v6A1.5 1.5 0 0112.5 11H8l-3 3v-3H3.5A1.5 1.5 0 012 9.5v-6z" />
    </svg>
  )
}

function IconApprovals() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px] flex-shrink-0">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5.5 8l2 2 3-3" />
    </svg>
  )
}

function IconAudit() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-[15px] w-[15px] flex-shrink-0">
      <path d="M3 4h10M3 7.5h10M3 11h6" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px] flex-shrink-0">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1" />
    </svg>
  )
}

export function Sidebar() {
  const { session, setSession } = useSession()
  const pathname = usePathname()
  const router = useRouter()

  if (!session) return null

  const isAdmin = session.platformRole === 'admin' || session.platformRole === 'owner'

  const initials = session.email
    .split('@')[0]!
    .split(/[._\-+]/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('') || '?'

  const navItems = [
    { href: '/', label: 'Ask a question', Icon: IconChat },
    { href: '/approvals', label: 'Approvals', Icon: IconApprovals },
    { href: '/audit-log', label: 'Audit log', Icon: IconAudit },
    ...(isAdmin ? [{ href: '/admin', label: 'Workspace', Icon: IconSettings }] : []),
  ]

  return (
    <aside className="flex w-[188px] flex-shrink-0 flex-col border-r border-border bg-surface">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-ink text-[10px] font-bold tracking-tight text-white">
          SQ
        </div>
        <span className="text-sm font-semibold tracking-[-0.01em] text-ink">SafeQuery</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3" aria-label="Main">
        {navItems.map(({ href, label, Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                active
                  ? 'bg-black/[0.07] font-medium text-ink'
                  : 'text-muted hover:bg-black/[0.04] hover:text-ink'
              }`}
            >
              <Icon />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-neutral-bg text-[10px] font-semibold text-neutral">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink">{session.email}</p>
            <p className="text-[10px] text-muted capitalize">{session.platformRole}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setSession(null)
            router.push('/login')
          }}
          className="mt-1 w-full rounded-md px-2 py-1 text-left text-[11px] text-muted transition-colors hover:bg-black/[0.04] hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
