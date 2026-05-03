'use client'

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import {
  LayoutDashboard, Inbox, Bot, ShieldCheck, Send, Upload, FileText, Check, X,
  AlertTriangle, CheckCircle2, Clock, Loader2, Play, Edit3, Save,
  FileScan, Tag, List, Calculator, Building2, ChevronRight, Plus, Trash2,
  Activity, DollarSign, FileCheck2, Sparkles, PanelLeft, Search,
  ArrowUpRight, Zap, Eye, Copy, Download, Filter, GitBranch, Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { ThemeSwitcher } from '@/components/theme-switcher'

import { AGENT_DEFINITIONS, INITIAL_RULES, SAMPLE_INVOICES } from '@/lib/mockData'

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

const iconMap = { FileScan, Tag, List, Calculator, Building2, ShieldCheck, Send, Eye, GitBranch }

const fmtMoney = (n, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n || 0)

// Python's datetime.utcnow() serialises without 'Z', so JS parses it as local time.
// Append 'Z' when there's no timezone suffix so it's correctly treated as UTC.
const toUTC = (ts) => {
  if (!ts) return null
  if (typeof ts === 'string' && !ts.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(ts)) return ts + 'Z'
  return ts
}

const mapInvoice = (raw) => {
  const lineItems = raw.line_items ?? raw.lineItems ?? []
  const taxRate   = raw.tax_rate   ?? raw.taxRate ?? 0
  // Always recompute financials from line items so LLM extraction errors don't corrupt totals
  const subtotal  = lineItems.length
    ? Number(lineItems.reduce((s, li) => s + (Number(li.amount) || Number(li.qty) * Number(li.unit) || 0), 0).toFixed(2))
    : (raw.subtotal ?? 0)
  const tax   = Number((subtotal * taxRate).toFixed(2))
  const total = Number((subtotal + tax).toFixed(2))
  return {
    ...raw,
    invoiceNumber:  raw.invoice_number   ?? raw.invoiceNumber,
    lineItems,
    invoiceDate:    raw.invoice_date     ?? raw.invoiceDate,
    dueDate:        raw.due_date         ?? raw.dueDate,
    poNumber:       raw.po_number        ?? raw.poNumber,
    taxRate,
    subtotal,
    tax,
    total,
    billTo:         raw.bill_to          ?? raw.billTo,
    billToAddress:  raw.bill_to_address  ?? raw.billToAddress,
    vendorAddress:  raw.vendor_address   ?? raw.vendorAddress,
    concurRef:      raw.concur_ref       ?? raw.concurRef,
  }
}

const statusMeta = {
  processing:     { label: 'Processing',     cls: 'bg-blue-100 text-blue-700 border-blue-200',     Icon: Loader2 },
  needs_attention:{ label: 'Needs Attention',cls: 'bg-amber-100 text-amber-800 border-amber-200',  Icon: AlertTriangle },
  pending_review: { label: 'Pending Review', cls: 'bg-violet-100 text-violet-700 border-violet-200',Icon: Clock },
  approved:       { label: 'Approved',       cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  rejected:       { label: 'Rejected',       cls: 'bg-rose-100 text-rose-700 border-rose-200',      Icon: X },
  uploaded:       { label: 'Posted to Concur',cls: 'bg-teal-100 text-teal-700 border-teal-200',     Icon: Send },
  posted:         { label: 'Posted to Concur',cls: 'bg-teal-100 text-teal-700 border-teal-200',     Icon: Send },
  queued:         { label: 'Queued',          cls: 'bg-slate-100 text-slate-600 border-slate-200',   Icon: Clock },
}
const StatusBadge = ({ status }) => {
  const m = statusMeta[status] || statusMeta.pending_review
  const Ic = m.Icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>
      <Ic className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`} /> {m.label}
    </span>
  )
}

// ── SSE streaming hook ────────────────────────────────────────────────────────
/**
 * Connects to GET /api/v1/invoices/{id}/stream and maintains:
 *   nodeStatuses  — map of nodeId → 'idle'|'running'|'done'|'error'
 *   traces        — array of AgentTrace objects as they arrive
 *   interrupted   — interrupt payload when graph pauses for human review
 *   completed     — true when the graph finishes
 */
function useAgentStream(invoiceId, active) {
  const [nodeStatuses, setNodeStatuses] = useState({})
  const [traces, setTraces]             = useState([])
  const [interrupted, setInterrupted]   = useState(null)
  const [completed, setCompleted]       = useState(false)
  const esRef = useRef(null)

  const reset = useCallback(() => {
    setNodeStatuses({})
    setTraces([])
    setInterrupted(null)
    setCompleted(false)
  }, [])

  useEffect(() => {
    if (!invoiceId || !active) return
    reset()

    const es = new EventSource(`${BACKEND}/api/v1/invoices/${invoiceId}/stream`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        switch (msg.type) {
          case 'graph_start':
            break
          case 'node_start':
            setNodeStatuses(prev => ({ ...prev, [msg.node]: 'running' }))
            break
          case 'node_end':
            setNodeStatuses(prev => ({ ...prev, [msg.node]: msg.trace?.status === 'error' ? 'error' : 'done' }))
            if (msg.trace) setTraces(prev => [...prev, msg.trace])
            break
          case 'interrupted':
            setInterrupted(msg)
            setNodeStatuses(prev => ({ ...prev, human_review: 'running' }))
            es.close()
            break
          case 'completed':
            setCompleted(true)
            setNodeStatuses(prev => ({ ...prev, concur_publisher: 'done' }))
            es.close()
            break
          case 'error':
            toast.error('Pipeline error', { description: msg.message })
            es.close()
            break
        }
      } catch (_) {}
    }

    es.onerror = () => {
      es.close()
    }

    return () => { es.close() }
  }, [invoiceId, active, reset])

  const reconnect = useCallback(() => {
    if (esRef.current) esRef.current.close()
    reset()
    if (!invoiceId) return
    const es = new EventSource(`${BACKEND}/api/v1/invoices/${invoiceId}/stream`)
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        switch (msg.type) {
          case 'node_start':
            setNodeStatuses(prev => ({ ...prev, [msg.node]: 'running' }))
            break
          case 'node_end':
            setNodeStatuses(prev => ({ ...prev, [msg.node]: msg.trace?.status === 'error' ? 'error' : 'done' }))
            if (msg.trace) setTraces(prev => [...prev, msg.trace])
            break
          case 'interrupted':
            setInterrupted(msg)
            setNodeStatuses(prev => ({ ...prev, human_review: 'running' }))
            es.close()
            break
          case 'completed':
            setCompleted(true)
            es.close()
            break
        }
      } catch (_) {}
    }
    es.onerror = () => es.close()
  }, [invoiceId, reset])

  return { nodeStatuses, traces, interrupted, completed, reconnect }
}

// ── Human Review Modal ────────────────────────────────────────────────────────
function HumanReviewModal({ open, interrupt, invoiceId, onDecision }) {
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  // Use interrupt payload if available; fall back to empty so modal still renders
  const payload = interrupt || { violations: [], confidence: null }
  if (!open) return null

  const violations = payload.violations || []
  const errors = violations.filter(v => v.severity === 'error')
  const warnings = violations.filter(v => v.severity === 'warning')

  const submit = async (decision) => {
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND}/api/v1/invoices/${invoiceId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reviewed_by: 'human', notes }),
      })
      if (!res.ok) throw new Error(await res.text())
      onDecision(decision, notes)
      toast.success(decision === 'approved' ? 'Invoice approved — resuming pipeline' : 'Invoice rejected')
    } catch (e) {
      toast.error('Review submission failed', { description: String(e) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-orange-500" /> Human Review Required
          </DialogTitle>
          <DialogDescription>
            LangGraph has paused at the <code className="bg-muted px-1 rounded text-xs">human_review</code> node.
            {payload.confidence != null && <>Confidence: <strong>{(payload.confidence * 100).toFixed(0)}%</strong></>}
          </DialogDescription>
        </DialogHeader>

        {violations.length > 0 && (
          <div className="space-y-2">
            {errors.map((v, i) => (
              <div key={i} className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
                <AlertTriangle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                <div>
                  <Badge variant="destructive" className="text-[10px] mb-1">error</Badge>
                  <p className="text-xs">{v.message}</p>
                </div>
              </div>
            ))}
            {warnings.map((v, i) => (
              <div key={i} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <Badge variant="secondary" className="text-[10px] mb-1">warning</Badge>
                  <p className="text-xs">{v.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <Label className="text-xs">Review notes (optional)</Label>
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add notes for the audit trail…"
            className="mt-1 text-sm"
            rows={2}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => submit('rejected')}
            disabled={loading}
            className="text-rose-600 border-rose-200 hover:bg-rose-50"
          >
            <X className="h-3.5 w-3.5 mr-1" /> Reject
          </Button>
          <Button
            onClick={() => submit('approved')}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
            Approve & Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Parallel-aware Agent Pipeline ─────────────────────────────────────────────
/**
 * Renders the LangGraph topology:
 *   Ingestion
 *   ┌─ Header Extractor ─┐  (parallel)
 *   └─ Line-Item Agent   ┘
 *   Tax Validator → Vendor Matcher → Rule Engine → Human Review → Concur
 */
function AgentPipeline({ nodeStatuses, onRun, running, streamActive }) {
  const parallelGroup = AGENT_DEFINITIONS.filter(a => a.parallel)
  const sequential = AGENT_DEFINITIONS.filter(a => !a.parallel)

  const nodeCard = (a) => {
    const status = nodeStatuses[a.id] || 'idle'
    const Ic = iconMap[a.icon] || Bot
    return (
      <div
        key={a.id}
        className={`flex items-center gap-3 rounded-lg border p-2.5 bg-card transition-all ${
          status === 'running' ? 'border-blue-400 shadow-sm shadow-blue-100' :
          status === 'done'    ? 'border-emerald-300' :
          status === 'error'   ? 'border-rose-300' : ''
        }`}
      >
        <div className={`h-8 w-8 rounded-md ${a.color} flex items-center justify-center text-white shrink-0`}>
          <Ic className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium truncate">{a.name}</p>
            {a.isHumanNode && <Badge variant="outline" className="text-[9px] h-4 px-1">interrupt</Badge>}
          </div>
          <p className="text-[10px] text-muted-foreground truncate">{a.role}</p>
        </div>
        <div className="shrink-0">
          {status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
          {status === 'done'    && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          {status === 'error'   && <AlertTriangle className="h-4 w-4 text-rose-500" />}
          {status === 'idle'    && <span className="text-[10px] text-muted-foreground">idle</span>}
        </div>
      </div>
    )
  }

  // Build ordered render list with a "parallel" row
  const ingestion = AGENT_DEFINITIONS.find(a => a.id === 'ingestion')
  const tail      = sequential.filter(a => a.id !== 'ingestion')

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> LangGraph Pipeline
            </CardTitle>
            <CardDescription className="text-xs">
              Parallel fan-out after ingestion · human-in-the-loop interrupt
            </CardDescription>
          </div>
          {!streamActive && (
            <Button size="sm" onClick={onRun} disabled={running} className="gap-1.5 h-8">
              {running
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running...</>
                : <><Play className="h-3.5 w-3.5" /> Re-run</>}
            </Button>
          )}
          {streamActive && (
            <Badge variant="outline" className="text-blue-600 border-blue-300 gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" /> Live
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {/* Sequential: ingestion */}
        {ingestion && nodeCard(ingestion)}

        {/* Diverging arrows indicator */}
        <div className="flex items-center gap-1 px-1 py-0.5">
          <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
          <span className="text-[9px] text-muted-foreground px-1">parallel fan-out</span>
          <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
        </div>

        {/* Parallel row */}
        <div className="grid grid-cols-2 gap-1.5">
          {parallelGroup.sort((a, b) => a.lane - b.lane).map(nodeCard)}
        </div>

        {/* Fan-in indicator */}
        <div className="flex items-center gap-1 px-1 py-0.5">
          <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
          <span className="text-[9px] text-muted-foreground px-1">fan-in → sequential</span>
          <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
        </div>

        {/* Sequential tail */}
        {tail.map(nodeCard)}
      </CardContent>
    </Card>
  )
}

function Sidebar({ view, setView, counts }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard',      icon: LayoutDashboard },
    { id: 'queue',     label: 'Invoice Queue',  icon: Inbox, badge: counts.queue },
    { id: 'agents',    label: 'Agents',         icon: Bot },
    { id: 'rules',     label: 'Rule Engine',    icon: ShieldCheck },
    { id: 'concur',    label: 'SAP Concur',     icon: Send },
  ]
  return (
    <aside className="hidden md:flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 py-4 border-b">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="font-semibold tracking-tight text-sm">AgentInvoice AI</div>
          <div className="text-[10px] text-muted-foreground">LangGraph · multi-agent AP</div>
        </div>
      </div>
      <nav className="flex-1 p-2">
        {items.map(it => {
          const Ic = it.icon
          const active = view === it.id
          return (
            <button key={it.id} onClick={() => setView(it.id)}
              className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm mb-0.5 transition ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'hover:bg-sidebar-accent/60 text-sidebar-foreground/80'}`}>
              <Ic className="h-4 w-4" /> <span className="flex-1 text-left">{it.label}</span>
              {it.badge ? <Badge variant="secondary" className="h-5 px-1.5">{it.badge}</Badge> : null}
            </button>
          )
        })}
      </nav>
      <div className="p-3 border-t">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs font-medium mb-1 flex items-center gap-1">
            <GitBranch className="h-3 w-3 text-indigo-500" /> LangGraph
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Parallel agents · MongoDB checkpointing · human-in-the-loop interrupt
          </p>
        </div>
      </div>
    </aside>
  )
}

