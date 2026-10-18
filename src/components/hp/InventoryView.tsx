'use client'

/**
 * Inventory — stock management for businesses that sell things.
 * Add items, adjust quantities in one tap, see stock value and low-stock alerts.
 */
import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api, randsPlain } from './shared'
import { useHp } from './store'
import { usePlan, requestUpgrade } from './useUpgrade'
import { toCSV } from '@/lib/csv'
import { Plus, Loader2, Trash2, Boxes, Minus, AlertTriangle, Sparkles, Upload, Download } from 'lucide-react'

interface ImportReport {
  imported: number
  duplicates: number
  invalid: number
  limitHeld?: number
  total: number
  duplicateSamples?: string[]
  invalidSamples?: string[]
}

/**
 * ImportDialog — bring an existing stock list in: upload or paste CSV.
 * Recognised columns: name/item/product, sku/code, quantity/qty, unit,
 * cost, sell/price, low stock/reorder, notes. Duplicates are reported, not doubled.
 */
function ImportDialog({ open, onOpenChange, onImported }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onImported: () => void
}) {
  const { toast } = useToast()
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)

  function readFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => setCsv(String(reader.result || ''))
    reader.readAsText(f)
  }

  async function run() {
    if (!csv.trim()) {
      toast({ title: 'Nothing to import yet', description: 'Upload a file or paste the CSV first.' })
      return
    }
    setBusy(true)
    setReport(null)
    try {
      const res = await api<ImportReport>('/api/inventory/import', { method: 'POST', body: JSON.stringify({ csv }) })
      setReport(res)
      onImported()
    } catch (e) {
      toast({ title: 'Import failed', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4 text-brand" /> Import your stock list</DialogTitle>
          <DialogDescription>
            Upload or paste CSV. Recognised columns: name, sku, quantity, unit, cost, sell price, low stock alert, notes. Duplicates are skipped and reported, never double counted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f) }} />
          <Textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Name,Quantity,Unit,Cost,Sell\nParaffin 750ml,12,bottles,12,18'} />
          <Button onClick={run} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import stock
          </Button>
          {report && (
            <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
              <p className="font-medium">{report.imported} imported · {report.duplicates} duplicates skipped · {report.invalid} invalid rows</p>
              {!!report.limitHeld && <p className="text-amber-500">{report.limitHeld} rows held back by the free plan ceiling.</p>}
              {!!report.duplicateSamples?.length && <p className="text-muted-foreground">Duplicates: {report.duplicateSamples.join(', ')}</p>}
              {!!report.invalidSamples?.length && <p className="text-muted-foreground">Invalid: {report.invalidSamples.join(', ')}</p>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface Item {
  id: string
  name: string
  sku: string | null
  quantity: number
  unit: string | null
  costPrice: number
  sellPrice: number
  lowStockAt: number
  notes: string | null
}

interface Totals {
  count: number
  stockValue: number
  retailValue: number
  lowCount: number
}

const EMPTY = { name: '', sku: '', quantity: '', unit: '', costPrice: '', sellPrice: '', lowStockAt: '', notes: '' }

export default function InventoryView() {
  const { bumpRefresh } = useHp()
  const { toast } = useToast()
  const { paid } = usePlan()
  const [items, setItems] = useState<Item[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ items: Item[]; totals: Totals }>('/api/inventory')
      setItems(res.items)
      setTotals(res.totals)
    } catch {
      toast({ title: 'Failed to load inventory', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  async function addItem() {
    if (!form.name.trim()) return
    setBusy(true)
    try {
      await api('/api/inventory', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          sku: form.sku,
          quantity: parseFloat(form.quantity) || 0,
          unit: form.unit,
          costPrice: parseFloat(form.costPrice) || 0,
          sellPrice: parseFloat(form.sellPrice) || 0,
          lowStockAt: parseFloat(form.lowStockAt) || 0,
          notes: form.notes,
        }),
      })
      toast({ title: `${form.name.trim()} added to stock` })
      setForm({ ...EMPTY })
      setShowAdd(false)
      load()
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Could not add item', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function adjust(item: Item, delta: number) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)))
    try {
      await api('/api/inventory', { method: 'PATCH', body: JSON.stringify({ id: item.id, adjust: delta }) })
      bumpRefresh()
    } catch {
      load()
    }
  }

  async function remove(item: Item) {
    try {
      await api(`/api/inventory?id=${item.id}`, { method: 'DELETE' })
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      toast({ title: 'Item removed' })
    } catch {
      toast({ title: 'Could not remove item', variant: 'destructive' })
    }
  }

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  const [showImport, setShowImport] = useState(false)

  function exportCsv() {
    const csv = toCSV(
      items.map((i) => ({
        name: i.name, sku: i.sku || '', quantity: i.quantity, unit: i.unit || '',
        cost: i.costPrice, sell: i.sellPrice, lowStockAt: i.lowStockAt, notes: i.notes || '',
      })),
      ['name', 'sku', 'quantity', 'unit', 'cost', 'sell', 'lowStockAt', 'notes'],
    )
    const url = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    const a = document.createElement('a')
    a.href = url
    a.download = 'hustleportal-inventory.csv'
    a.click()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            {totals ? `${totals.count} items${totals.lowCount ? ` · ${totals.lowCount} running low` : ''}` : 'Your stock, counted'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)}><Upload className="h-4 w-4 mr-1 text-brand" /> Import CSV</Button>
          {items.length > 0 && (
            <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
          )}
          <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> Add item</Button>
        </div>
      </div>

      {/* Free plan slot meter — honest countdown, one tap to the plans. The server
          enforces the same number; this just makes the ceiling visible before it bites. */}
      {!paid && (
        <div className="rounded-lg border border-brand/30 bg-brand/5 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium">
              {totals ? `${Math.max(0, 3 - totals.count)} of 3 free stock slots open` : 'Free plan tracks 3 stock items'}
            </p>
            <p className="text-xs text-muted-foreground">
              Operator watches your whole stockroom, with low stock alerts and live stock value.
            </p>
          </div>
          <Button size="sm" variant="outline" className="border-brand/50" onClick={() => requestUpgrade('inventory')}>
            <Sparkles className="h-3.5 w-3.5 mr-1 text-brand" /> See Operator
          </Button>
        </div>
      )}

      {totals && totals.count > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Stock value (cost)</p>
            <p className="text-xl font-semibold">{randsPlain(totals.stockValue)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Retail value</p>
            <p className="text-xl font-semibold text-emerald-600">{randsPlain(totals.retailValue)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Low stock</p>
            <p className={`text-xl font-semibold ${totals.lowCount ? 'text-amber-500' : ''}`}>{totals.lowCount}</p>
          </CardContent></Card>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center space-y-2">
            <Boxes className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">No stock items yet</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Add what you sell — Paraffin 750ml, Airtime R10, Maize 5kg — and keep counts honest with one-tap adjustments.
            </p>
            <Button onClick={() => setShowAdd(true)} className="mt-2"><Plus className="h-4 w-4 mr-1" /> Add your first item</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((i) => {
            const low = i.lowStockAt > 0 && i.quantity <= i.lowStockAt
            return (
              <Card key={i.id} className={low ? 'border-amber-500/50' : ''}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{i.name}</span>
                      {low && <Badge variant="destructive" className="text-[10px] h-4"><AlertTriangle className="h-3 w-3 mr-0.5" />Low</Badge>}
                      {i.sku && <span className="text-[10px] text-muted-foreground">{i.sku}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {i.sellPrice > 0 ? `Sells at ${randsPlain(i.sellPrice)}` : 'No sell price'}
                      {i.sellPrice > 0 && i.costPrice > 0 && ` · margin ${randsPlain(i.sellPrice - i.costPrice)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => adjust(i, -1)} aria-label={`Remove one ${i.name}`}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <div className={`text-center w-16 ${low ? 'text-amber-500 font-semibold' : 'font-semibold'}`}>
                      {fmt(i.quantity)}<span className="text-[10px] text-muted-foreground">{i.unit ? ` ${i.unit}` : ''}</span>
                    </div>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => adjust(i, 1)} aria-label={`Add one ${i.name}`}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600 shrink-0 h-8 w-8" onClick={() => remove(i)} aria-label={`Delete ${i.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ImportDialog open={showImport} onOpenChange={setShowImport} onImported={() => { load(); bumpRefresh() }} />

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add stock item</DialogTitle>
            <DialogDescription>Keep it simple — name and quantity are enough to start.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Item name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Paraffin 750ml" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="12" /></div>
              <div className="space-y-1.5"><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="bottles" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Cost (R)</Label><Input type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} placeholder="12" /></div>
              <div className="space-y-1.5"><Label>Sell (R)</Label><Input type="number" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} placeholder="18" /></div>
              <div className="space-y-1.5"><Label>Low at</Label><Input type="number" value={form.lowStockAt} onChange={(e) => setForm({ ...form, lowStockAt: e.target.value })} placeholder="3" /></div>
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Supplier, where it's stored…" /></div>
            <Button onClick={addItem} disabled={busy || !form.name.trim()} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add item'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
