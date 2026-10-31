'use client'

/**
 * Inventory, stock management for businesses that sell things.
 * Add items, adjust quantities in one tap, see stock value and low-stock alerts.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { photoToDataUrl, fetchCutout } from '@/lib/photoPolish'
import { Plus, Loader2, Trash2, Boxes, Minus, AlertTriangle, Sparkles, Upload, Download, Camera, X } from 'lucide-react'

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
 * ImportDialog, bring an existing stock list in: upload or paste CSV.
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

/**
 * Product photo intake: guard the file, then hand it to photoPolish which
 * brightens, sharpens, square crops and (opt in) cuts the background on the
 * phone, and comes back with a small 256px JPEG data URL the row can carry.
 * polish=false keeps the plain downscale, the user can always have the
 * original back.
 */
async function processImage(file: File, opts?: { polish?: boolean; cutout?: Blob | null }): Promise<string> {
  if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
    throw new Error('format')
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('size')
  }
  return photoToDataUrl(file, opts)
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
  supplier: string | null
  location: string | null
  image: string | null
  notes: string | null
}

interface Totals {
  count: number
  stockValue: number
  retailValue: number
  lowCount: number
}

const EMPTY = { name: '', sku: '', quantity: '', unit: '', costPrice: '', sellPrice: '', lowStockAt: '', supplier: '', location: '', notes: '' }
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
  const [newImage, setNewImage] = useState<string | null>(null)
  // Photo polish state: the raw file is kept so the toggles re-run the
  // pipeline without asking for the picture again. The cut out blob is cached
  // so switching polish on and off never re-downloads the model.
  const [newRaw, setNewRaw] = useState<File | null>(null)
  const [polishOn, setPolishOn] = useState(true)
  const [cutOn, setCutOn] = useState(false)
  const [cutBlob, setCutBlob] = useState<Blob | null>(null)
  const [cutBusy, setCutBusy] = useState(false)
  const applySeq = useRef(0)
  const rowPhotoRef = useRef<HTMLInputElement>(null)
  const rowPhotoTarget = useRef<string | null>(null)
  const addPhotoRef = useRef<HTMLInputElement>(null)

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
          supplier: form.supplier,
          location: form.location,
          image: newImage || '',
          notes: form.notes,
        }),
      })
      toast({ title: `${form.name.trim()} added to stock` })
      setForm({ ...EMPTY })
      clearNewImage()
      setShowAdd(false)
      load()
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Could not add item', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  // Product photos: attach at create time, or tap the camera on a row to set
  // or replace one on an item that already exists. Clearing is one tap on the X.
  // Polish runs by default; the add dialog shows the toggles so the user can
  // switch it off or cut the background. A sequence counter keeps a slow run
  // from overwriting a newer decision.
  async function applyNewImage(f: File, opts: { polish: boolean; cutout: Blob | null }) {
    const seq = ++applySeq.current
    try {
      const url = await processImage(f, opts)
      if (applySeq.current === seq) setNewImage(url)
    } catch {
      if (applySeq.current === seq) {
        toast({ title: 'That picture did not make it in', description: 'Use a PNG, JPG or WebP photo. Keep it under 12 megabytes.', variant: 'destructive' })
      }
    }
  }

  function onNewImageFile(f: File | undefined | null) {
    if (!f) return
    setNewRaw(f)
    setPolishOn(true)
    setCutOn(false)
    setCutBlob(null)
    applyNewImage(f, { polish: true, cutout: null })
  }

  function togglePolish(on: boolean) {
    setPolishOn(on)
    if (newRaw) applyNewImage(newRaw, { polish: on, cutout: cutOn ? cutBlob : null })
  }

  async function toggleCut(on: boolean) {
    setCutOn(on)
    if (!newRaw) return
    if (!on) {
      setCutBlob(null)
      applyNewImage(newRaw, { polish: polishOn, cutout: null })
      return
    }
    setCutBusy(true)
    try {
      const b = await fetchCutout(newRaw)
      if (b) {
        setCutBlob(b)
        applyNewImage(newRaw, { polish: polishOn, cutout: b })
      } else {
        setCutOn(false)
        toast({ title: 'Could not cut the background', description: 'The photo keeps its original background. Everything else still applies.' })
      }
    } finally {
      setCutBusy(false)
    }
  }

  function clearNewImage() {
    applySeq.current++ // a pending run must not resurrect the picture
    setNewImage(null)
    setNewRaw(null)
    setCutBlob(null)
    setCutOn(false)
    setPolishOn(true)
  }

  async function onRowImageFile(f: File | undefined | null) {
    const id = rowPhotoTarget.current
    if (!f || !id) return
    try {
      const image = await processImage(f, { polish: true })
      const res = await api<{ item: Item }>('/api/inventory', { method: 'PATCH', body: JSON.stringify({ id, image }) })
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, image: res.item.image } : i)))
      toast({ title: 'Photo saved', description: 'Brightened, sharpened and square cropped on your phone.' })
    } catch {
      toast({ title: 'Could not save that photo', description: 'Use a PNG, JPG or WebP photo, under 12 megabytes.', variant: 'destructive' })
    }
  }

  async function clearImage(item: Item) {
    try {
      await api('/api/inventory', { method: 'PATCH', body: JSON.stringify({ id: item.id, image: '' }) })
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, image: null } : i)))
    } catch {
      toast({ title: 'Could not remove the photo', variant: 'destructive' })
    }
  }

  // Type the exact count instead of tapping plus one at a time.
  const [qtyEdit, setQtyEdit] = useState<{ id: string; value: string } | null>(null)

  async function setExact(item: Item, value: string) {
    const n = parseFloat(value)
    setQtyEdit(null)
    if (!Number.isFinite(n) || n < 0 || n === item.quantity) return
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, quantity: n } : i)))
    try {
      await api('/api/inventory', { method: 'PATCH', body: JSON.stringify({ id: item.id, quantity: n }) })
      bumpRefresh()
    } catch {
      load()
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

      {/* Free plan slot meter, honest countdown, one tap to the plans. The server
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
              Add what you sell, Paraffin 750ml, Airtime R10, Maize 5kg. Keep counts honest: tap the number to type the exact stock, or use the plus and minus buttons.
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
                  {i.image ? (
                    <div className="relative shrink-0">
                      { }
                      <img src={i.image} alt={i.name} className="h-11 w-11 rounded-lg object-cover border" />
                      <button
                        type="button"
                        aria-label={`Remove photo of ${i.name}`}
                        onClick={() => clearImage(i)}
                        className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-background border flex items-center justify-center text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Add photo of ${i.name}`}
                      title="Add a product photo"
                      onClick={() => { rowPhotoTarget.current = i.id; rowPhotoRef.current?.click() }}
                      className="h-11 w-11 shrink-0 rounded-lg border border-dashed flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-brand/60 transition"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{i.name}</span>
                      {low && <Badge variant="destructive" className="text-[10px] h-4"><AlertTriangle className="h-3 w-3 mr-0.5" />Low</Badge>}
                      {i.sku && <span className="text-[10px] text-muted-foreground">{i.sku}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {i.sellPrice > 0 ? `Sells at ${randsPlain(i.sellPrice)}` : 'No sell price'}
                      {i.sellPrice > 0 && i.costPrice > 0 && ` · margin ${randsPlain(i.sellPrice - i.costPrice)}`}
                      {i.supplier ? ` · supplier ${i.supplier}` : ''}
                      {i.location ? ` · ${i.location}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => adjust(i, -1)} aria-label={`Remove one ${i.name}`}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <div className={`text-center w-16 ${low ? 'text-amber-500 font-semibold' : 'font-semibold'}`}>
                      {qtyEdit?.id === i.id ? (
                        <input
                          autoFocus
                          type="number"
                          min={0}
                          step="any"
                          className="w-14 rounded border bg-background px-1 text-sm"
                          value={qtyEdit.value}
                          onChange={(e) => setQtyEdit({ id: i.id, value: e.target.value })}
                          onBlur={() => setExact(i, qtyEdit.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setExact(i, qtyEdit.value)
                            if (e.key === 'Escape') setQtyEdit(null)
                          }}
                        />
                      ) : (
                        <button title="Tap to type the exact count" onClick={() => setQtyEdit({ id: i.id, value: String(i.quantity) })}>
                          {fmt(i.quantity)}<span className="text-[10px] text-muted-foreground">{i.unit ? ` ${i.unit}` : ''}</span>
                        </button>
                      )}
                    </div>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => adjust(i, 1)} aria-label={`Add one ${i.name}`}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {i.image ? (
                    <button
                      type="button"
                      aria-label={`Replace photo of ${i.name}`}
                      title="Replace the photo"
                      onClick={() => { rowPhotoTarget.current = i.id; rowPhotoRef.current?.click() }}
                      className="text-muted-foreground hover:text-foreground shrink-0 h-8 w-8 flex items-center justify-center rounded hover:bg-muted"
                    >
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
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

      {/* hidden photo input, shared by the add dialog and the row camera buttons */}
      <input
        ref={rowPhotoRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          if (rowPhotoTarget.current) onRowImageFile(e.target.files?.[0])
          else onNewImageFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add stock item</DialogTitle>
            <DialogDescription>Name and quantity are enough to start. SKU, supplier and location are there when you need them.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Product photo</Label>
              {newImage ? (
                <div className="flex items-center gap-2.5 rounded-lg border p-2">
                  { }
                  <img src={newImage} alt="Product preview" className="h-11 w-11 rounded-lg object-cover border" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-muted-foreground block">It shows on the stock row.</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <button
                        type="button"
                        aria-pressed={polishOn}
                        title="Brighten, sharpen and square crop, on your phone"
                        onClick={() => togglePolish(!polishOn)}
                        className={`rounded-full border px-2 py-0.5 text-[11px] transition ${polishOn ? 'border-brand/60 bg-brand/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        Polish {polishOn ? 'on' : 'off'}
                      </button>
                      <button
                        type="button"
                        aria-pressed={cutOn}
                        disabled={cutBusy}
                        title="Cut the product out onto a clean studio backdrop. First use downloads a small model, then it is cached."
                        onClick={() => toggleCut(!cutOn)}
                        className={`rounded-full border px-2 py-0.5 text-[11px] transition inline-flex items-center gap-1 disabled:opacity-60 ${cutOn ? 'border-brand/60 bg-brand/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {cutBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                        {cutBusy ? 'Cutting out' : 'Cut out background'}
                      </button>
                    </div>
                  </div>
                  <button type="button" aria-label="Remove the photo" onClick={clearNewImage} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { rowPhotoTarget.current = null; addPhotoRef.current?.click() }}
                  className="w-full flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground hover:border-brand/60 hover:text-foreground transition"
                >
                  <Camera className="h-4 w-4" /> Add a product photo. Optional, it shows on the stock row.
                </button>
              )}
              <input
                ref={addPhotoRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => { onNewImageFile(e.target.files?.[0]); e.target.value = '' }}
              />
            </div>
            <div className="space-y-1.5"><Label>Item name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Paraffin 750ml" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Quantity in stock</Label><Input type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="12" /></div>
              <div className="space-y-1.5"><Label>Unit (each, kg, litres)</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="bottles" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>SKU / stock code</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="PAR-750" /></div>
              <div className="space-y-1.5"><Label>Supplier</Label><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Who you buy it from" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Cost (R)</Label><Input type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} placeholder="12" /></div>
              <div className="space-y-1.5"><Label>Sell (R)</Label><Input type="number" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} placeholder="18" /></div>
              <div className="space-y-1.5"><Label>Low at</Label><Input type="number" value={form.lowStockAt} onChange={(e) => setForm({ ...form, lowStockAt: e.target.value })} placeholder="3" /></div>
            </div>
            <div className="space-y-1.5"><Label>Stock location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Shelf 2, back room" /></div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Anything else worth remembering" /></div>
            <Button onClick={addItem} disabled={busy || !form.name.trim()} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add item'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
