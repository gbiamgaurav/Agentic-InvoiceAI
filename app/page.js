'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  LayoutDashboard, Inbox, Bot, ShieldCheck, Send, Upload, FileText, Check, X,
  AlertTriangle, CheckCircle2, Clock, Loader2, Play, Edit3, Save,
  FileScan, Tag, List, Calculator, Building2, ChevronRight, Plus, Trash2,
  Activity, DollarSign, FileCheck2, Sparkles, PanelLeft, Search,
  ArrowUpRight, Zap, Eye, Copy, Download, Filter,
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

const iconMap = { FileScan, Tag, List, Calculator, Building2, ShieldCheck, Send }

const fmtMoney = (n, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n || 0)
const statusMeta = {
  processing: { label: 'Processing', cls: 'bg-blue-100 text-blue-700 border-blue-200', Icon: Loader2 },
  needs_attention: { label: 'Needs Attention', cls: 'bg-amber-100 text-amber-800 border-amber-200', Icon: AlertTriangle },
  pending_review: { label: 'Pending Review', cls: 'bg-violet-100 text-violet-700 border-violet-200', Icon: Clock },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  rejected: { label: 'Rejected', cls: 'bg-rose-100 text-rose-700 border-rose-200', Icon: X },
  uploaded: { label: 'Posted to Concur', cls: 'bg-teal-100 text-teal-700 border-teal-200', Icon: Send },
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

function Sidebar({ view, setView, counts }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'queue', label: 'Invoice Queue', icon: Inbox, badge: counts.queue },
    { id: 'agents', label: 'Agents', icon: Bot },
    { id: 'rules', label: 'Rule Engine', icon: ShieldCheck },
    { id: 'concur', label: 'SAP Concur', icon: Send },
  ]
  return (
    <aside className="hidden md:flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 py-4 border-b">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="font-semibold tracking-tight text-sm">AgentInvoice AI</div>
          <div className="text-[10px] text-muted-foreground">Agentic AP automation</div>
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
          <div className="text-xs font-medium mb-1 flex items-center gap-1"><Zap className="h-3 w-3 text-amber-500" /> Demo Mode</div>
          <p className="text-[11px] text-muted-foreground leading-snug">Frontend MVP with mocked agents. Python backend pending.</p>
        </div>
      </div>
    </aside>
  )
}

