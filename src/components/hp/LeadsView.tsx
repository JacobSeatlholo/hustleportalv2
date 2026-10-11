'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { api, rands, randsPlain, STAGES, type Lead, type TopUpPack } from './shared'
import { useHp } from './store'
import {
  Plus, Upload, Sparkles, Loader2, Lock, Eye, Trash2, Phone, Mail, Globe, User,
  Search, RefreshCw, X, HandCoins, MapPin,
} from 'lucide-react'

export default function LeadsView() {
  const { session, loadSession, bumpRefresh } = useHp()
  const { toast } = useToast()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [scope, setScope] = useState<'all' | 'mine' | 'team'>('all')
  const [q, setQ] = useState('')

  // dialogs
  const [showAdd, setShowAdd] = useState(false)
  const [showDiscover, setShowDiscover] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [detail, setDetail] = useState<Lead | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await api<{ leads: Lead[] }>(`/api/leads?scope=${scope}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      setLeads(res.leads)
    } catch {
      toast({ title: 'Failed to load leads', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
     
  }, [scope])

  async function moveStage(lead: Lead, stage: string) {
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, stage } : l)))
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify({ stage }) })
      bumpRefresh()
    } catch {
      toast({ title: 'Could not move lead', variant: 'destructive' })
      load()
    }
  }

  async function reveal(lead: Lead) {
    try {
      const res = await api<{ lead: Lead; spent: number }>('/api/leads/reveal', {
        method: 'POST',
        body: JSON.stringify({ leadId: lead.id }),
      })
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? res.lead : l)))
      setDetail(res.lead)
      toast({ title: 'Contact revealed', description: `${rands(res.spent)} spent from your wallet` })
      loadSession()
    } catch (e) {
      const err = e as Error & { status?: number; data?: { price?: number } }
      if (err.status === 402) {
        toast({
          title: 'Not enough credits',
          description: `Revealing this contact costs ${rands(err.data?.price || 1500)}. Top up your wallet.`,
          variant: 'destructive',
          action: (
            <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent('hp:navigate', { detail: 'wallet' }))}>
              Top up
            </Button>
          ),
        })
      } else {
        toast({ title: 'Reveal failed', description: err.message, variant: 'destructive' })
      }
    }
  }

  const pipelineValue = leads.filter((l) => !['WON', 'LOST'].includes(l.stage)).reduce((a, l) => a + l.value, 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Leads &amp; Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            {leads.length} leads · {randsPlain(pipelineValue)} in play
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)}><Upload className="h-4 w-4 mr-1" /> Import CSV</Button>
          <Button onClick={() => setShowDiscover(true)} className="bg-sidebar hover:bg-sidebar/90 text-white">
            <Sparkles className="h-4 w-4 mr-1 text-brand" /> Find leads with AI
          </Button>
          <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> Quick capture</Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as 'kanban' | 'list')}>
          <TabsList>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="mine">Mine</TabsTrigger>
            {session?.team && <TabsTrigger value="team">{session.team.name}</TabsTrigger>}
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company…" className="pl-9" />
        </div>
        <Button variant="ghost" size="icon" onClick={load} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex gap-3 overflow-hidden">{[...Array(4)].map((_, i) => <Skeleton key={i} className="kanban-col h-72 rounded-xl" />)}</div>
      ) : view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto hp-scroll pb-3">
          {STAGES.map((s) => {
            const items = leads.filter((l) => l.stage === s.key)
            return (
              <div key={s.key} className="kanban-col shrink-0">
                <div className="flex items-center justify-between px-1 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${s.color}`} />
                    <span className="text-sm font-medium">{s.label}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">{items.length}</Badge>
                </div>
                <div className="space-y-2 min-h-[120px] max-h-[62vh] overflow-y-auto hp-scroll pr-1">
                  {items.map((l) => (
                    <LeadCard key={l.id} lead={l} onClick={() => setDetail(l)} />
                  ))}
                  {items.length === 0 && (
                    <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                      {s.key === 'NEW' ? 'Capture or import leads here' : 'Drop leads here'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {leads.map((l) => (
                <button key={l.id} className="w-full text-left p-4 hover:bg-muted/40 flex items-center gap-4" onClick={() => setDetail(l)}>
                  <div className="h-9 w-9 rounded-full bg-brand/15 text-brand flex items-center justify-center text-sm font-bold shrink-0">
                    {l.company.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm">{l.company}</div>
                    <div className="text-xs text-muted-foreground truncate">{l.city || 'SA'} · {l.industry || 'Business'} · {l.source}</div>
                  </div>
                  <Badge variant="outline" className="text-xs hidden sm:inline-flex">{STAGES.find((s) => s.key === l.stage)?.label}</Badge>
                  <span className="text-sm font-medium w-20 text-right">{l.value > 0 ? randsPlain(l.value) : '—'}</span>
                </button>
              ))}
              {leads.length === 0 && (
                <div className="p-10 text-center text-sm text-muted-foreground">No leads found.</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <AddLeadDialog open={showAdd} onOpenChange={setShowAdd} onSaved={() => { load(); bumpRefresh() }} />
      <DiscoverDialog open={showDiscover} onOpenChange={setShowDiscover} onSaved={() => { load(); bumpRefresh() }} />
      <ImportDialog open={showImport} onOpenChange={setShowImport} onSaved={() => { load(); bumpRefresh() }} />
      <LeadDetailDialog lead={detail} onOpenChange={(o) => !o && setDetail(null)} onReveal={() => reveal(detail!)} onMoved={(s) => detail && moveStage(detail, s)} onChanged={() => { load(); bumpRefresh() }} />
    </div>
  )
}

function LeadCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border bg-card p-3 shadow-sm hover:shadow-md hover:border-brand/60 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug">{lead.company}</span>
        {lead.value > 0 && <span className="text-xs font-semibold text-brand shrink-0">{randsPlain(lead.value)}</span>}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {lead.city || 'South Africa'}
      </div>
      <div className="mt-2 flex items-center gap-1 flex-wrap">
        <Badge variant="outline" className="text-[10px]">{lead.source}</Badge>
        {lead.industry && <Badge variant="secondary" className="text-[10px]">{lead.industry}</Badge>}
        {!lead.unlocked ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Lock className="h-3 w-3" /> locked</span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-600"><Eye className="h-3 w-3" /> revealed</span>
        )}
      </div>
    </button>
  )
}

function AddLeadDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { session } = useHp()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ company: '', contactName: '', email: '', phone: '', industry: '', city: '', value: '' })

  async function save() {
    if (!form.company.trim()) return
    setBusy(true)
    try {
      await api('/api/leads', {
        method: 'POST',
        body: JSON.stringify({ ...form, value: parseFloat(form.value) || 0, source: 'MANUAL', unlocked: Boolean(form.email || form.phone) }),
      })
      toast({ title: 'Lead captured' })
      setForm({ company: '', contactName: '', email: '', phone: '', industry: '', city: '', value: '' })
      onOpenChange(false)
      onSaved()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick capture</DialogTitle>
          <DialogDescription>Add a lead manually. Contact details you enter are free — no reveal cost.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Company *</Label><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Nkosi Brands" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Contact</Label><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Sipho Nkosi" /></div>
            <div className="space-y-1.5"><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Johannesburg" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Industry</Label><Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Deal value (R)</Label><Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
          </div>
          <Button onClick={save} disabled={busy || !form.company.trim()} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save lead'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface DiscoverResult {
  company: string
  contactName?: string
  industry?: string
  city?: string
  score?: number
}

function DiscoverDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { session } = useHp()
  const { toast } = useToast()
  const [definition, setDefinition] = useState('')
  const [city, setCity] = useState(session?.user.city || 'Johannesburg')
  const [limit, setLimit] = useState('10')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<DiscoverResult[]>([])
  const [mode, setMode] = useState<'LIVE' | 'DEMO'>('DEMO')
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  async function search() {
    if (!definition.trim()) return
    setBusy(true)
    setResults([])
    try {
      const res = await api<{ leads: DiscoverResult[]; mode: 'LIVE' | 'DEMO'; note?: string }>('/api/leads/discover', {
        method: 'POST',
        body: JSON.stringify({ definition, city, limit: parseInt(limit) }),
      })
      setResults(res.leads)
      setMode(res.mode)
      setNote(res.note || '')
      setSelected(new Set(res.leads.map((l) => l.company)))
    } catch (e) {
      toast({ title: 'Search failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function saveSelected() {
    setSaving(true)
    try {
      let added = 0
      for (const r of results) {
        if (!selected.has(r.company)) continue
        await api('/api/leads', {
          method: 'POST',
          body: JSON.stringify({ ...r, country: 'South Africa', source: 'EXPLEE' }),
        })
        added++
      }
      toast({ title: `${added} leads added to your pipeline` })
      onOpenChange(false)
      setResults([])
      setDefinition('')
      onSaved()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /> AI Lead Finder</DialogTitle>
          <DialogDescription>
            Describe who you want to sell to — the AI finds matching businesses.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Who is your ideal client?</Label>
            <Textarea
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder="e.g. coffee shops and restaurants that need social media management"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>City focus</Label>
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Johannesburg', 'Durban', 'Pretoria', 'Port Elizabeth', 'Anywhere in SA'].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>How many</Label>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['5', '10', '15', '20', '30'].map((n) => (
                    <SelectItem key={n} value={n}>{n} leads</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={search} disabled={busy || !definition.trim()} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            {busy ? 'Searching…' : 'Find leads'}
          </Button>

          {note && (
            <p className="text-xs text-muted-foreground bg-muted rounded-lg p-2">{note}</p>
          )}

          {results.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>{results.length} matches found</span>
                <Badge className={mode === 'LIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-brand/20 text-brand'}>
                  {mode === 'LIVE' ? 'Live verified data' : 'Demo data'}
                </Badge>
              </div>
              <div className="max-h-64 overflow-y-auto hp-scroll space-y-1.5">
                {results.map((r) => (
                  <label key={r.company} className="flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={selected.has(r.company)}
                      onChange={(e) => {
                        const next = new Set(selected)
                        if (e.target.checked) next.add(r.company)
                        else next.delete(r.company)
                        setSelected(next)
                      }}
                      className="h-4 w-4 accent-brand"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{r.company}</div>
                      <div className="text-xs text-muted-foreground">{r.industry || 'Business'} · {r.city || 'SA'}</div>
                    </div>
                    {r.score != null && <Badge variant="outline" className="text-[10px]">fit {r.score}/5</Badge>}
                  </label>
                ))}
              </div>
              <Button onClick={saveSelected} disabled={saving || selected.size === 0} className="w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Add ${selected.size} leads to pipeline`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ImportDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; total: number } | null>(null)

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => setCsv(String(reader.result || ''))
    reader.readAsText(file)
  }

  async function doImport() {
    setBusy(true)
    setResult(null)
    try {
      const res = await api<{ imported: number; skipped: number; total: number }>('/api/leads/import', {
        method: 'POST',
        body: JSON.stringify({ csv }),
      })
      setResult(res)
      if (res.imported > 0) {
        toast({ title: `Imported ${res.imported} leads` })
        onSaved()
      } else {
        toast({ title: 'Nothing imported', description: 'Check that your file has a company/name column.', variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: 'Import failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Import your database</DialogTitle>
          <DialogDescription>
            Upload or paste CSV. Recognised columns: company/name, contact, email, phone, city, industry, value. Rows with contacts are free (no reveal cost).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block rounded-xl border-2 border-dashed p-6 text-center cursor-pointer hover:border-brand transition">
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="text-sm mt-2 font-medium">Choose a CSV file</p>
            <p className="text-xs text-muted-foreground">or paste below</p>
          </label>
          <Textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={5}
            placeholder={'Company,Contact,Email,Phone,City\nNkosi Brands,Sipho,sipho@nkosi.co.za,074 000 0000,Johannesburg'}
            className="font-mono text-xs"
          />
          <Button onClick={doImport} disabled={busy || !csv.trim()} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Import leads'}
          </Button>
          {result && (
            <p className="text-sm text-center">
              <span className="text-emerald-600 font-medium">{result.imported} imported</span>
              {result.skipped > 0 && <span className="text-muted-foreground"> · {result.skipped} skipped (no company column)</span>}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LeadDetailDialog({ lead, onOpenChange, onReveal, onMoved, onChanged }: {
  lead: Lead | null
  onOpenChange: (o: boolean) => void
  onReveal: () => void
  onMoved: (stage: string) => void
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [value, setValue] = useState('')
  const [notes, setNotes] = useState('')
  const [revealing, setRevealing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (lead) {
      setValue(String(lead.value || ''))
      setNotes(lead.notes || '')
    }
  }, [lead])

  if (!lead) return null
  const stageIdx = STAGES.findIndex((s) => s.key === lead.stage)

  async function saveEdits() {
    try {
      await api(`/api/leads/${lead!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ value: parseFloat(value) || 0, notes }),
      })
      toast({ title: 'Lead updated' })
      onChanged()
      onOpenChange(false)
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await api(`/api/leads/${lead!.id}`, { method: 'DELETE' })
      toast({ title: 'Lead deleted' })
      onChanged()
      onOpenChange(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={Boolean(lead)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{lead.company}</DialogTitle>
          <DialogDescription>
            {lead.industry || 'Business'} · {lead.city || 'South Africa'} · from {lead.source}
            {lead.score != null && ` · fit ${lead.score}/5`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* contact block */}
          {lead.unlocked ? (
            <div className="rounded-xl border bg-card p-3 space-y-2 text-sm">
              <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /> {lead.contactName || '—'}</div>
              <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> <a className="text-brand hover:underline" href={`mailto:${lead.email}`}>{lead.email || '—'}</a></div>
              <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> <a className="text-brand hover:underline" href={`tel:${lead.phone}`}>{lead.phone || '—'}</a></div>
              {lead.website && <div className="flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" /> {lead.website}</div>}
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-brand/40 bg-brand/5 p-4 text-center space-y-2">
              <Lock className="h-5 w-5 mx-auto text-brand" />
              <p className="text-sm font-medium">Contact details locked</p>
              <p className="text-xs text-muted-foreground">Reveal email &amp; phone using wallet credits. CSV/manual leads are always free.</p>
              <Button onClick={() => { setRevealing(true); onReveal() }} disabled={revealing} size="sm" className="bg-sidebar hover:bg-sidebar/90 text-white">
                {revealing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <HandCoins className="h-4 w-4 mr-1" />}
                Reveal contact
              </Button>
            </div>
          )}

          {/* stage stepper */}
          <div>
            <Label className="text-xs text-muted-foreground">Pipeline stage</Label>
            <div className="mt-1.5 flex items-center gap-1">
              {STAGES.map((s, i) => (
                <button
                  key={s.key}
                  onClick={() => onMoved(s.key)}
                  title={s.label}
                  className={`h-2 flex-1 rounded-full transition ${i <= stageIdx ? s.color : 'bg-muted'} hover:opacity-80`}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>New</span><span>Won</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Deal value (R)</Label>
              <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Created</Label>
              <Input disabled value={new Date(lead.createdAt).toLocaleDateString('en-ZA')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What did you discuss? Next step?" />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={remove} disabled={deleting} className="text-red-600 hover:text-red-700">
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button onClick={saveEdits} className="flex-1">Save changes</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
