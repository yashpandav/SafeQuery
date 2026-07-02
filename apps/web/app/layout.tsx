import type { Metadata } from 'next'
import { TRPCReactProvider } from '../trpc/client'
import { SessionProvider } from '../lib/session'
import { Shell } from './shell'
import './globals.css'

export const metadata: Metadata = {
  title: 'SafeQuery',
  description: 'AI database governance — validate, route, and audit every query.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <TRPCReactProvider>
            <Shell>{children}</Shell>
          </TRPCReactProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