function Topbar({ view, onUpload }) {
  const titles = {
    dashboard: 'Dashboard', queue: 'Invoice Queue', detail: 'Invoice Review',
    agents: 'Agents', rules: 'Rule Engine', concur: 'SAP Concur Integration',
  }
  return (
    <header className="flex items-center justify-between border-b px-6 py-3 bg-background/80 backdrop-blur">
      <div className="flex items-center gap-3">
        <PanelLeft className="h-4 w-4 text-muted-foreground md:hidden" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{titles[view] || 'AgentInvoice AI'}</h1>
          <p className="text-xs text-muted-foreground">
            LangGraph orchestration · parallel agents · human-in-the-loop
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative hidden sm:block">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input placeholder="Search invoices..." className="pl-8 h-9 w-64" />
        </div>
        <Button onClick={onUpload} size="sm" className="gap-1.5">
          <Upload className="h-4 w-4" /> Upload Invoice
        </Button>
        <ThemeSwitcher />
        <Avatar className="h-8 w-8"><AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs">PR</AvatarFallback></Avatar>
      </div>
    </header>
  )
}

// Default fallback data sets used when the backend has no real records yet
const FALLBACK_THROUGHPUT = {
  daily:   ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((l,i) => ({ label: l, processed: [18,24,31,22,29,8,5][i],  approved: [14,20,26,18,25,7,4][i]  })),
  weekly:  ['Wk1','Wk2','Wk3','Wk4','Wk5','Wk6','Wk7','Wk8'].map((l,i) => ({ label: l, processed: [62,78,91,55,84,70,43,99][i], approved: [50,64,78,44,71,58,35,83][i] })),
  monthly: ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'].map((l,i) => ({ label: l, processed: [120,145,160,138,175,90,65,155,180,200,168,210][i], approved: [98,120,135,112,150,74,51,130,155,170,141,178][i] })),
}

