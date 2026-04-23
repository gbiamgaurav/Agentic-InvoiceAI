import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function buildSystemPrompt(invoices) {
  const invoiceSummaries = invoices.map(inv => {
    const items = inv.lineItems?.map(li =>
      `    - ${li.desc}: qty ${li.qty} × $${li.unit} = $${li.amount} (confidence: ${Math.round((li.conf || 0) * 100)}%)`
    ).join('\n') || ''
    return `
Invoice ID: ${inv.id}
  Vendor: ${inv.vendor} | ${inv.vendorAddress}
  Invoice #: ${inv.invoiceNumber}
  Dates: Issued ${inv.invoiceDate}, Due ${inv.dueDate}
  PO Number: ${inv.poNumber || 'MISSING'}
  Currency: ${inv.currency}
  Subtotal: ${inv.subtotal} | Tax: ${inv.tax} (${Math.round((inv.taxRate || 0) * 100)}%) | Total: ${inv.total}
  Status: ${inv.status}
  Confidence: ${Math.round((inv.confidence || 0) * 100)}%
  Assigned To: ${inv.assignedTo}
  ${inv.concurRef ? `Concur Ref: ${inv.concurRef}` : ''}
  Line Items:
${items}
  Notes: ${inv.notes || 'None'}`
  }).join('\n---\n')

  return `You are an intelligent invoice assistant for AgentInvoice AI, an agentic accounts-payable automation platform.

You have access to the following invoices currently in the system:

${invoiceSummaries}

Your job is to help the user understand, analyze, and act on their invoices. You can:
- Answer questions about specific invoices (amounts, vendors, dates, status, line items)
- Summarize the invoice portfolio (totals, pending counts, flagged items)
- Identify invoices that need attention (missing PO numbers, low confidence, high value, overdue)
- Explain rule violations or flags
- Suggest next actions (approve, reject, request more info)
- Calculate totals, comparisons, or breakdowns

Be concise and precise. Use numbers and invoice IDs when referencing specifics. If you don't know something from the provided data, say so — don't make up invoice details.`
}

export async function POST(request) {
  try {
    const { messages, invoices } = await request.json()

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY is not configured. Add it to .env.local and restart the server.' },
        { status: 503 }
      )
    }

    const systemPrompt = buildSystemPrompt(invoices || [])

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    })

    return NextResponse.json({ reply: response.content[0].text })
  } catch (err) {
    console.error('Chat API error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to get a response. Please try again.' },
      { status: 500 }
    )
  }
}
