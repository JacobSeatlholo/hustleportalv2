'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { api } from './shared'
import { useHp } from './store'
import { MessageCircle, CalendarClock, CheckCircle2, Copy, Loader2, LifeBuoy } from 'lucide-react'

/**
 * SupportView — the member's door to a human.
 *
 * Three ways to reach us, one honest promise:
 *  1. Discord community — the fastest way, one tap.
 *  2. Our Discord channel — updates and answers.
 *  3. WhatsApp — chat with the team from the phone.
 * Plus: book a call with the team — a real request that waits on the
 * desk; nothing is auto-confirmed and nothing auto-sends.
 * The call itself happens on Discord.
 */

const DISCORD_INVITE = 'https://discord.gg/kTnDEr7s7'
const DISCORD_CHANNEL = 'https://discord.gg/8Vr5suMrm'
const WHATSAPP_NUMBER = '27744815163'
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi HustlePortal team, I need a hand with something.')}`

interface SupportMeeting {
  id: string
  title: string
  startsAt: string
  endsAt?: string | null
  status: string
  meetLink?: string | null
}

function sastWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-ZA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    PROPOSED: 'border-amber-500/40 text-amber-400',
    CONFIRMED: 'border-emerald-500/40 text-emerald-400',
    DECLINED: 'border-zinc-600/50 text-zinc-500',
  }
  const label: Record<string, string> = { PROPOSED: 'awaiting team', CONFIRMED: 'confirmed', DECLINED: 'moved on' }
  return (
    <Badge variant="outline" className={`text-[9px] shrink-0 ${map[status] ?? map.DECLINED}`}>
      {label[status] ?? status}
    </Badge>
  )
}

