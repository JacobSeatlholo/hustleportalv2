'use client'

/**
 * GoogleProfilePanel — the third AI Co-Founder tab. One tap turns the member's
 * profile into a complete Google Business Profile kit: description, categories,
 * services, weekly posts, review replies, a photo shot list and the exact paste
 * steps. Google gates direct publishing behind its own approval process, so the
 * honest deal is written right into the screen: the kit lands here, the member
 * pastes it into Google. About ten minutes of work, zero rand.
 */
import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api } from './shared'
import { useHp } from './store'
import { MapPin, Loader2, Copy, ExternalLink, RefreshCw } from 'lucide-react'

interface Kit {
  description: string
  descriptionChars: number
  descriptionOverLimit: boolean
  categories: { primary: string; extra: string[] }
  services: string[]
  posts: { title: string; body: string }[]
  reviewReplies: { positive: string; negative: string }
  photos: string[]
  keywords: string[]
  steps: string[]
}

type ToastFn = (t: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void

function copyable(text: string, what: string, notify: ToastFn) {
  navigator.clipboard
    .writeText(text)
    .then(() => notify({ title: `${what} copied`, description: 'Paste it straight into Google.' }))
    .catch(() => notify({ title: 'Could not copy', description: 'Select the text and copy it by hand.', variant: 'destructive' }))
}

function CopyBtn({ text, what, onToast }: { text: string; what: string; onToast: ToastFn }) {
  return (
    <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => copyable(text, what, onToast)}>
      <Copy className="h-3.5 w-3.5" /> Copy
    </Button>
  )
}

