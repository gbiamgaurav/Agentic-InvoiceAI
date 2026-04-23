import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'

export const metadata = {
  title: 'AgentInvoice AI — Agentic Invoice Processing',
  description: 'Multi-agent invoice extraction with human-in-the-loop review, rule engine, and SAP Concur integration.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <ThemeProvider>
          {children}
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  )
}
