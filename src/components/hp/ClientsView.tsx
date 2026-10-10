'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api, rands } from './shared'
import { useHp } from './store'
import { Plus, Search, Loader2, Users, Pencil, Trash2, Mail, Phone, Building2, TrendingUp, MessageCircle } from 'lucide-react'

interface Client {
  id: string
  name: string
  company: string | null
  email: string | null
  phone: string | null
  notes: string | null
  monthlyValue: number
  status: string // ACTIVE | CHURNED
  createdAt: string
}

const EMPTY = { name: '', company: '', email: '', phone: '', monthlyValue: '', status: 'ACTIVE', notes: '' }

export default function ClientsView() {
  const { bumpRefresh } = useHp()
  const { toast } = useToast()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    try {
      const data = await api<{ clients: Client[] }>('/api/clients')
      setClients(data.clients)
    } catch {
      toast({ title: 'Failed to load clients', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(
    () =>
      clients.filter((c) => {
        if (statusFilter !== 'ALL' && c.status !== statusFilter) return false
        if (!query.trim()) return true
        const q = query.toLowerCase()
        return [c.name, c.company, c.email, c.phone].some((v) => (v || '').toLowerCase().includes(q))
      }),
    [clients, query, statusFilter]
  )

  const kpis = useMemo(() => {
    const active = clients.filter((c) => c.status === 'ACTIVE')
    return {
      total: clients.length,
      active: active.length,
      mrr: active.reduce((a, c) => a + (Number(c.monthlyValue) || 0), 0),
    }
  }, [clients])

  function openAdd() {
    setEditing(null)
    setForm(EMPTY)
    setDialogOpen(true)
  }

  function openEdit(c: Client) {
    setEditing(c)
    setForm({
      name: c.name,
      company: c.company || '',
      email: c.email || '',
      phone: c.phone || '',
      monthlyValue: c.monthlyValue ? String(c.monthlyValue) : '',
      status: c.status,
      notes: c.notes || '',
    })
    setDialogOpen(true)
  }

  async function save() {
    if (!form.name.trim()) {
      toast({ title: 'Client name is required.', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        company: form.company,
        email: form.email,
        phone: form.phone,
        monthlyValue: Number(form.monthlyValue) || 0,
        status: form.status,
        notes: form.notes,
      }
      if (editing) {
        await api(`/api/clients/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        toast({ title: 'Client updated' })
      } else {
        await api('/api/clients', { method: 'POST', body: JSON.stringify(payload) })
        toast({ title: 'Client added', description: `${form.name} is now in your CRM.` })
      }
      setDialogOpen(false)
      await load()
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function remove(c: Client) {
    setDeletingId(c.id)
    try {
      await api(`/api/clients/${c.id}`, { method: 'DELETE' })
      toast({ title: 'Client removed' })
      await load()
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Clients</h1>
          <p className="text-sm text-muted-foreground">Your CRM — everyone you do business with, in one place.</p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1.5" /> Add Client
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total clients', value: String(kpis.total), icon: <Users className="h-4 w-4 text-brand" /> },
          { label: 'Active', value: String(kpis.active), icon: <Building2 className="h-4 w-4 text-emerald-400" /> },
          { label: 'Monthly value', value: rands(Math.round(kpis.mrr * 100)), icon: <TrendingUp className="h-4 w-4 text-brand" /> },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                {k.icon}
                {k.label}
              </div>
              <div className="font-display text-xl">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, company, email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Tabs2 value={statusFilter} onChange={setStatusFilter} />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Users className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">
              {clients.length === 0
                ? 'No clients yet. Add your first client to start building your CRM.'
                : 'No clients match your search.'}
            </p>
            {clients.length === 0 && (
              <Button onClick={openAdd} variant="outline" size="sm" className="mt-1">
                <Plus className="h-4 w-4 mr-1" /> Add your first client
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <Card key={c.id} className="hover:border-brand/50 transition-colors">
              <CardContent className="p-4 flex flex-wrap items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${c.status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.company && <span className="text-sm text-muted-foreground">· {c.company}</span>}
                    {c.status === 'ACTIVE'
                      ? <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15 border-0">Active</Badge>
                      : <Badge variant="secondary">Churned</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                    {c.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
                    {c.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}
                    {c.monthlyValue > 0 && (
                      <span className="flex items-center gap-1 text-brand font-medium">
                        {rands(Math.round(c.monthlyValue * 100))}/mo
                      </span>
                    )}
                  </div>
                  {c.notes && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{c.notes}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {c.phone && (
                    <Button variant="ghost" size="icon" asChild title="WhatsApp">
                      <a href={`https://wa.me/${c.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => openEdit(c)} title="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(c)} disabled={deletingId === c.id} title="Delete">
                    {deletingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-400" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit client' : 'Add client'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update this client\'s details.' : 'Log a new client or prospect in your CRM.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Name *</Label>
              <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Thandi Mokoena" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-company">Company</Label>
                <Input id="c-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-value">Monthly value (R)</Label>
                <Input id="c-value" type="number" min="0" value={form.monthlyValue} onChange={(e) => setForm({ ...form, monthlyValue: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-email">Email</Label>
                <Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-phone">Phone</Label>
                <Input id="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+27…" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="CHURNED">Churned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-notes">Notes</Label>
              <Input id="c-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What are you doing for them?" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {editing ? 'Save changes' : 'Add client'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Tabs2({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-lg border overflow-hidden shrink-0">
      {['ALL', 'ACTIVE', 'CHURNED'].map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`px-3 py-2 text-xs font-medium transition-colors ${
            value === s ? 'bg-brand text-black' : 'bg-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {s === 'ALL' ? 'All' : s === 'ACTIVE' ? 'Active' : 'Churned'}
        </button>
      ))}
    </div>
  )
}
