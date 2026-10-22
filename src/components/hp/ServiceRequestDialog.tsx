'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useHp } from './store'
import { Loader2, Send } from 'lucide-react'
import { api } from './shared'

const URGENCY_OPTIONS: { key: 'ASAP' | 'THIS_WEEK' | 'PLANNING'; label: string; hint: string }[] = [
  { key: 'ASAP', label: 'ASAP, urgent', hint: 'The team prioritises it immediately' },
  { key: 'THIS_WEEK', label: 'This week', hint: 'Most popular' },
  { key: 'PLANNING', label: 'Just planning', hint: 'Get a quote, no rush' },
]

export interface RequestedService {
  id: string
  title: string
}

/**
 * ServiceRequestDialog, the ONE direct line from anywhere in the product to the
 * Business Hustle team. Submitting emails team@businesshustle.co.za AND creates a
 * tracked task with an urgency level on the user's dashboard.
 * Used by ServicesView and by conversion touchpoints (invoice without logo, first
 * payment, relationships…) so "request something custom from us" is always one tap.
 */
export function ServiceRequestDialog({
  open,
  onOpenChange,
  service,
  presetMessage,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  service: RequestedService | null
  presetMessage?: string
}) {
  const { bumpRefresh, session } = useHp()
  const { toast } = useToast()
  const [urgency, setUrgency] = useState<'ASAP' | 'THIS_WEEK' | 'PLANNING'>('THIS_WEEK')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Re-seed the brief each time the dialog opens for a (new) service.
  useEffect(() => {
    if (open) {
      setUrgency('THIS_WEEK')
      setMessage(presetMessage ?? '')
    }
  }, [open, presetMessage, service?.id])

  async function submit() {
    if (!service) return
    setSubmitting(true)
    try {
      const res = await api<{ ok: true; ref: string; emailSent: boolean }>('/api/service-requests', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: service.id,
          serviceTitle: service.title,
          urgency,
          message,
        }),
      })
      onOpenChange(false)
      toast({
        title: `Request ${res.ref} sent ✓`,
        description:
          'Tracked on your Tasks with its urgency level, the Business Hustle team replies to ' +
          (session?.user.email || 'your email') + '.',
      })
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Could not send your request', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {service ? `Request: ${service.title}` : 'Request a service'}
          </DialogTitle>
          <DialogDescription>
            Tell us how urgent this is, the request is emailed to the team and added to your Tasks so nothing gets lost.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>How urgent is it?</Label>
            <div className="grid gap-1.5">
              {URGENCY_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setUrgency(o.key)}
                  className={`text-left rounded-lg border px-3 py-2 transition ${urgency === o.key ? 'border-brand bg-brand/10' : 'hover:border-brand/40'}`}
                >
                  <div className="text-sm font-medium">{o.label}</div>
                  <div className="text-[11px] text-muted-foreground">{o.hint}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-msg">What do you need? (optional)</Label>
            <Textarea
              id="sr-msg"
              rows={4}
              placeholder="One or two lines about your business and the outcome you want. Prices, timelines and next steps come from the team."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send request
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