const PERIOD_META = {
  daily:   { label: 'Daily',   sub: 'Last 7 days',    badge: 'Last 7 days'   },
  weekly:  { label: 'Weekly',  sub: 'Last 8 weeks',   badge: 'Last 8 weeks'  },
  monthly: { label: 'Monthly', sub: 'Last 12 months', badge: 'Last 12 months' },
}

function Dashboard({ invoices, setView, setSelectedId }) {
  const kpis = useMemo(() => {
    const total = invoices.length
    const approved = invoices.filter(i => ['approved','uploaded','posted'].includes(i.status)).length
    const pending = invoices.filter(i => ['pending_review','needs_attention'].includes(i.status)).length
    const processing = invoices.filter(i => i.status === 'processing').length
    const value = invoices.reduce((s, i) => s + (i.total || 0), 0)
    const confs = invoices.filter(i => i.confidence > 0)
    const avgConf = confs.length ? confs.reduce((s, i) => s + i.confidence, 0) / confs.length : 0
    const autoRate = (approved / Math.max(1, total)) * 100
    return { total, approved, pending, processing, value, avgConf, autoRate }
  }, [invoices])

  const [period, setPeriod]           = useState('weekly')
  const [throughputData, setThroughputData] = useState(FALLBACK_THROUGHPUT.weekly)
  const [chartLoading, setChartLoading]     = useState(false)

  useEffect(() => {
    setChartLoading(true)
    fetch(`${BACKEND}/api/v1/analytics/throughput?period=${period}`)
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (!res?.data) return
        // If backend has real data use it, otherwise keep fallback
        const hasRealData = res.data.some(d => d.processed > 0)
        setThroughputData(hasRealData ? res.data : FALLBACK_THROUGHPUT[period])
      })
      .catch(() => setThroughputData(FALLBACK_THROUGHPUT[period]))
      .finally(() => setChartLoading(false))
  }, [period])

  const statusData = [
    { name: 'Approved', value: kpis.approved, color: '#10b981' },
    { name: 'Pending',  value: kpis.pending,  color: '#8b5cf6' },
    { name: 'Processing', value: kpis.processing, color: '#3b82f6' },
    { name: 'Rejected', value: invoices.filter(i => i.status === 'rejected').length, color: '#f43f5e' },
  ]

  const trendData = useMemo(() => {
    const byMonth = {}
    invoices.forEach(inv => {
      const date = new Date(toUTC(inv.received_at || inv.receivedAt))
      if (isNaN(date.getTime())) return
      const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`
      const label = date.toLocaleString('en-US', { month: 'short' })
      if (!byMonth[key]) byMonth[key] = { m: label, count: 0, sum: 0 }
      byMonth[key].count++
      if (inv.confidence > 0) byMonth[key].sum += inv.confidence
    })
    const months = Object.keys(byMonth).sort().slice(-12)
    if (!months.length) return Array.from({ length: 12 }).map((_, i) => ({
      m: ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'][i],
      acc: Number((74 + Math.sin(i) * 4 + i).toFixed(1)),
    }))
    return months.map(k => ({
      m: byMonth[k].m,
      acc: byMonth[k].sum > 0 ? Number((byMonth[k].sum / byMonth[k].count * 100).toFixed(1)) : 0,
    }))
  }, [invoices])

  const timeAgo = (ts) => {
    const diff = Date.now() - new Date(toUTC(ts)).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }

  const recentActivity = useMemo(() => {
    const events = []
    invoices.forEach(inv => {
      const num = inv.invoiceNumber || (inv.id?.slice(0, 8) ?? '?')
      if (inv.received_at || inv.receivedAt) {
        events.push({ who: 'Ingestion Agent', what: `processed ${num} from ${inv.vendor || 'unknown vendor'}`, ts: toUTC(inv.received_at || inv.receivedAt), color: 'bg-indigo-500' })
      }
      if (inv.reviewed_at || inv.reviewedAt) {
        const dec = inv.review_decision || inv.reviewDecision || ''
        const who = inv.reviewed_by || inv.reviewedBy || 'Reviewer'
        events.push({ who, what: `${dec === 'rejected' ? 'rejected' : 'approved'} ${num}`, ts: toUTC(inv.reviewed_at || inv.reviewedAt), color: dec === 'rejected' ? 'bg-rose-500' : 'bg-emerald-500' })
      }
      if (['posted', 'uploaded'].includes(inv.status) && (inv.processed_at || inv.processedAt)) {
        events.push({ who: 'SAP Concur', what: `posted ${num}${inv.concurRef ? ` → ${inv.concurRef}` : ''}`, ts: toUTC(inv.processed_at || inv.processedAt), color: 'bg-teal-500' })
      }
    })
    return events
      .filter(e => e.ts && !isNaN(new Date(e.ts).getTime()))
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 5)
  }, [invoices])

  const now = Date.now()
  const oneWeek = 7 * 24 * 60 * 60 * 1000
  const thisWeekCount = invoices.filter(i => { const d = new Date(toUTC(i.received_at || i.receivedAt)); return !isNaN(d) && now - d.getTime() < oneWeek }).length
  const lastWeekCount = invoices.filter(i => { const d = new Date(toUTC(i.received_at || i.receivedAt)); const age = now - d.getTime(); return !isNaN(d) && age >= oneWeek && age < 2 * oneWeek }).length
  const weekChangeSub = lastWeekCount > 0
    ? `${thisWeekCount >= lastWeekCount ? '+' : ''}${((thisWeekCount - lastWeekCount) / lastWeekCount * 100).toFixed(1)}% vs last week`
    : thisWeekCount > 0 ? 'New this week' : 'No invoices yet'

  const kpiCards = [
    { label: 'Invoices Processed',   value: kpis.total,                             sub: weekChangeSub,                                                     Icon: FileCheck2, color: 'from-indigo-500 to-violet-600' },
    { label: 'Total AP Value',        value: fmtMoney(kpis.value),                  sub: `${new Set(invoices.map(i => i.vendor).filter(Boolean)).size} unique vendors`, Icon: DollarSign, color: 'from-emerald-500 to-teal-600' },
    { label: 'Straight-Through Rate', value: `${kpis.autoRate.toFixed(0)}%`,        sub: `${kpis.approved} auto-approved`,                                   Icon: Zap,        color: 'from-amber-500 to-orange-600' },
    { label: 'Avg. Confidence',       value: `${(kpis.avgConf * 100).toFixed(1)}%`, sub: `${invoices.filter(i => i.confidence > 0).length} invoices scored`, Icon: Activity,   color: 'from-rose-500 to-pink-600' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map(k => {
          const Ic = k.Icon
          return (
            <Card key={k.label} className="overflow-hidden relative">
              <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${k.color}`} />
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{k.label}</p>
                    <p className="text-2xl font-semibold mt-1 tracking-tight">{k.value}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{k.sub}</p>
                  </div>
                  <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${k.color} flex items-center justify-center shadow-sm`}>
                    <Ic className="h-5 w-5 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  {PERIOD_META[period].label} throughput
                  {chartLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </CardTitle>
                <CardDescription className="text-xs">Processed vs auto-approved invoices</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-md border overflow-hidden">
                  {['daily','weekly','monthly'].map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-3 py-1 text-xs capitalize transition ${
                        period === p
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <Badge variant="outline">{PERIOD_META[period].badge}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={throughputData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" fontSize={11} stroke="#6b7280" />
                <YAxis fontSize={11} stroke="#6b7280" />
                <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="processed" fill="#6366f1" radius={[6,6,0,0]} name="Processed" />
                <Bar dataKey="approved"  fill="#10b981" radius={[6,6,0,0]} name="Approved" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Status breakdown</CardTitle>
            <CardDescription className="text-xs">Live queue distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2}>
                  {statusData.map((e,i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Extraction accuracy trend</CardTitle>
                <CardDescription className="text-xs">Model-level confidence over time</CardDescription>
              </div>
              <Badge variant="outline">12 months</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="m" fontSize={11} stroke="#6b7280" />
                <YAxis fontSize={11} stroke="#6b7280" domain={[70, 100]} />
                <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="acc" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription className="text-xs">Agent & human actions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {recentActivity.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No activity yet. Upload an invoice to get started.</p>
            )}
            {recentActivity.map((a, i) => (
              <div key={i} className="flex gap-3">
                <div className={`h-2 w-2 rounded-full mt-1.5 ${a.color}`} />
                <div className="flex-1">
                  <p><span className="font-medium">{a.who}</span> <span className="text-muted-foreground">{a.what}</span></p>
                  <p className="text-[11px] text-muted-foreground">{timeAgo(a.ts)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Needs your attention</CardTitle>
            <CardDescription className="text-xs">Human-in-the-loop queue</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setView('queue')}>
            Open queue <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead><TableHead>Vendor</TableHead><TableHead>Amount</TableHead>
                <TableHead>Confidence</TableHead><TableHead>Status</TableHead><TableHead>Assignee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.filter(i => ['pending_review','needs_attention','processing'].includes(i.status)).slice(0,5).map(inv => (
                <TableRow key={inv.id} className="cursor-pointer" onClick={() => { setSelectedId(inv.id); setView('detail') }}>
                  <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                  <TableCell>{inv.vendor}</TableCell>
                  <TableCell>{fmtMoney(inv.total, inv.currency)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={inv.confidence * 100} className="h-1.5 w-20" />
                      <span className="text-xs text-muted-foreground">{(inv.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge status={inv.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{inv.assignedTo}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function InvoiceQueue({ invoices, onSelect, onDelete }) {
  const [filter, setFilter] = useState('all')
  const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter)
  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">All invoices</CardTitle>
            <CardDescription className="text-xs">{filtered.length} invoices · click to open side-by-side review</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="pending_review">Pending Review</SelectItem>
                <SelectItem value="needs_attention">Needs Attention</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="posted">Posted to Concur</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead><TableHead>Vendor</TableHead><TableHead>Date</TableHead>
                <TableHead>Amount</TableHead><TableHead>Confidence</TableHead>
                <TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(inv => (
                <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onSelect(inv.id)}>
                  <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                  <TableCell>{inv.vendor}</TableCell>
                  <TableCell className="text-muted-foreground">{inv.invoiceDate}</TableCell>
                  <TableCell>{fmtMoney(inv.total, inv.currency)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={inv.confidence * 100} className="h-1.5 w-20" />
                      <span className="text-xs text-muted-foreground">{(inv.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge status={inv.status} /></TableCell>
                  <TableCell className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7"><Eye className="h-3.5 w-3.5 mr-1" /> Review</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-rose-600 hover:bg-rose-50"
                      onClick={e => { e.stopPropagation(); if (confirm(`Delete ${inv.invoiceNumber || inv.id}?`)) onDelete(inv.id) }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function FakePDFPage({ invoice }) {
  return (
    <div className="bg-white text-slate-900 shadow-xl rounded-md border mx-auto my-4 w-full max-w-[640px] p-10 font-serif" style={{ minHeight: 820 }}>
      <div className="flex justify-between items-start border-b pb-4 mb-6">
        <div>
          <div className="h-10 w-28 bg-gradient-to-br from-slate-800 to-slate-600 rounded flex items-center justify-center text-white font-sans text-xs tracking-widest text-center px-2">
            {invoice.vendor ? invoice.vendor.toUpperCase() : 'VENDOR'}
          </div>
          <p className="text-[11px] text-slate-500 mt-2 font-sans">{invoice.vendorAddress}</p>
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold tracking-wider text-slate-700">INVOICE</h2>
          <p className="text-xs text-slate-500 font-sans"># {invoice.invoiceNumber}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs font-sans mb-6">
        <div>
          <p className="text-slate-500 uppercase tracking-wider mb-1">Bill To</p>
          <p className="font-semibold">{invoice.billTo || '—'}</p>
          {invoice.billToAddress && <p className="text-slate-600">{invoice.billToAddress}</p>}
        </div>
        <div className="text-right">
          <p className="text-slate-500 uppercase tracking-wider mb-1">Invoice Date</p>
          <p className="font-semibold">{invoice.invoiceDate}</p>
          <p className="text-slate-500 uppercase tracking-wider mb-1 mt-2">Due Date</p>
          <p className="font-semibold">{invoice.dueDate}</p>
          {invoice.poNumber && (<><p className="text-slate-500 uppercase tracking-wider mb-1 mt-2">PO Number</p><p className="font-semibold">{invoice.poNumber}</p></>)}
        </div>
      </div>
      <table className="w-full text-xs font-sans mb-6">
        <thead>
          <tr className="border-y bg-slate-50">
            <th className="text-left py-2 px-2 font-semibold text-slate-600">Description</th>
            <th className="text-right py-2 px-2 font-semibold text-slate-600">Qty</th>
            <th className="text-right py-2 px-2 font-semibold text-slate-600">Unit</th>
            <th className="text-right py-2 px-2 font-semibold text-slate-600">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(invoice.lineItems || []).map((li, i) => (
            <tr key={i} className="border-b">
              <td className="py-2 px-2">{li.desc}</td>
              <td className="py-2 px-2 text-right">{li.qty}</td>
              <td className="py-2 px-2 text-right">{fmtMoney(li.unit, invoice.currency)}</td>
              <td className="py-2 px-2 text-right font-medium">{fmtMoney(li.amount, invoice.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end text-xs font-sans">
        <div className="w-64 space-y-1.5">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{fmtMoney(invoice.subtotal, invoice.currency)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Tax ({((invoice.taxRate||0)*100).toFixed(0)}%)</span><span>{fmtMoney(invoice.tax, invoice.currency)}</span></div>
          <Separator />
          <div className="flex justify-between font-bold text-sm pt-1"><span>Total Due</span><span>{fmtMoney(invoice.total, invoice.currency)}</span></div>
        </div>
      </div>
      {invoice.notes && (<div className="mt-10 pt-4 border-t text-xs font-sans text-slate-500"><p className="font-semibold mb-1">Notes</p><p>{invoice.notes}</p></div>)}
      <p className="mt-16 text-center text-[10px] text-slate-400 font-sans">Thank you for your business.</p>
    </div>
  )
}

function Field({ label, value, onChange, edit, readOnly, placeholder, highlight }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {edit && !readOnly ? (
        <Input value={value || ''} onChange={e => onChange && onChange(e.target.value)} placeholder={placeholder} className="h-8 mt-1 text-sm" />
      ) : (
        <div className={`mt-1 text-sm font-medium ${highlight ? 'text-base font-semibold' : ''} ${!value ? 'text-muted-foreground italic' : ''}`}>{value || placeholder || '—'}</div>
      )}
    </div>
  )
}

function ConcurPostDialog({ invoice, open, onOpenChange, onConfirm }) {
  const [confirmed, setConfirmed] = useState(false)
  const [posting, setPosting]     = useState(false)

  useEffect(() => { if (open) setConfirmed(false) }, [open])

  const handlePost = async () => {
    setPosting(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (_) {
    } finally {
      setPosting(false)
    }
  }

  if (!invoice) return null
  return (
    <Dialog open={open} onOpenChange={v => { if (!posting) onOpenChange(v) }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-teal-500" /> Post to SAP Concur
          </DialogTitle>
          <DialogDescription>
            Review all details carefully before submitting. Once posted, this invoice will be recorded in SAP Concur.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Vendor',        invoice.vendor],
                ['Bill To',       invoice.billTo],
                ['Invoice #',     invoice.invoiceNumber],
                ['Invoice Date',  invoice.invoiceDate],
                ['Due Date',      invoice.dueDate],
                ['Currency',      invoice.currency || 'USD'],
              ].map(([label, val]) => (
                <div key={label}>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="font-medium">{val || '—'}</p>
                </div>
              ))}
            </div>

            {(invoice.lineItems || []).length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Line Items</p>
                <div className="space-y-1">
                  {invoice.lineItems.map((li, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-muted-foreground truncate flex-1 mr-2">{li.desc}</span>
                      <span className="font-medium whitespace-nowrap">{fmtMoney(li.amount, invoice.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />
            <div className="flex justify-between items-center font-semibold">
              <span>Total Amount</span>
              <span className="text-base">{fmtMoney(invoice.total, invoice.currency)}</span>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <input
              type="checkbox" id="concur-confirm"
              checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-teal-600"
            />
            <label htmlFor="concur-confirm" className="text-sm cursor-pointer leading-snug">
              I confirm all invoice details above are correct and authorise posting this invoice to SAP Concur.
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={posting}>Cancel</Button>
          <Button
            disabled={!confirmed || posting} onClick={handlePost}
            className="bg-teal-600 hover:bg-teal-700 gap-1.5"
          >
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Post to SAP Concur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InvoiceDetail({
  invoice, onBack, onUpdate, onDelete, rules, violations,
  nodeStatuses, traces, interrupted, streamActive,
  onReviewDecision, onPostToConcur,
}) {
  const [edit, setEdit]         = useState(false)
  const [local, setLocal]       = useState(invoice)
  const [reviewOpen, setReviewOpen]   = useState(false)
  const [concurOpen, setConcurOpen]   = useState(false)
  const [deleting, setDeleting]       = useState(false)
  useEffect(() => setLocal(invoice), [invoice])

  const handleDelete = async () => {
    if (!confirm(`Delete invoice ${invoice.invoiceNumber || invoice.id}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`${BACKEND}/api/v1/invoices/${invoice.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      onDelete(invoice.id)
    } catch (e) {
      toast.error('Delete failed', { description: String(e) })
      setDeleting(false)
    }
  }

  // Auto-open review modal when graph is interrupted
  useEffect(() => {
    if (interrupted) setReviewOpen(true)
  }, [interrupted])

  const change = (k, v) => setLocal(p => ({ ...p, [k]: v }))
  const changeLine = (i, k, v) => setLocal(p => ({ ...p, lineItems: p.lineItems.map((li,idx) => idx === i ? { ...li, [k]: v } : li) }))
  const save = () => {
    const li = local.lineItems.map(l => ({ ...l, amount: Number(l.qty) * Number(l.unit) }))
    const subtotal = li.reduce((s,x) => s + x.amount, 0)
    const tax = Number((subtotal * local.taxRate).toFixed(2))
    const total = Number((subtotal + tax).toFixed(2))
    onUpdate({ ...local, lineItems: li, subtotal, tax, total })
    setEdit(false)
    toast.success('Invoice updated', { description: 'Your edits have been saved.' })
  }

  const handleDecision = (decision, notes) => {
    setReviewOpen(false)
    onReviewDecision(decision, notes)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      <HumanReviewModal
        open={reviewOpen}
        interrupt={interrupted}
        invoiceId={invoice.id}
        onDecision={handleDecision}
      />
      <ConcurPostDialog
        invoice={invoice}
        open={concurOpen}
        onOpenChange={setConcurOpen}
        onConfirm={async () => {
          await onPostToConcur(invoice.id)
        }}
      />

      <div className="flex items-center justify-between px-6 py-3 border-b bg-background">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={onBack} className="h-8"><ChevronRight className="h-4 w-4 rotate-180" /> Back</Button>
          <Separator orientation="vertical" className="h-5" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{invoice.invoiceNumber}</h2>
              <StatusBadge status={invoice.status} />
              {(interrupted || invoice.status === 'pending_review') && (
                <Badge variant="outline" className="text-orange-600 border-orange-300 gap-1 text-[10px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" /> Awaiting review
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{invoice.vendor} · {fmtMoney(invoice.total, invoice.currency)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(interrupted || invoice.status === 'pending_review') && (
            <Button size="sm" onClick={() => setReviewOpen(true)} className="gap-1.5 bg-orange-500 hover:bg-orange-600">
              <Users className="h-3.5 w-3.5" /> Review Now
            </Button>
          )}
          {invoice.status === 'approved' && (
            <Button size="sm" onClick={() => setConcurOpen(true)} className="gap-1.5 bg-teal-600 hover:bg-teal-700">
              <Send className="h-3.5 w-3.5" /> Post to SAP Concur
            </Button>
          )}
          {edit ? (
            <><Button size="sm" variant="outline" onClick={() => { setLocal(invoice); setEdit(false) }}>Cancel</Button>
            <Button size="sm" onClick={save} className="gap-1.5"><Save className="h-3.5 w-3.5" /> Save edits</Button></>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEdit(true)} className="gap-1.5"><Edit3 className="h-3.5 w-3.5" /> Edit fields</Button>
          )}
          <Button
            size="sm" variant="outline" onClick={handleDelete} disabled={deleting}
            className="gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
        <div className="bg-slate-100 overflow-y-auto border-r">
          <div className="flex items-center justify-between sticky top-0 bg-slate-100/90 backdrop-blur px-4 py-2 border-b text-xs text-slate-600 z-10">
            <div className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> original_invoice.pdf · Page 1 of 1</div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7"><Download className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7"><Copy className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          <FakePDFPage invoice={invoice} />
        </div>

        <div className="overflow-y-auto">
          <Tabs defaultValue="extracted" className="h-full flex flex-col">
            <TabsList className="mx-4 mt-4 grid w-[calc(100%-2rem)] grid-cols-3">
              <TabsTrigger value="extracted">Extracted data</TabsTrigger>
              <TabsTrigger value="agents">
                LangGraph
                {streamActive && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />}
              </TabsTrigger>
              <TabsTrigger value="rules">Rules ({violations.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="extracted" className="p-4 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Header</CardTitle>
                    <Badge variant="secondary" className="text-[10px]">confidence {(invoice.confidence*100).toFixed(0)}%</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <Field label="Vendor"       value={local.vendor}        onChange={v => change('vendor', v)}        edit={edit} />
                  <Field label="Invoice #"    value={local.invoiceNumber} onChange={v => change('invoiceNumber', v)} edit={edit} />
                  <Field label="Invoice Date" value={local.invoiceDate}   onChange={v => change('invoiceDate', v)}   edit={edit} />
                  <Field label="Due Date"     value={local.dueDate}       onChange={v => change('dueDate', v)}       edit={edit} />
                  <Field label="PO Number"    value={local.poNumber}      onChange={v => change('poNumber', v)}      edit={edit} placeholder="(missing)" />
                  <Field label="Currency"     value={local.currency}      onChange={v => change('currency', v)}      edit={edit} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Line items</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Description</TableHead><TableHead className="w-16 text-right">Qty</TableHead><TableHead className="w-24 text-right">Unit</TableHead><TableHead className="w-24 text-right">Amount</TableHead><TableHead className="w-14">Conf</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {(local.lineItems || []).map((li, i) => (
                        <TableRow key={i}>
                          <TableCell>{edit ? <Input value={li.desc} onChange={e => changeLine(i,'desc',e.target.value)} className="h-7 text-xs" /> : <span className="text-sm">{li.desc}</span>}</TableCell>
                          <TableCell className="text-right">{edit ? <Input type="number" value={li.qty} onChange={e => changeLine(i,'qty',Number(e.target.value))} className="h-7 text-xs text-right" /> : li.qty}</TableCell>
                          <TableCell className="text-right">{edit ? <Input type="number" value={li.unit} onChange={e => changeLine(i,'unit',Number(e.target.value))} className="h-7 text-xs text-right" /> : fmtMoney(li.unit, local.currency)}</TableCell>
                          <TableCell className="text-right font-medium">{fmtMoney(Number(li.qty)*Number(li.unit), local.currency)}</TableCell>
                          <TableCell><span className={`text-[10px] font-mono ${li.conf < 0.8 ? 'text-amber-600' : 'text-emerald-600'}`}>{(li.conf*100).toFixed(0)}%</span></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Totals</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-3 gap-3">
                  <Field label="Subtotal" value={fmtMoney(local.subtotal, local.currency)} readOnly />
                  <Field label={`Tax (${((local.taxRate||0)*100).toFixed(0)}%)`} value={fmtMoney(local.tax, local.currency)} readOnly />
                  <Field label="Total" value={fmtMoney(local.total, local.currency)} readOnly highlight />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="agents" className="p-4 space-y-4">
              <AgentPipeline
                nodeStatuses={nodeStatuses}
                onRun={() => {}}
                running={streamActive}
                streamActive={streamActive}
              />
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4" /> Execution trace
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-52 pr-3">
                    <div className="space-y-2 font-mono text-[11px]">
                      {traces.map((t, i) => (
                        <div key={i} className="border-l-2 border-indigo-400 pl-3 py-1">
                          <div className="flex justify-between">
                            <span className="font-semibold text-indigo-700">{t.agent}</span>
                            <span className={`text-muted-foreground ${t.status === 'error' ? 'text-rose-600' : ''}`}>{t.status} · {t.duration_ms}ms</span>
                          </div>
                          {t.log && <pre className="text-muted-foreground whitespace-pre-wrap mt-0.5">{t.log}</pre>}
                        </div>
                      ))}
                      {traces.length === 0 && (
                        <p className="text-muted-foreground text-center py-4">
                          {streamActive ? 'Waiting for first node…' : 'No execution trace yet.'}
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="rules" className="p-4 space-y-3">
              {violations.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-sm text-muted-foreground"><CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" /> All rules passed. Ready for approval.</CardContent></Card>
              ) : violations.map(v => (
                <Card key={v.id} className={v.severity === 'error' ? 'border-rose-200' : 'border-amber-200'}>
                  <CardContent className="p-4 flex gap-3">
                    <AlertTriangle className={`h-5 w-5 mt-0.5 ${v.severity === 'error' ? 'text-rose-600' : 'text-amber-600'}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2"><p className="font-medium text-sm">{v.name}</p><Badge variant={v.severity === 'error' ? 'destructive' : 'secondary'} className="text-[10px]">{v.severity}</Badge></div>
                      <p className="text-xs text-muted-foreground mt-1 font-mono">{v.expression}</p>
                      <p className="text-xs mt-2">{v.message}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Active rules ({rules.filter(r => r.enabled).length})</CardTitle></CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  {rules.filter(r => r.enabled).map(r => (
                    <div key={r.id} className="flex items-center gap-2 py-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="flex-1">{r.name}</span>
                      <Badge variant="outline" className="text-[9px]">{r.severity}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}

function AgentsView() {
  return (
    <div className="p-6 space-y-6">
      {/* Graph topology card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-indigo-500" /> LangGraph Topology
          </CardTitle>
          <CardDescription className="text-xs">
            Ingestion feeds a parallel fan-out (Header Extractor + Line-Item run concurrently),
            then fans back into the sequential tail. The Human Review node uses LangGraph
            <code className="bg-muted mx-1 px-1 rounded">interrupt()</code> to pause
            for low-confidence or rule-violation cases.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-muted/30 p-4 font-mono text-[11px] text-muted-foreground leading-relaxed">
            <div>START → <span className="text-sky-600">ingestion</span></div>
            <div className="ml-6">├─► <span className="text-indigo-600">header_extractor</span>  <span className="text-slate-400">║</span></div>
            <div className="ml-6">└─► <span className="text-violet-600">line_item</span>          <span className="text-slate-400">║ parallel superstep</span></div>
            <div className="ml-6 mt-0.5">↓ fan-in</div>
            <div className="ml-6">→ <span className="text-amber-600">tax_validator</span> → <span className="text-emerald-600">vendor_matcher</span> → <span className="text-rose-600">rule_engine</span></div>
            <div className="ml-6">→ <span className="text-orange-600">human_review</span> <span className="text-slate-400">(interrupt() if errors / confidence &lt; 85%)</span></div>
            <div className="ml-6">→ <span className="text-teal-600">concur_publisher</span> → END</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {AGENT_DEFINITIONS.map(a => {
          const Ic = iconMap[a.icon] || Bot
          return (
            <Card key={a.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg ${a.color} flex items-center justify-center text-white`}><Ic className="h-5 w-5" /></div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {a.name}
                      {a.parallel && <Badge variant="secondary" className="text-[9px] h-4 px-1">parallel</Badge>}
                      {a.isHumanNode && <Badge variant="outline" className="text-[9px] h-4 px-1 text-orange-600 border-orange-300">interrupt</Badge>}
                    </CardTitle>
                    <CardDescription className="text-xs">{a.role}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Model / engine</span><span className="font-medium">{a.model}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Execution</span><span className="font-medium">{a.parallel ? 'Parallel superstep' : a.isHumanNode ? 'Human interrupt' : 'Sequential'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Avg latency</span><span className="font-medium">{a.isHumanNode ? 'human-paced' : `${(Math.random()*1.2+0.3).toFixed(2)}s`}</span></div>
                <div className="flex items-center justify-between pt-1"><span className="text-muted-foreground">Status</span><Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 border" variant="outline"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1" /> online</Badge></div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function RulesEngine({ rules, setRules }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ name: '', expression: '', severity: 'warning', enabled: true })
  const add = () => {
    if (!draft.name.trim()) { toast.error('Rule name required'); return }
    setRules(r => [...r, { ...draft, id: 'r' + Date.now() }])
    setDraft({ name: '', expression: '', severity: 'warning', enabled: true })
    setOpen(false)
    toast.success('Rule added')
  }
  const toggle = id => setRules(r => r.map(x => x.id === id ? { ...x, enabled: !x.enabled } : x))
  const remove = id => setRules(r => r.filter(x => x.id !== id))

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-rose-500" /> Policy rules</CardTitle>
            <CardDescription className="text-xs">Deterministic checks applied after extraction. {rules.filter(r=>r.enabled).length} / {rules.length} active.</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add rule</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New policy rule</DialogTitle><DialogDescription>Rules run automatically after agent extraction.</DialogDescription></DialogHeader>
              <div className="space-y-3">
                <div><Label className="text-xs">Name</Label><Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Require approved vendor" className="mt-1" /></div>
                <div><Label className="text-xs">Expression</Label><Textarea value={draft.expression} onChange={e => setDraft(d => ({ ...d, expression: e.target.value }))} placeholder="e.g. total < 10000 && poNumber" className="mt-1 font-mono text-xs" rows={3} /></div>
                <div><Label className="text-xs">Severity</Label>
                  <Select value={draft.severity} onValueChange={v => setDraft(d => ({ ...d, severity: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="error">Error (blocks approval)</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter><Button onClick={add}>Create rule</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead className="w-16">Active</TableHead><TableHead>Rule</TableHead><TableHead>Expression</TableHead><TableHead>Severity</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {rules.map(r => (
                <TableRow key={r.id}>
                  <TableCell><Switch checked={r.enabled} onCheckedChange={() => toggle(r.id)} /></TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><code className="text-[11px] bg-muted px-1.5 py-0.5 rounded">{r.expression}</code></TableCell>
                  <TableCell><Badge variant={r.severity === 'error' ? 'destructive' : 'secondary'}>{r.severity}</Badge></TableCell>
                  <TableCell className="text-right"><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function ConcurView({ invoices, onPostToConcur }) {
  const [concurInvoice, setConcurInvoice] = useState(null)
  const posted = invoices.filter(i => ['uploaded','posted'].includes(i.status))
  return (
    <div className="p-6 space-y-4">
      <ConcurPostDialog
        invoice={concurInvoice}
        open={!!concurInvoice}
        onOpenChange={v => { if (!v) setConcurInvoice(null) }}
        onConfirm={async () => {
          await onPostToConcur(concurInvoice?.id)
          setConcurInvoice(null)
        }}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Send className="h-4 w-4 text-teal-500" /> SAP Concur Invoice API</CardTitle>
            <CardDescription className="text-xs">OAuth 2.0 · Concur Invoice v4 · human-confirmed posting after approval</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-xs font-mono">
              <div className="flex justify-between"><span className="text-muted-foreground">Endpoint</span><span>https://www.concursolutions.com/api/v4.0/invoice</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auth</span><span>OAuth 2.0 Bearer</span></div>
              <div className="flex justify-between items-center"><span className="text-muted-foreground">Connection</span><Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 border" variant="outline"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1" /> connected (dev mode)</Badge></div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border p-3"><p className="text-2xl font-semibold">{posted.length}</p><p className="text-[11px] text-muted-foreground">Posted today</p></div>
              <div className="rounded-lg border p-3"><p className="text-2xl font-semibold text-emerald-600">100%</p><p className="text-[11px] text-muted-foreground">Success rate</p></div>
              <div className="rounded-lg border p-3"><p className="text-2xl font-semibold">0.8s</p><p className="text-[11px] text-muted-foreground">Avg post latency</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Ready to post</CardTitle><CardDescription className="text-xs">Approved invoices awaiting Concur upload</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {invoices.filter(i => i.status === 'approved').length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No approved invoices pending.</p>}
            {invoices.filter(i => i.status === 'approved').map(inv => (
              <div key={inv.id} className="flex items-center justify-between border rounded-lg p-2.5">
                <div><p className="text-sm font-medium">{inv.invoiceNumber}</p><p className="text-[11px] text-muted-foreground">{inv.vendor} · {fmtMoney(inv.total, inv.currency)}</p></div>
                <Button size="sm" className="h-7 gap-1 bg-teal-600 hover:bg-teal-700" onClick={() => setConcurInvoice(inv)}><Send className="h-3 w-3" /> Post</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Concur post history</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Vendor</TableHead><TableHead>Amount</TableHead><TableHead>Concur Ref</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {posted.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.invoiceNumber}</TableCell>
                  <TableCell>{p.vendor}</TableCell>
                  <TableCell>{fmtMoney(p.total, p.currency)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.concurRef || '—'}</TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                </TableRow>
              ))}
              {posted.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">No invoices posted yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Upload Dialog — connects SSE immediately after creating the invoice ────────
function UploadDialog({ open, onOpenChange, onDone }) {
  const [stage, setStage]       = useState('pick')
  const [progress, setProgress] = useState(0)
  const [invoiceId, setInvoiceId] = useState(null)
  const [nodeStatuses, setNodeStatuses] = useState({})
  const [newInv, setNewInv]     = useState(null)
  const [pickedFile, setPickedFile] = useState(null)
  const fileRef                 = useRef(null)
  const pickedFileRef           = useRef(null)
  const esRef                   = useRef(null)

  const reset = () => {
    setStage('pick'); setProgress(0); setInvoiceId(null)
    setNodeStatuses({}); setNewInv(null); setPickedFile(null)
    pickedFileRef.current = null
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    onOpenChange(false)
  }

  const startFakeUpload = (e) => {
    const file = e?.target?.files?.[0] ?? null
    if (!file) return
    setPickedFile(file); pickedFileRef.current = file
    setStage('uploading'); setProgress(0)
    const iv = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(iv); createInvoiceAndStream(); return 100 }
        return p + 8
      })
    }, 80)
  }

  const createInvoiceAndStream = async () => {
    setStage('processing')
    try {
      const form = new FormData()
      form.append('file', pickedFileRef.current, pickedFileRef.current.name)
      form.append('uploaded_by', 'demo_user')

      const res = await fetch(`${BACKEND}/api/v1/invoices`, { method: 'POST', body: form })
      if (!res.ok) throw new Error('Backend unavailable')
      const { invoice_id } = await res.json()
      setInvoiceId(invoice_id)

      // Open SSE stream
      const es = new EventSource(`${BACKEND}/api/v1/invoices/${invoice_id}/stream`)
      esRef.current = es
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'node_start') {
            setNodeStatuses(prev => ({ ...prev, [msg.node]: 'running' }))
          } else if (msg.type === 'node_end') {
            setNodeStatuses(prev => ({ ...prev, [msg.node]: 'done' }))
          } else if (msg.type === 'completed' || msg.type === 'interrupted') {
            es.close()
            setNewInv({ id: invoice_id, invoiceNumber: `INV-${invoice_id.slice(0,8).toUpperCase()}`, status: msg.status || 'pending_review', confidence: msg.confidence || 0.9 })
            setStage('done')
          }
        } catch (_) {}
      }
      es.onerror = () => {
        es.close()
        setStage('done')
        setNewInv({ id: invoice_id, invoiceNumber: `INV-${invoice_id.slice(0,8).toUpperCase()}`, status: 'processing', confidence: 0 })
      }
    } catch (err) {
      toast.error('Upload failed', { description: String(err) })
      setStage('pick')
    }
  }

  const finish = () => { onDone(newInv); reset() }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload invoice</DialogTitle>
          <DialogDescription>LangGraph agents will run in parallel to extract data.</DialogDescription>
        </DialogHeader>

        {stage === 'pick' && (
          <div onClick={() => fileRef.current && fileRef.current.click()} className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-muted/30 transition">
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,image/*" onChange={startFakeUpload} />
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">Drop invoice here or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, PNG, JPG, TIFF · max 50 MB</p>
          </div>
        )}

        {stage === 'uploading' && (
          <div className="py-6 space-y-3">
            <div className="flex items-center gap-3"><FileText className="h-8 w-8 text-indigo-500" /><div className="flex-1"><p className="text-sm font-medium">invoice.pdf</p><p className="text-xs text-muted-foreground">Uploading... {progress}%</p></div></div>
            <Progress value={progress} />
          </div>
        )}

        {stage === 'processing' && (
          <div className="py-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="h-4 w-4 text-indigo-500" />
              <p className="text-sm font-medium">LangGraph running…</p>
              <Badge variant="outline" className="text-blue-600 border-blue-300 gap-1 text-[10px]">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" /> Live stream
              </Badge>
            </div>

            {/* Sequential: ingestion */}
            {AGENT_DEFINITIONS.filter(a => a.id === 'ingestion').map(a => {
              const st = nodeStatuses[a.id] || 'idle'
              const Ic = iconMap[a.icon] || Bot
              return (
                <div key={a.id} className="flex items-center gap-3 text-sm">
                  {st === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" /> : st === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <div className="h-4 w-4 rounded-full border-2 border-muted" />}
                  <span className="flex-1">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{st === 'running' ? 'running…' : st === 'done' ? 'done' : ''}</span>
                </div>
              )
            })}

            {/* Parallel row */}
            <div className="ml-3 grid grid-cols-2 gap-2 border-l-2 border-dashed border-muted-foreground/20 pl-3">
              {AGENT_DEFINITIONS.filter(a => a.parallel).map(a => {
                const st = nodeStatuses[a.id] || 'idle'
                return (
                  <div key={a.id} className="flex items-center gap-2 text-xs border rounded-md p-2">
                    {st === 'running' ? <Loader2 className="h-3 w-3 animate-spin text-blue-500" /> : st === 'done' ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <div className="h-3 w-3 rounded-full border border-muted" />}
                    <span>{a.name}</span>
                  </div>
                )
              })}
            </div>

            {/* Sequential tail */}
            {AGENT_DEFINITIONS.filter(a => !a.parallel && a.id !== 'ingestion').map(a => {
              const st = nodeStatuses[a.id] || 'idle'
              return (
                <div key={a.id} className="flex items-center gap-3 text-sm">
                  {st === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" /> : st === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <div className="h-4 w-4 rounded-full border-2 border-muted" />}
                  <span className="flex-1">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{st === 'running' ? 'running…' : st === 'done' ? 'done' : ''}</span>
                </div>
              )
            })}
          </div>
        )}

        {stage === 'done' && newInv && (
          <div className="py-4 space-y-3">
            <div className="flex items-center gap-3 rounded-lg border bg-emerald-50 p-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              <div>
                <p className="font-medium text-sm">Extraction complete</p>
                <p className="text-xs text-muted-foreground">{newInv.invoiceNumber} · {(newInv.confidence*100).toFixed(0)}% confidence</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Invoice added to review queue. Open it for side-by-side review.</p>
          </div>
        )}

        <DialogFooter>
          {stage === 'pick' && <Button variant="outline" onClick={reset}>Cancel</Button>}
          {stage === 'done' && <Button onClick={finish} className="gap-1.5">Open invoice <ArrowUpRight className="h-3.5 w-3.5" /></Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Root App ──────────────────────────────────────────────────────────────────
function App() {
  const [view, setView]         = useState('dashboard')
  const [invoices, setInvoices] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [rules, setRules]       = useState(INITIAL_RULES)
  const [uploadOpen, setUploadOpen] = useState(false)

  useEffect(() => {
    fetch(`${BACKEND}/api/v1/invoices?limit=100`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.invoices?.length) setInvoices(data.invoices.map(mapInvoice)) })
      .catch(() => {})
  }, [])

  // Poll every 30s so statuses stay fresh without a page reload
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${BACKEND}/api/v1/invoices?limit=100`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.invoices) setInvoices(data.invoices.map(mapInvoice)) })
        .catch(() => {})
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  const selected = invoices.find(i => i.id === selectedId)

  // Stream is active when processing/queued OR pending_review (so the SSE reconnects
  // and the backend immediately re-sends the interrupted event for review)
  const streamActive = selected && ['processing', 'queued', 'pending_review'].includes(selected.status)

  const {
    nodeStatuses, traces, interrupted, completed, reconnect,
  } = useAgentStream(selectedId, !!streamActive)

  // Fetch full invoice data from backend whenever a real invoice is selected
  useEffect(() => {
    if (!selectedId) return
    fetch(`${BACKEND}/api/v1/invoices/${selectedId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        setInvoices(list => list.map(i => i.id === selectedId ? { ...i, ...mapInvoice(data) } : i))
      })
      .catch(() => {})
  }, [selectedId])

  // When graph completes, refresh invoice data from backend
  useEffect(() => {
    if (!completed || !selectedId) return
    fetch(`${BACKEND}/api/v1/invoices/${selectedId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        setInvoices(list => list.map(i => i.id === selectedId
          ? { ...i, ...mapInvoice(data) }
          : i
        ))
      })
      .catch(() => {})
  }, [completed, selectedId])

  const violations = useMemo(() => {
    if (!selected) return []
    const v = []
    rules.filter(r => r.enabled).forEach(r => {
      if (r.id === 'r1' && selected.total > 5000 && !selected.poNumber)
        v.push({ ...r, message: `Total is ${fmtMoney(selected.total, selected.currency)} but PO number is missing.` })
      if (r.id === 'r3') {
        const expected = Number((selected.subtotal * selected.taxRate).toFixed(2))
        if (Math.abs(selected.tax - expected) > 0.02)
          v.push({ ...r, message: `Tax ${fmtMoney(selected.tax)} does not match expected ${fmtMoney(expected)}.` })
      }
      if (r.id === 'r6' && selected.total > 25000)
        v.push({ ...r, message: `High-value invoice requires CFO review (total: ${fmtMoney(selected.total, selected.currency)}).` })
      if (r.id === 'r2') {
        const dup = invoices.filter(i => i.invoiceNumber === selected.invoiceNumber && i.id !== selected.id).length
        if (dup) v.push({ ...r, message: `Duplicate invoice number detected (${dup} match).` })
      }
    })
    return v
  }, [selected, rules, invoices])

  const updateInvoice = upd => setInvoices(list => list.map(i => i.id === upd.id ? upd : i))

  const deleteInvoice = async (id) => {
    try {
      const res = await fetch(`${BACKEND}/api/v1/invoices/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(await res.text())
    } catch (_) {}
    setInvoices(list => list.filter(i => i.id !== id))
    if (selectedId === id) { setSelectedId(null); setView('queue') }
    toast.success('Invoice deleted', { duration: 2000 })
  }

  const handleReviewDecision = (decision) => {
    if (decision === 'approved') {
      updateInvoice({ ...selected, status: 'approved' })
      toast.success('Invoice approved — ready to post to SAP Concur')
    } else {
      updateInvoice({ ...selected, status: 'rejected' })
      toast.error('Invoice rejected')
    }
  }

  const postToConcur = async (invoiceId) => {
    const res = await fetch(`${BACKEND}/api/v1/invoices/${invoiceId}/post-to-concur`, { method: 'POST' })
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json()
    setInvoices(list => list.map(i => i.id === invoiceId
      ? { ...i, status: 'posted', concurRef: data.concur_ref }
      : i
    ))
    toast.success('Posted to SAP Concur', { description: `Ref: ${data.concur_ref}` })
    return data
  }

  const counts = { queue: invoices.filter(i => ['pending_review','needs_attention'].includes(i.status)).length }

  const handleUploadDone = (inv) => {
    if (!inv) return
    const mapped = mapInvoice(inv)
    const entry = { ...mapped, status: 'processing' }
    setInvoices(l => [entry, ...l])
    setSelectedId(inv.id)
    setView('detail')
    toast.success('Invoice added', { description: `Opening review for ${mapped.invoiceNumber || inv.id.slice(0, 8)}…` })
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar view={view} setView={setView} counts={counts} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar view={view} onUpload={() => setUploadOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          {view === 'dashboard' && <Dashboard invoices={invoices} setView={setView} setSelectedId={setSelectedId} />}
          {view === 'queue'     && <InvoiceQueue invoices={invoices} onSelect={id => { setSelectedId(id); setView('detail') }} onDelete={deleteInvoice} />}
          {view === 'detail' && selected && (
            <InvoiceDetail
              invoice={selected}
              onBack={() => setView('queue')}
              onUpdate={updateInvoice}
              onDelete={deleteInvoice}
              rules={rules}
              violations={violations}
              nodeStatuses={nodeStatuses}
              traces={traces}
              interrupted={interrupted}
              streamActive={!!streamActive}
              onReviewDecision={handleReviewDecision}
              onPostToConcur={postToConcur}
            />
          )}
          {view === 'detail' && !selected && (
            <div className="p-10 text-center text-muted-foreground">Select an invoice from the queue to review.</div>
          )}
          {view === 'agents' && <AgentsView />}
          {view === 'rules'  && <RulesEngine rules={rules} setRules={setRules} />}
          {view === 'concur' && <ConcurView invoices={invoices} onPostToConcur={postToConcur} />}
        </main>
      </div>
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onDone={handleUploadDone} />
    </div>
  )
}

export default App
