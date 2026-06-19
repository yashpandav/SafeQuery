import { TRPCReactProvider } from '../trpc/client'
import { SessionProvider } from '../lib/session'
import { NavBar } from './nav-bar'
import './globals.css'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <TRPCReactProvider>
            <NavBar />
            <main className="mx-auto max-w-2xl p-6">{children}</main>
          </TRPCReactProvider>
        </SessionProvider>
      </body>
    </html>
  )
}