function Topbar({ view, onUpload }) {
  const titles = { dashboard: 'Dashboard', queue: 'Invoice Queue', detail: 'Invoice Review', agents: 'Agents', rules: 'Rule Engine', concur: 'SAP Concur Integration' }
  return (
    <header className="flex items-center justify-between border-b px-6 py-3 bg-background/80 backdrop-blur">
      <div className="flex items-center gap-3">
        <PanelLeft className="h-4 w-4 text-muted-foreground md:hidden" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{titles[view] || 'AgentInvoice AI'}</h1>
          <p className="text-xs text-muted-foreground">Multi-agent invoice processing with human-in-the-loop</p>
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

function Dashboard({ invoices, setView, setSelectedId }) {
  const kpis = useMemo(() => {
    const total = invoices.length
    const approved = invoices.filter(i => i.status === 'approved' || i.status === 'uploaded').length
    const pending = invoices.filter(i => i.status === 'pending_review' || i.status === 'needs_attention').length
    const processing = invoices.filter(i => i.status === 'processing').length
    const value = invoices.reduce((s, i) => s + (i.total || 0), 0)
    const confs = invoices.filter(i => i.confidence > 0)
    const avgConf = confs.length ? confs.reduce((s, i) => s + i.confidence, 0) / confs.length : 0
    const autoRate = (approved / Math.max(1, total)) * 100
    return { total, approved, pending, processing, value, avgConf, autoRate }
  }, [invoices])

  const weeklyData = [
    { day: 'Mon', processed: 18, approved: 14 }, { day: 'Tue', processed: 24, approved: 20 },
    { day: 'Wed', processed: 31, approved: 26 }, { day: 'Thu', processed: 22, approved: 18 },
    { day: 'Fri', processed: 29, approved: 25 }, { day: 'Sat', processed: 8, approved: 7 },
    { day: 'Sun', processed: 5, approved: 4 },
  ]
  const statusData = [
    { name: 'Approved', value: kpis.approved, color: '#10b981' },
    { name: 'Pending', value: kpis.pending, color: '#8b5cf6' },
    { name: 'Processing', value: kpis.processing, color: '#3b82f6' },
    { name: 'Rejected', value: invoices.filter(i => i.status === 'rejected').length, color: '#f43f5e' },
  ]
  const trendData = Array.from({ length: 12 }).map((_, i) => ({ m: ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'][i], acc: 74 + Math.round(Math.sin(i) * 4) + i }))

  const kpiCards = [
    { label: 'Invoices Processed', value: kpis.total, sub: '+12.4% vs last week', Icon: FileCheck2, color: 'from-indigo-500 to-violet-600' },
    { label: 'Total AP Value', value: fmtMoney(kpis.value), sub: 'Across 6 vendors', Icon: DollarSign, color: 'from-emerald-500 to-teal-600' },
    { label: 'Straight-Through Rate', value: `${kpis.autoRate.toFixed(0)}%`, sub: 'Auto-approved', Icon: Zap, color: 'from-amber-500 to-orange-600' },
    { label: 'Avg. Confidence', value: `${(kpis.avgConf * 100).toFixed(1)}%`, sub: 'Across all agents', Icon: Activity, color: 'from-rose-500 to-pink-600' },
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
                <CardTitle className="text-base">Weekly throughput</CardTitle>
                <CardDescription className="text-xs">Processed vs auto-approved invoices</CardDescription>
              </div>
              <Badge variant="outline">Last 7 days</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weeklyData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="day" fontSize={11} stroke="#6b7280" />
                <YAxis fontSize={11} stroke="#6b7280" />
                <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="processed" fill="#6366f1" radius={[6,6,0,0]} name="Processed" />
                <Bar dataKey="approved" fill="#10b981" radius={[6,6,0,0]} name="Approved" />
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
            {[
              { who: 'Header Extractor', what: 'extracted header for INV-2025-0001', when: '2m ago', color: 'bg-indigo-500' },
              { who: 'Priya R.', what: 'approved INV-2025-0003', when: '14m ago', color: 'bg-emerald-500' },
              { who: 'Rule Engine', what: 'flagged INV-2025-0002 (missing PO)', when: '38m ago', color: 'bg-amber-500' },
              { who: 'SAP Concur', what: 'posted INV-2025-0005 \u2192 CNR-INV-58821', when: '1h ago', color: 'bg-teal-500' },
              { who: 'Dana W.', what: 'edited line items on INV-2025-0004', when: '2h ago', color: 'bg-violet-500' },
            ].map((a,i) => (
              <div key={i} className="flex gap-3">
                <div className={`h-2 w-2 rounded-full mt-1.5 ${a.color}`} />
                <div className="flex-1">
                  <p><span className="font-medium">{a.who}</span> <span className="text-muted-foreground">{a.what}</span></p>
                  <p className="text-[11px] text-muted-foreground">{a.when}</p>
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
          <Button size="sm" variant="outline" onClick={() => setView('queue')}>Open queue <ChevronRight className="h-3.5 w-3.5 ml-1" /></Button>
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

function InvoiceQueue({ invoices, onSelect }) {
  const [filter, setFilter] = useState('all')
  const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter)
  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">All invoices</CardTitle>
            <CardDescription className="text-xs">{filtered.length} invoices &middot; click to open side-by-side review</CardDescription>
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
                <SelectItem value="uploaded">Posted to Concur</SelectItem>
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
                  <TableCell><Button size="sm" variant="ghost" className="h-7"><Eye className="h-3.5 w-3.5 mr-1" /> Review</Button></TableCell>
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
          <div className="h-10 w-28 bg-gradient-to-br from-slate-800 to-slate-600 rounded flex items-center justify-center text-white font-sans text-xs tracking-widest">
            {invoice.vendor.split(' ')[0].toUpperCase()}
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
          <p className="font-semibold">Emergent Labs, Inc.</p>
          <p className="text-slate-600">100 Innovation Way, Palo Alto, CA 94301</p>
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
          {invoice.lineItems.map((li, i) => (
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
          <div className="flex justify-between"><span className="text-slate-500">Tax ({(invoice.taxRate*100).toFixed(0)}%)</span><span>{fmtMoney(invoice.tax, invoice.currency)}</span></div>
          <Separator />
          <div className="flex justify-between font-bold text-sm pt-1"><span>Total Due</span><span>{fmtMoney(invoice.total, invoice.currency)}</span></div>
        </div>
      </div>
      {invoice.notes && (<div className="mt-10 pt-4 border-t text-xs font-sans text-slate-500"><p className="font-semibold mb-1">Notes</p><p>{invoice.notes}</p></div>)}
      <p className="mt-16 text-center text-[10px] text-slate-400 font-sans">Thank you for your business.</p>
    </div>
  )
}

function AgentPipeline({ runs, onRun, running }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4" /> Agent Pipeline</CardTitle>
            <CardDescription className="text-xs">Orchestrated multi-agent extraction</CardDescription>
          </div>
          <Button size="sm" onClick={onRun} disabled={running} className="gap-1.5 h-8">
            {running ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running...</> : <><Play className="h-3.5 w-3.5" /> Re-run pipeline</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {AGENT_DEFINITIONS.map(a => {
          const run = runs[a.id] || { status: 'idle', conf: 0 }
          const Ic = iconMap[a.icon] || Bot
          return (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border p-2.5 bg-card">
              <div className={`h-8 w-8 rounded-md ${a.color} flex items-center justify-center text-white shrink-0`}>
                <Ic className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{a.name}</p>
                  <Badge variant="outline" className="text-[9px] h-4 px-1">{a.model}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">{a.role}</p>
              </div>
              <div className="text-right shrink-0">
                {run.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                {run.status === 'done' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">{(run.conf*100).toFixed(0)}%</span>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  </div>
                )}
                {run.status === 'idle' && <span className="text-[10px] text-muted-foreground">idle</span>}
                {run.status === 'error' && <AlertTriangle className="h-4 w-4 text-rose-500" />}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
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

function InvoiceDetail({ invoice, onBack, onUpdate, onApprove, onReject, onUpload, rules, runs, onRun, running, violations }) {
  const [edit, setEdit] = useState(false)
  const [local, setLocal] = useState(invoice)
  useEffect(() => setLocal(invoice), [invoice])

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

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      <div className="flex items-center justify-between px-6 py-3 border-b bg-background">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={onBack} className="h-8"><ChevronRight className="h-4 w-4 rotate-180" /> Back</Button>
          <Separator orientation="vertical" className="h-5" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{invoice.invoiceNumber}</h2>
              <StatusBadge status={invoice.status} />
            </div>
            <p className="text-xs text-muted-foreground">{invoice.vendor} &middot; {fmtMoney(invoice.total, invoice.currency)} &middot; Assigned to {invoice.assignedTo}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {edit ? (
            <><Button size="sm" variant="outline" onClick={() => { setLocal(invoice); setEdit(false) }}>Cancel</Button>
            <Button size="sm" onClick={save} className="gap-1.5"><Save className="h-3.5 w-3.5" /> Save edits</Button></>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEdit(true)} className="gap-1.5"><Edit3 className="h-3.5 w-3.5" /> Edit fields</Button>
          )}
          <Button size="sm" variant="outline" onClick={onReject} className="gap-1.5 text-rose-600 hover:text-rose-700"><X className="h-3.5 w-3.5" /> Reject</Button>
          <Button size="sm" onClick={onApprove} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"><Check className="h-3.5 w-3.5" /> Approve</Button>
          <Button size="sm" onClick={onUpload} className="gap-1.5 bg-teal-600 hover:bg-teal-700"><Send className="h-3.5 w-3.5" /> Post to Concur</Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
        <div className="bg-slate-100 overflow-y-auto border-r">
          <div className="flex items-center justify-between sticky top-0 bg-slate-100/90 backdrop-blur px-4 py-2 border-b text-xs text-slate-600 z-10">
            <div className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> original_invoice.pdf &middot; Page 1 of 1</div>
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
              <TabsTrigger value="agents">Agents</TabsTrigger>
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
                  <Field label="Vendor" value={local.vendor} onChange={v => change('vendor', v)} edit={edit} />
                  <Field label="Invoice #" value={local.invoiceNumber} onChange={v => change('invoiceNumber', v)} edit={edit} />
                  <Field label="Invoice Date" value={local.invoiceDate} onChange={v => change('invoiceDate', v)} edit={edit} />
                  <Field label="Due Date" value={local.dueDate} onChange={v => change('dueDate', v)} edit={edit} />
                  <Field label="PO Number" value={local.poNumber} onChange={v => change('poNumber', v)} edit={edit} placeholder="(missing)" />
                  <Field label="Currency" value={local.currency} onChange={v => change('currency', v)} edit={edit} />
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
                      {local.lineItems.map((li, i) => (
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
                  <Field label={`Tax (${(local.taxRate*100).toFixed(0)}%)`} value={fmtMoney(local.tax, local.currency)} readOnly />
                  <Field label="Total" value={fmtMoney(local.total, local.currency)} readOnly highlight />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="agents" className="p-4 space-y-4">
              <AgentPipeline runs={runs} onRun={onRun} running={running} />
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Execution trace</CardTitle></CardHeader>
                <CardContent>
                  <ScrollArea className="h-52 pr-3">
                    <div className="space-y-2 font-mono text-[11px]">
                      {AGENT_DEFINITIONS.map(a => {
                        const r = runs[a.id] || { status: 'idle' }
                        if (r.status === 'idle') return null
                        return (
                          <div key={a.id} className="border-l-2 border-indigo-400 pl-3 py-1">
                            <div className="flex justify-between"><span className="font-semibold text-indigo-700">{a.name}</span><span className="text-muted-foreground">{r.status}</span></div>
                            {r.log && <pre className="text-muted-foreground whitespace-pre-wrap mt-0.5">{r.log}</pre>}
                          </div>
                        )
                      })}
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
    <div className="p-6 space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {AGENT_DEFINITIONS.map(a => {
          const Ic = iconMap[a.icon] || Bot
          return (
            <Card key={a.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg ${a.color} flex items-center justify-center text-white`}><Ic className="h-5 w-5" /></div>
                  <div>
                    <CardTitle className="text-base">{a.name}</CardTitle>
                    <CardDescription className="text-xs">{a.role}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span className="font-medium">{a.model}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Avg latency</span><span className="font-medium">{(Math.random()*1.2+0.3).toFixed(2)}s</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Success rate</span><span className="font-medium text-emerald-600">{(95 + Math.random()*4).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Invocations (24h)</span><span className="font-medium">{Math.floor(Math.random()*200+50)}</span></div>
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
              <DialogHeader><DialogTitle>New policy rule</DialogTitle><DialogDescription>Rules run automatically after agent extraction. Use the simple DSL below.</DialogDescription></DialogHeader>
              <div className="space-y-3">
                <div><Label className="text-xs">Name</Label><Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Require approved vendor" className="mt-1" /></div>
                <div><Label className="text-xs">Expression</Label><Textarea value={draft.expression} onChange={e => setDraft(d => ({ ...d, expression: e.target.value }))} placeholder="e.g. total < 10000 && poNumber" className="mt-1 font-mono text-xs" rows={3} /></div>
                <div><Label className="text-xs">Severity</Label>
                  <Select value={draft.severity} onValueChange={v => setDraft(d => ({ ...d, severity: v }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
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

function ConcurView({ invoices, onUpload }) {
  const posted = invoices.filter(i => i.status === 'uploaded')
  return (
    <div className="p-6 space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Send className="h-4 w-4 text-teal-500" /> SAP Concur Invoice API</CardTitle>
            <CardDescription className="text-xs">OAuth 2.0 connection to Concur Invoice v4. Posts approved invoices as DRAFT or COMPLETE.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-xs font-mono">
              <div className="flex justify-between"><span className="text-muted-foreground">Endpoint</span><span>https://www.concursolutions.com/api/v4.0/invoice</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auth</span><span>OAuth 2.0 Bearer</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Company ID</span><span>emergent-labs-001</span></div>
              <div className="flex justify-between items-center"><span className="text-muted-foreground">Connection</span><Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 border" variant="outline"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1" /> connected (mocked)</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Last sync</span><span>2 min ago</span></div>
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
                <div><p className="text-sm font-medium">{inv.invoiceNumber}</p><p className="text-[11px] text-muted-foreground">{inv.vendor} &middot; {fmtMoney(inv.total, inv.currency)}</p></div>
                <Button size="sm" className="h-7 gap-1 bg-teal-600 hover:bg-teal-700" onClick={() => onUpload(inv.id)}><Send className="h-3 w-3" /> Post</Button>
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
                  <TableCell><Badge className="bg-teal-100 text-teal-700 border-teal-200 border" variant="outline">posted</Badge></TableCell>
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

function UploadDialog({ open, onOpenChange, onDone }) {
  const [stage, setStage] = useState('pick')
  const [progress, setProgress] = useState(0)
  const [newInv, setNewInv] = useState(null)
  const fileRef = useRef(null)

  const start = () => {
    setStage('uploading'); setProgress(0)
    const iv = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(iv); setStage('processing'); runPipeline(); return 100 }
        return p + 8
      })
    }, 80)
  }
  const runPipeline = () => {
    const inv = {
      id: 'INV-2025-' + Math.floor(1000 + Math.random()*9000),
      vendor: 'Hyperion Tech Solutions',
      vendorAddress: '420 Innovation Blvd, Seattle, WA 98109',
      invoiceNumber: 'HYP-' + Math.floor(10000 + Math.random()*90000),
      invoiceDate: '2025-06-15', dueDate: '2025-07-15',
      poNumber: 'PO-' + Math.floor(10000 + Math.random()*90000),
      currency: 'USD', taxRate: 0.08,
      subtotal: 7500, tax: 600, total: 8100,
      status: 'pending_review', confidence: 0.93, assignedTo: 'Priya Raman',
      lineItems: [
        { desc: 'AI workflow platform license (annual)', qty: 1, unit: 5500, amount: 5500, conf: 0.95 },
        { desc: 'Onboarding & training services', qty: 10, unit: 200, amount: 2000, conf: 0.90 },
      ], notes: 'Terms: Net 30.',
    }
    setNewInv(inv)
    setTimeout(() => { setStage('done') }, 2500)
  }
  const finish = () => { onDone(newInv); reset() }
  const reset = () => { setStage('pick'); setProgress(0); setNewInv(null); onOpenChange(false) }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Upload invoice</DialogTitle><DialogDescription>Drag a PDF or click to browse. Agents will extract data automatically.</DialogDescription></DialogHeader>
        {stage === 'pick' && (
          <div onClick={() => fileRef.current && fileRef.current.click()} className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-muted/30 transition">
            <input ref={fileRef} type="file" className="hidden" accept=".pdf" onChange={start} />
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">Drop invoice PDF here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse &middot; max 25 MB</p>
            <Button className="mt-4" onClick={(e) => { e.stopPropagation(); start() }}>Use sample invoice</Button>
          </div>
        )}
        {stage === 'uploading' && (
          <div className="py-6 space-y-3">
            <div className="flex items-center gap-3"><FileText className="h-8 w-8 text-indigo-500" /><div className="flex-1"><p className="text-sm font-medium">hyperion_invoice.pdf</p><p className="text-xs text-muted-foreground">Uploading... {progress}%</p></div></div>
            <Progress value={progress} />
          </div>
        )}
        {stage === 'processing' && (
          <div className="py-4 space-y-2">
            <p className="text-sm font-medium mb-3">Agents are extracting data...</p>
            {AGENT_DEFINITIONS.slice(0,6).map((a,i) => (
              <div key={a.id} className="flex items-center gap-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" style={{ animationDelay: `${i*0.15}s` }} />
                <span className="flex-1">{a.name}</span>
                <span className="text-xs text-muted-foreground">working...</span>
              </div>
            ))}
          </div>
        )}
        {stage === 'done' && newInv && (
          <div className="py-4 space-y-3">
            <div className="flex items-center gap-3 rounded-lg border bg-emerald-50 p-3"><CheckCircle2 className="h-6 w-6 text-emerald-600" /><div><p className="font-medium text-sm">Extraction complete</p><p className="text-xs text-muted-foreground">{newInv.invoiceNumber} &middot; {fmtMoney(newInv.total)} &middot; {(newInv.confidence*100).toFixed(0)}% confidence</p></div></div>
            <p className="text-xs text-muted-foreground">The invoice has been added to your review queue. Open it to compare side-by-side and approve.</p>
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

function ConcurPostDialog({ open, onOpenChange, invoice, onDone }) {
  const [stage, setStage] = useState('confirm')
  const [ref, setRef] = useState('')
  useEffect(() => { if (open) setStage('confirm') }, [open])
  const post = () => {
    setStage('posting')
    setTimeout(() => {
      const r = 'CNR-INV-' + Math.floor(10000 + Math.random()*90000)
      setRef(r); setStage('done')
      if (onDone) onDone(r)
    }, 1800)
  }
  if (!invoice) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Post to SAP Concur</DialogTitle><DialogDescription>Invoice will be posted via Concur Invoice v4 API.</DialogDescription></DialogHeader>
        {stage === 'confirm' && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span className="font-medium">{invoice.invoiceNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span className="font-medium">{invoice.vendor}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-medium">{fmtMoney(invoice.total, invoice.currency)}</span></div>
            </div>
            <pre className="bg-slate-950 text-slate-100 text-[10px] p-3 rounded-lg overflow-x-auto">{`POST /api/v4.0/invoice
Authorization: Bearer eyJ***
Content-Type: application/json

{
  "vendor": "${invoice.vendor}",
  "invoiceNumber": "${invoice.invoiceNumber}",
  "invoiceDate": "${invoice.invoiceDate}",
  "total": ${invoice.total},
  "currency": "${invoice.currency}",
  "poNumber": "${invoice.poNumber || ''}",
  "lineItems": [...]
}`}</pre>
          </div>
        )}
        {stage === 'posting' && (<div className="py-8 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-teal-500 mb-3" /><p className="text-sm">Posting to Concur...</p><p className="text-[11px] text-muted-foreground mt-1">Authenticating &middot; Validating &middot; Creating invoice record</p></div>)}
        {stage === 'done' && (<div className="py-4 space-y-3"><div className="flex items-center gap-3 rounded-lg border bg-teal-50 p-3"><CheckCircle2 className="h-6 w-6 text-teal-600" /><div><p className="font-medium text-sm">Posted successfully</p><p className="text-xs text-muted-foreground">Concur Ref: <code className="font-mono">{ref}</code></p></div></div><p className="text-xs text-muted-foreground">The invoice status has been updated to &quot;Posted to Concur&quot;.</p></div>)}
        <DialogFooter>
          {stage === 'confirm' && (<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={post} className="bg-teal-600 hover:bg-teal-700 gap-1.5"><Send className="h-3.5 w-3.5" /> Post now</Button></>)}
          {stage === 'done' && <Button onClick={() => onOpenChange(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function App() {
  const [view, setView] = useState('dashboard')
  const [invoices, setInvoices] = useState(SAMPLE_INVOICES)
  const [selectedId, setSelectedId] = useState(null)
  const [rules, setRules] = useState(INITIAL_RULES)
  const [agentRuns, setAgentRuns] = useState({})
  const [running, setRunning] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [concurOpen, setConcurOpen] = useState(false)

  const selected = invoices.find(i => i.id === selectedId)

  const violations = useMemo(() => {
    if (!selected) return []
    const v = []
    rules.filter(r => r.enabled).forEach(r => {
      if (r.id === 'r1' && selected.total > 5000 && !selected.poNumber) v.push({ ...r, message: `Total is ${fmtMoney(selected.total, selected.currency)} but PO number is missing.` })
      if (r.id === 'r3') {
        const expected = Number((selected.subtotal * selected.taxRate).toFixed(2))
        if (Math.abs(selected.tax - expected) > 0.02) v.push({ ...r, message: `Tax ${fmtMoney(selected.tax)} does not match expected ${fmtMoney(expected)}.` })
      }
      if (r.id === 'r6' && selected.total > 25000) v.push({ ...r, message: `High-value invoice requires CFO review (total: ${fmtMoney(selected.total, selected.currency)}).` })
      if (r.id === 'r2') {
        const dup = invoices.filter(i => i.invoiceNumber === selected.invoiceNumber && i.id !== selected.id).length
        if (dup) v.push({ ...r, message: `Duplicate invoice number detected (${dup} match).` })
      }
    })
    return v
  }, [selected, rules, invoices])

  const runPipeline = () => {
    if (running) return
    setRunning(true); setAgentRuns({})
    AGENT_DEFINITIONS.forEach((a, i) => {
      setTimeout(() => setAgentRuns(prev => ({ ...prev, [a.id]: { status: 'running' } })), i * 600)
      setTimeout(() => {
        const conf = 0.85 + Math.random() * 0.14
        const logs = {
          ingest: '2 pages detected · OCR quality: 98%',
          header: `vendor=${selected ? selected.vendor : ''} · invoice#=${selected ? selected.invoiceNumber : ''}`,
          lineitems: `${selected ? selected.lineItems.length : 0} line items parsed`,
          tax: `subtotal*rate = ${((selected ? selected.subtotal : 0)*(selected ? selected.taxRate : 0)).toFixed(2)} ≈ tax ${selected ? selected.tax : 0}`,
          vendor: `matched to vendor master (${selected ? selected.vendor.split(' ')[0] : ''}) sim=0.97`,
          rules: `${rules.filter(r=>r.enabled).length} rules evaluated · ${violations.length} violation(s)`,
          concur: 'ready for post (auth token cached)',
        }
        setAgentRuns(prev => ({ ...prev, [a.id]: { status: 'done', conf, log: logs[a.id] } }))
        if (i === AGENT_DEFINITIONS.length - 1) setRunning(false)
      }, i * 600 + 900)
    })
  }

  const updateInvoice = upd => setInvoices(list => list.map(i => i.id === upd.id ? upd : i))
  const approve = () => { updateInvoice({ ...selected, status: 'approved' }); toast.success('Invoice approved', { description: `${selected.invoiceNumber} is ready for Concur post.` }) }
  const reject = () => { updateInvoice({ ...selected, status: 'rejected' }); toast.error('Invoice rejected') }

  const counts = { queue: invoices.filter(i => ['pending_review','needs_attention'].includes(i.status)).length }

  const handleUploadDone = (inv) => {
    if (!inv) return
    setInvoices(l => [inv, ...l])
    setSelectedId(inv.id); setView('detail')
    toast.success('Invoice added', { description: `${inv.invoiceNumber} extracted and queued for review.` })
  }

  const postToConcur = (id) => {
    if (id) setSelectedId(id)
    setConcurOpen(true)
  }
  const concurDone = (ref) => {
    const inv = invoices.find(i => i.id === selectedId)
    if (!inv) return
    updateInvoice({ ...inv, status: 'uploaded', concurRef: ref })
    toast.success('Posted to SAP Concur', { description: `Concur Ref: ${ref}` })
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar view={view} setView={setView} counts={counts} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar view={view} onUpload={() => setUploadOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          {view === 'dashboard' && <Dashboard invoices={invoices} setView={setView} setSelectedId={setSelectedId} />}
          {view === 'queue' && <InvoiceQueue invoices={invoices} onSelect={id => { setSelectedId(id); setView('detail') }} />}
          {view === 'detail' && selected && (
            <InvoiceDetail
              invoice={selected}
              onBack={() => setView('queue')}
              onUpdate={updateInvoice}
              onApprove={approve}
              onReject={reject}
              onUpload={() => postToConcur()}
              rules={rules}
              runs={agentRuns}
              onRun={runPipeline}
              running={running}
              violations={violations}
            />
          )}
          {view === 'detail' && !selected && (
            <div className="p-10 text-center text-muted-foreground">Select an invoice from the queue to review.</div>
          )}
          {view === 'agents' && <AgentsView />}
          {view === 'rules' && <RulesEngine rules={rules} setRules={setRules} />}
          {view === 'concur' && <ConcurView invoices={invoices} onUpload={(id) => postToConcur(id)} />}
        </main>
      </div>
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onDone={handleUploadDone} />
      <ConcurPostDialog open={concurOpen} onOpenChange={setConcurOpen} invoice={selected} onDone={concurDone} />
    </div>
  )
}

export default App
