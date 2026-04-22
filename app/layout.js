import './globals.css'
import { Toaster } from '@/components/ui/sonner'

export const metadata = {
  title: 'AgentInvoice AI — Agentic Invoice Processing',
  description: 'Multi-agent invoice extraction with human-in-the-loop review, rule engine, and SAP Concur integration.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
