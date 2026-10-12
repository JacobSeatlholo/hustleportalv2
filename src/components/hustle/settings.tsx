'use client'

import { CURRENCIES, ErrorState, LoadingRows } from '@/components/hustle/kit'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { apiFetch, useResource } from '@/lib/hooks'
import { Building2, Save } from 'lucide-react'
import { useEffect, useState } from 'react'

type Settings = {
  id: string; businessName: string; ownerName: string; email: string; phone: string
  currency: string; taxRate: number; invoicePrefix: string; invoiceCounter: number
  paymentTerms: number
}

export function SettingsView({ onSaved }: { onSaved: () => void }) {
  const settingsRes = useResource<Settings>('/api/settings')
  const { toast } = useToast()
  const [form, setForm] = useState<Partial<Settings>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settingsRes.data) {
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = settingsRes.data
      setForm(rest)
    }
  }, [settingsRes.data])

  async function save() {
    setSaving(true)
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ...form,
          taxRate: Number(form.taxRate) || 0,
          invoiceCounter: Number(form.invoiceCounter) || 1,
          paymentTerms: Number(form.paymentTerms) || 0,
        }),
      })
      toast({ title: 'Settings saved' })
      settingsRes.refresh()
      onSaved()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (settingsRes.loading) return <LoadingRows rows={6} />
  if (settingsRes.error || !settingsRes.data) return <ErrorState message={settingsRes.error ?? 'Failed to load settings'} onRetry={settingsRes.refresh} />

  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" aria-hidden /> Business profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="s-biz">Business name</Label>
              <Input id="s-biz" value={form.businessName ?? ''} onChange={set('businessName')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="s-owner">Owner</Label>
              <Input id="s-owner" value={form.ownerName ?? ''} onChange={set('ownerName')} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="s-email">Email</Label>
              <Input id="s-email" type="email" value={form.email ?? ''} onChange={set('email')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="s-phone">Phone</Label>
              <Input id="s-phone" value={form.phone ?? ''} onChange={set('phone')} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoicing</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Currency</Label>
              <Select value={form.currency ?? 'USD'} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="s-tax">Default tax %</Label>
              <Input id="s-tax" type="number" min="0" step="0.1" value={form.taxRate ?? 0} onChange={set('taxRate')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="s-terms">Payment terms (days)</Label>
              <Input id="s-terms" type="number" min="0" value={form.paymentTerms ?? 14} onChange={set('paymentTerms')} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="s-prefix">Invoice prefix</Label>
              <Input id="s-prefix" value={form.invoicePrefix ?? ''} onChange={set('invoicePrefix')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="s-counter">Next invoice number</Label>
              <Input id="s-counter" type="number" min="1" value={form.invoiceCounter ?? 1} onChange={set('invoiceCounter')} />
              <p className="text-xs text-muted-foreground">Next invoice will be {form.invoicePrefix ?? 'INV-'}{String(form.invoiceCounter ?? 1).padStart(4, '0')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Save className="mr-1.5 h-4 w-4" aria-hidden /> {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </div>
  )
}
