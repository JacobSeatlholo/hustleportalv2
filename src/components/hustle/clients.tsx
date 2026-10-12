'use client'

import { EmptyState, ErrorState, LoadingRows, StatusBadge, fmtDate } from '@/components/hustle/kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiFetch, useResource } from '@/lib/hooks'
import { Building2, Mail, Pencil, Phone, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'

type Client = {
  id: string; name: string; company: string | null; email: string | null
  phone: string | null; status: string; tags: string; notes: string | null
  createdAt: string
  _count: { projects: number; invoices: number; tasks: number; timeEntries: number }
}

const EMPTY = { name: '', company: '', email: '', phone: '', status: 'LEAD', tags: '', notes: '' }

export function ClientsView() {
  const { data, loading, error, refresh } = useResource<Client[]>('/api/clients')
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('ALL')

  const clients = (data ?? []).filter((c) => filter === 'ALL' || c.status === filter)

  function startCreate() {
    setEditing(null)
    setForm({ ...EMPTY })
    setOpen(true)
  }

  function startEdit(c: Client) {
    setEditing(c)
    setForm({
      name: c.name, company: c.company ?? '', email: c.email ?? '', phone: c.phone ?? '',
      status: c.status, tags: c.tags, notes: c.notes ?? '',
    })
    setOpen(true)
  }

  async function save() {
    if (!form.name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await apiFetch(editing ? `/api/clients/${editing.id}` : '/api/clients', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      })
      toast({ title: editing ? 'Client updated' : 'Client added', description: form.name })
      setOpen(false)
      refresh()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function remove(c: Client) {
    if (!confirm(`Delete ${c.name}? Their invoices and projects will be kept.`)) return
    try {
      await apiFetch(`/api/clients/${c.id}`, { method: 'DELETE' })
      toast({ title: 'Client deleted', description: c.name })
      refresh()
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-36" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All clients</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="LEAD">Leads</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{clients.length} shown</span>
        </div>
        <Button onClick={startCreate}><Plus className="mr-1.5 h-4 w-4" aria-hidden /> New client</Button>
      </div>

      {loading ? <LoadingRows rows={6} /> : error ? <ErrorState message={error} onRetry={refresh} /> : clients.length === 0 ? (
        <EmptyState icon={Users} title="No clients yet" hint="Add your first client to start invoicing and tracking projects." />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="hidden md:table-cell">Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Work</TableHead>
                    <TableHead className="hidden sm:table-cell">Since</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <p className="font-medium">{c.name}</p>
                        {c.company ? <p className="flex items-center gap-1 text-xs text-muted-foreground"><Building2 className="h-3 w-3" aria-hidden /> {c.company}</p> : null}
                        {c.tags ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {c.tags.split(',').filter(Boolean).map((t) => (
                              <Badge key={t} variant="secondary" className="px-1.5 py-0 text-[10px]">{t.trim()}</Badge>
                            ))}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {c.email ? <p className="flex items-center gap-1 text-xs"><Mail className="h-3 w-3 text-muted-foreground" aria-hidden /> {c.email}</p> : null}
                        {c.phone ? <p className="flex items-center gap-1 text-xs"><Phone className="h-3 w-3 text-muted-foreground" aria-hidden /> {c.phone}</p> : null}
                        {!c.email && !c.phone ? <span className="text-xs text-muted-foreground">—</span> : null}
                      </TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {c._count.projects} projects · {c._count.invoices} invoices
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{fmtDate(c.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(c)} aria-label={`Edit ${c.name}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit client' : 'New client'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="c-name">Name *</Label>
              <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="c-company">Company</Label>
                <Input id="c-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Inc" />
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LEAD">Lead</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="c-email">Email</Label>
                <Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@acme.com" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-phone">Phone</Label>
                <Input id="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-tags">Tags (comma separated)</Label>
              <Input id="c-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="retainer, web" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-notes">Notes</Label>
              <Textarea id="c-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Preferences, context, anything useful…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add client'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