export default function SupportView() {
  const { toast } = useToast()
  const { session } = useHp()
  const [topic, setTopic] = useState('')
  const [when, setWhen] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [requested, setRequested] = useState<string | null>(null)
  const [meetings, setMeetings] = useState<SupportMeeting[] | null>(null)

  async function load() {
    try {
      const r = await api<{ meetings: SupportMeeting[] }>('/api/meetings')
      setMeetings(r.meetings || [])
    } catch {
      setMeetings([])
    }
  }
  useEffect(() => { load() }, [])

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(DISCORD_INVITE)
      toast({ title: 'Discord invite copied', description: DISCORD_INVITE })
    } catch {
      window.open(DISCORD_INVITE, '_blank', 'noopener')
    }
  }

  async function submit() {
    if (topic.trim().length < 2) {
      toast({ title: 'One thing missing', description: 'Tell us what the call is about — a few words is enough.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const r = await api<{ ok: boolean; startsAt: string; discord: string }>('/api/support/meeting', {
        method: 'POST',
        body: JSON.stringify({
          topic: topic.trim(),
          note: note.trim() || undefined,
          preferredAt: when ? new Date(`${when}:00+02:00`).toISOString() : undefined,
        }),
      })
      setRequested(sastWhen(r.startsAt))
      setTopic(''); setWhen(''); setNote('')
      toast({ title: 'Request sent', description: 'The team confirms it from the desk — you get an email with the final details. The call happens on Discord.' })
      load()
    } catch (e) {
      toast({ title: 'Could not send that', description: e instanceof Error ? e.message : 'Try again in a moment.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const mine = (meetings || []).filter((m) => m.title.startsWith('Support call:'))

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-10">
      <div>
        <h1 className="font-display text-3xl flex items-center gap-2">
          <LifeBuoy className="h-7 w-7 text-brand" /> Support
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real humans, real help. Chat on Discord or WhatsApp, or book a call with the team.
        </p>
      </div>

      {/* Three ways to reach a human — no forms, no waiting rooms. */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-brand" /> Discord community
              <Badge variant="outline" className="text-[9px] border-indigo-500/40 text-indigo-400">fastest</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Ask a question, get unstuck, swap wins with other hustlers. The team is in there too.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={DISCORD_INVITE} target="_blank" rel="noreferrer">
                <Button size="sm" className="h-8 bg-indigo-500 hover:bg-indigo-400 text-white">
                  <MessageCircle className="h-3.5 w-3.5 mr-1" /> Open
                </Button>
              </a>
              <Button size="sm" variant="outline" className="h-8" onClick={copyInvite}>
                <Copy className="h-3.5 w-3.5 mr-1" /> Copy invite
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-brand" /> Our Discord channel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              The Business Hustle channel — updates, wins and the stuff we post for members.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={DISCORD_CHANNEL} target="_blank" rel="noreferrer">
                <Button size="sm" className="h-8 bg-indigo-500 hover:bg-indigo-400 text-white">
                  <MessageCircle className="h-3.5 w-3.5 mr-1" /> Open the channel
                </Button>
              </a>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(DISCORD_CHANNEL)
                    toast({ title: 'Channel link copied', description: DISCORD_CHANNEL })
                  } catch {
                    window.open(DISCORD_CHANNEL, '_blank', 'noopener')
                  }
                }}
              >
                <Copy className="h-3.5 w-3.5 mr-1" /> Copy link
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-emerald-500" /> WhatsApp
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Message the team straight from your phone — the chat opens with your question half typed.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={WHATSAPP_LINK} target="_blank" rel="noreferrer">
                <Button size="sm" className="h-8 bg-emerald-500 hover:bg-emerald-400 text-white">
                  <MessageCircle className="h-3.5 w-3.5 mr-1" /> Chat on WhatsApp
                </Button>
              </a>
            </div>
            <div className="text-xs text-muted-foreground font-mono">+27 74 481 5163</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-brand" /> Book a call with the team
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {requested ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1">
              <div className="text-sm font-medium flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Request sent
              </div>
              <p className="text-xs text-muted-foreground">
                We pencilled you in for <span className="font-medium text-foreground">{requested}</span> (South African time). The team confirms
                it from the desk and you get an email with the final details. The call happens on Discord. Need it sooner?{' '}
                <a href={DISCORD_INVITE} target="_blank" rel="noreferrer" className="text-brand underline">Ping the Discord</a> or <a href={WHATSAPP_LINK} target="_blank" rel="noreferrer" className="text-brand underline">WhatsApp us</a>.
              </p>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setRequested(null)}>Book another</Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                A 30 minute one-on-one: your pipeline, your numbers, your next move. You pick the topic and the time —
                the team confirms it from the desk (you get an email the moment it is locked). Nothing is automatic.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">What is the call about? *</label>
                  <Input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. My leads are not answering my emails"
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Preferred time (South African time)</label>
                  <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                  <div className="text-[10px] text-muted-foreground">Leave empty and we will suggest the next open morning.</div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Anything the team should look at first?</label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. I sent 20 emails this week, two replies. Here is what I sent…"
                  rows={3}
                  maxLength={600}
                />
              </div>
              <Button onClick={submit} disabled={busy || topic.trim().length < 2} className="bg-brand text-black hover:bg-brand">
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CalendarClock className="h-4 w-4 mr-1" />}
                {busy ? 'Sending…' : 'Request the call'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Your support calls</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {meetings === null && (
              <div className="px-4 py-4 space-y-2">
                <Skeleton className="h-9 rounded-lg" />
                <Skeleton className="h-9 rounded-lg" />
              </div>
            )}
            {meetings !== null && mine.length === 0 && (
              <div className="px-4 py-5 text-sm text-muted-foreground">
                No support calls yet. Book one above — or just say hi on the Discord or WhatsApp.
              </div>
            )}
            {mine.map((m) => (
              <div key={m.id} className="px-4 py-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-brand/15 text-brand flex items-center justify-center text-sm font-bold shrink-0">
                  {(session?.user?.name || 'Y').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{m.title.replace(/^Support call: /, '')}</div>
                  <div className="text-xs text-muted-foreground">{sastWhen(m.startsAt)} SAST · on Discord</div>
                </div>
                <StatusChip status={m.status} />
                {m.status === 'CONFIRMED' && (
                  <a href={DISCORD_INVITE} target="_blank" rel="noreferrer" className="shrink-0">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] border-indigo-500/40 text-indigo-400">
                      <MessageCircle className="h-3 w-3 mr-1" /> Join
                    </Button>
                  </a>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