function Section({ title, children, copyAll }: { title: string; children: React.ReactNode; copyAll?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="font-medium text-sm">{title}</h3>
          {copyAll}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

export default function GoogleProfilePanel() {
  const { toast } = useToast()
  const session = useHp((s) => s.session)
  const u = session?.user
  const [differentiator, setDifferentiator] = useState('')
  const [offer, setOffer] = useState('')
  const [currentDescription, setCurrentDescription] = useState('')
  const [generating, setGenerating] = useState(false)
  const [kit, setKit] = useState<Kit | null>(null)

  const notify: ToastFn = toast

  async function generate() {
    if (generating) return
    setGenerating(true)
    try {
      const res = await api<{ kit: Kit }>('/api/ai/google-profile', {
        method: 'POST',
        body: JSON.stringify({ differentiator, offer, currentDescription }),
      })
      setKit(res.kit)
      toast({ title: 'Your Google profile kit is ready', description: 'Copy each piece into Google. About ten minutes.' })
    } catch (e) {
      toast({ title: 'The kit did not come through', description: e instanceof Error ? e.message : 'Try again in a moment', variant: 'destructive' })
    } finally {
      setGenerating(false)
    }
  }

  const everything = kit
    ? [
        `GOOGLE DESCRIPTION\n${kit.description}`,
        `\nCATEGORIES\nPrimary: ${kit.categories.primary}${kit.categories.extra.length ? `\nExtra: ${kit.categories.extra.join(', ')}` : ''}`,
        `\nSERVICES\n${kit.services.join('\n')}`,
        `\nPOSTS\n${kit.posts.map((p) => `${p.title}\n${p.body}`).join('\n\n')}`,
        `\nREVIEW REPLIES\nGood review: ${kit.reviewReplies.positive}\n\nBad review: ${kit.reviewReplies.negative}`,
        `\nPHOTOS TO TAKE\n${kit.photos.join('\n')}`,
        `\nSEARCH WORDS\n${kit.keywords.join(', ')}`,
        `\nSTEPS IN GOOGLE\n${kit.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      ].join('\n')
    : ''

  return (
    <div className="space-y-4">
      {!kit && !generating && (
        <Card>
          <CardContent className="p-6 md:p-8 space-y-4">
            <div className="flex items-center gap-2 text-brand text-sm font-medium">
              <MapPin className="h-4 w-4" /> Be the obvious choice on Google Maps
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your AI Co-Founder writes your whole Google profile kit from your business details: the description, the right categories, your services, three ready posts, polite replies for good and bad reviews, a photo shot list and the exact steps. Google does not let tools publish directly, so the kit lands here and you paste it in. About ten minutes, then your business shows up properly when neighbours search.
            </p>
            {u && (
              <div className="text-xs text-muted-foreground rounded-lg border px-3 py-2 bg-muted/40">
                Writing for <span className="font-medium text-foreground">{u.businessName || u.name}</span>
                {u.industry ? ` · ${u.industry}` : ''}{u.city ? ` · ${u.city}` : ''}
                {(!u.businessName || !u.industry || !u.city) && ' · fill your profile first for the sharpest kit'}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="gp-diff">What makes you different (optional)</Label>
                <Input id="gp-diff" value={differentiator} onChange={(e) => setDifferentiator(e.target.value)} placeholder="e.g. same day service, 10 years on the same street" maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gp-offer">Special to promote right now (optional)</Label>
                <Input id="gp-offer" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. free quote this month" maxLength={100} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gp-cur">Your current Google description, if one exists (optional)</Label>
              <Textarea id="gp-cur" value={currentDescription} onChange={(e) => setCurrentDescription(e.target.value)} rows={3} maxLength={800} placeholder="Paste it here and the kit will build on it instead of starting over" />
            </div>
            <Button onClick={generate} className="w-full sm:w-auto">Write my Google profile kit</Button>
          </CardContent>
        </Card>
      )}

      {generating && (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-brand" />
            <p className="font-medium">Writing your Google kit…</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">Description, categories, posts, review replies and steps, tuned to your city.</p>
          </CardContent>
        </Card>
      )}

      {kit && !generating && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => copyable(everything, 'The whole kit', notify)}>Copy the whole kit</Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={generate}>
              <RefreshCw className="h-3.5 w-3.5" /> Write it again
            </Button>
            <a href="https://business.google.com" target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" /> Open Google Business Profile
              </Button>
            </a>
          </div>

          <Section
            title="Business description"
            copyAll={<CopyBtn text={kit.description} what="The description" onToast={notify} />}
          >
            <div className="flex items-start gap-2">
              <p className="text-sm leading-relaxed whitespace-pre-wrap flex-1">{kit.description}</p>
            </div>
            <div className="mt-2">
              {kit.descriptionOverLimit ? (
                <Badge variant="destructive">{kit.descriptionChars} of 750 characters. Trim a line before you paste.</Badge>
              ) : (
                <Badge className="bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/15">{kit.descriptionChars} of 750 characters</Badge>
              )}
            </div>
          </Section>

          {kit.categories.primary && (
            <Section title="Categories to pick in Google" copyAll={<CopyBtn text={[kit.categories.primary, ...kit.categories.extra].join('\n')} what="The categories" onToast={notify} />}>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-brand/15 text-brand hover:bg-brand/15">Primary: {kit.categories.primary}</Badge>
                {kit.categories.extra.map((c, i) => (
                  <Badge key={i} variant="outline">{c}</Badge>
                ))}
              </div>
            </Section>
          )}

          {kit.services.length > 0 && (
            <Section title="Services to list" copyAll={<CopyBtn text={kit.services.join('\n')} what="The services" onToast={notify} />}>
              <ul className="text-sm space-y-1.5">
                {kit.services.map((s, i) => (
                  <li key={i} className="flex gap-2"><span className="text-brand">•</span>{s}</li>
                ))}
              </ul>
            </Section>
          )}

          {kit.posts.length > 0 && (
            <Section title="Ready posts for your Google updates">
              <div className="space-y-3">
                {kit.posts.map((p, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{p.title}</p>
                      <CopyBtn text={`${p.title}\n${p.body}`} what="The post" onToast={notify} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{p.body}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {(kit.reviewReplies.positive || kit.reviewReplies.negative) && (
            <Section title="Reply templates for reviews">
              <div className="space-y-3">
                {kit.reviewReplies.positive && (
                  <div className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-emerald-700">Happy customer</p>
                      <CopyBtn text={kit.reviewReplies.positive} what="The reply" onToast={notify} />
                    </div>
                    <p className="text-sm mt-1 leading-relaxed">{kit.reviewReplies.positive}</p>
                  </div>
                )}
                {kit.reviewReplies.negative && (
                  <div className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-amber-700">Unhappy customer</p>
                      <CopyBtn text={kit.reviewReplies.negative} what="The reply" onToast={notify} />
                    </div>
                    <p className="text-sm mt-1 leading-relaxed">{kit.reviewReplies.negative}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {kit.photos.length > 0 && (
            <Section title="Photos to take this week">
              <ul className="text-sm space-y-1.5">
                {kit.photos.map((p, i) => (
                  <li key={i} className="flex gap-2"><span className="text-brand">•</span>{p}</li>
                ))}
              </ul>
            </Section>
          )}

          {kit.keywords.length > 0 && (
            <Section title="Search words you now match" copyAll={<CopyBtn text={kit.keywords.join(', ')} what="The search words" onToast={notify} />}>
              <div className="flex flex-wrap gap-1.5">
                {kit.keywords.map((k, i) => (
                  <Badge key={i} variant="secondary">{k}</Badge>
                ))}
              </div>
            </Section>
          )}

          {kit.steps.length > 0 && (
            <Section title="Where each piece goes in Google">
              <ol className="text-sm space-y-1.5">
                {kit.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-medium text-brand shrink-0">{i + 1}.</span>{s}
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
