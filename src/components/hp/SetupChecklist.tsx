'use client'

import { useEffect, useState } from 'react'
import { useHp } from './store'
import { api } from './shared'
import { CheckCircle2, Circle, X, ArrowRight, ExternalLink } from 'lucide-react'

interface Item {
  id: string
  label: string
  why: string
  how: string
  link?: string
}

const ITEMS: Item[] = [
  {
    id: 'GEMINI_API_KEY',
    label: 'Gemini API key',
    why: 'Powers the AI Co-Founder, business plans, email drafts and voice capture.',
    how: 'Free at aistudio.google.com/apikey — takes 1 minute.',
    link: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'GMAIL_APP_PASSWORD',
    label: 'Gmail app password',
    why: 'Sends real emails from your own address in the Mail view.',
    how: 'Google Account → Security → 2-Step Verification → App passwords.',
    link: 'https://myaccount.google.com/apppasswords',
  },
  {
    id: 'EXPLEE_API_KEY',
    label: 'Explee API key',
    why: 'Live verified leads in the Lead Finder (demo leads without it).',
    how: 'Your Explee account → API keys.',
    link: 'https://explee.com',
  },
  {
    id: 'GCAL_OAUTH_TOKEN',
    label: 'Google Calendar token',
    why: 'Two-way appointment sync (Jitsi links and .ics work without it).',
    how: 'Optional — paste an OAuth token from Google Cloud.',
  },
]

const YOCO_ITEM: Item = {
  id: 'YOCO_WEBHOOK',
  label: 'Yoco webhook',
  why: 'Card top-ups only auto-credit wallets once the webhook is registered.',
  how: 'One click — we register this deployment with Yoco for you.',
}

export default function SetupChecklist() {
  const setView = useHp((s) => s.setView)
  const [dismissed, setDismissed] = useState(false)
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [registering, setRegistering] = useState(false)
  const [hasAny, setHasAny] = useState(false)
  const [keyBad, setKeyBad] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await api<{ settings: { key: string; configured: boolean }[] }>('/api/settings')
        const map: Record<string, boolean> = {}
        for (const s of res.settings || []) map[s.key] = Boolean(s.configured)
        let webhooks = false
        let badKey = false
        try {
          const wh = await api<{ configured: boolean; secretKey?: { present: boolean; validFormat: boolean } }>('/api/webhooks/yoco')
          webhooks = Boolean(wh.configured)
          badKey = Boolean(wh.secretKey && wh.secretKey.present && !wh.secretKey.validFormat)
        } catch { /* non-admin or error → treat as unknown, hide row */ }
        map['YOCO_WEBHOOK'] = webhooks
        setDone(map)
        setKeyBad(badKey)
        const missing = ITEMS.some((i) => !map[i.id]) || map['YOCO_WEBHOOK'] === false
        setHasAny(missing)
        const ack = localStorage.getItem('hp_setup_ack')
        setOpen(missing && ack !== '1')
      } catch {
        setHasAny(false)
      }
    })()
  }, [])

  function dismiss() {
    setOpen(false)
    setDismissed(true)
    localStorage.setItem('hp_setup_ack', '1')
  }

  async function registerWebhook() {
    setRegistering(true)
    try {
      await api('/api/webhooks/yoco/register', { method: 'POST', body: JSON.stringify({}) })
      setDone((d) => ({ ...d, YOCO_WEBHOOK: true }))
    } catch {
      /* toast-less: user sees state unchanged; integrations view has details */
    } finally {
      setRegistering(false)
    }
  }

  if (dismissed || !hasAny || !open) return null

  const missingItems = ITEMS.filter((i) => !done[i.id])
  const remaining = missingItems.length + (done['YOCO_WEBHOOK'] === false ? 1 : 0)

  return (
    <div className="rounded-xl border border-brand/30 bg-brand/5 p-4 md:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg leading-tight">Finish your setup — {remaining} step{remaining === 1 ? '' : 's'} left</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            The app works without these, but each one unlocks more. Takes a few minutes total.
          </p>
        </div>
        <button onClick={dismiss} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Dismiss setup checklist">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        {[...missingItems, ...(done['YOCO_WEBHOOK'] === false ? [YOCO_ITEM] : [])].map((i) => (
          <div key={i.id} className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-card/60 p-3">
            <Circle className="h-4 w-4 mt-0.5 text-brand shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{i.label}</div>
              <div className="text-xs text-muted-foreground">{i.why}</div>
              <div className="text-xs mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground">{i.how}</span>
                {i.link && (
                  <a href={i.link} target="_blank" rel="noreferrer" className="text-brand inline-flex items-center gap-0.5 hover:underline">
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
            {i.id === 'YOCO_WEBHOOK' ? (
              keyBad ? (
                <span className="shrink-0 text-xs text-amber-500 max-w-36 text-right">Fix YOCO_SECRET_KEY in Vercel — must start with sk_test_ / sk_live_</span>
              ) : (
                <button
                  onClick={registerWebhook}
                  disabled={registering}
                  className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110 transition disabled:opacity-50"
                >
                  {registering ? 'Registering…' : 'Register now'}
                </button>
              )
            ) : (
              <button
                onClick={() => setView('integrations')}
                className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:border-brand transition inline-flex items-center gap-1"
              >
                Add key <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        Already done: auth, database, payments keys, all 10 views live.
      </div>
    </div>
  )
}
