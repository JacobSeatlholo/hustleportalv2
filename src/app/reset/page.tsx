'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/components/hp/shared'
import { useToast } from '@/hooks/use-toast'
import { Loader2, LockKeyhole, MailCheck, CircleAlert, ArrowRight } from 'lucide-react'

function ResetForm() {
  const params = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    if (password !== confirm) {
      setError('The two passwords don\u2019t match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api('/api/auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset', token, password }),
      })
      setDone(true)
      toast({ title: 'Password updated ✓', description: 'You\u2019re signed in — taking you to your dashboard.' })
      setTimeout(() => router.push('/'), 1400)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  const card = 'w-full max-w-md'

  if (!token) {
    return (
      <Card className={card}>
        <CardContent className="p-6 md:p-8 space-y-4 text-center">
          <CircleAlert className="h-9 w-9 text-amber-400 mx-auto" />
          <p className="text-sm text-muted-foreground">
            This reset link is missing its security token. Request a fresh link from the sign-in page and open it from your email.
          </p>
          <Button className="w-full" onClick={() => router.push('/')}>
            Back to HustlePortal
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (done) {
    return (
      <Card className={card}>
        <CardContent className="p-6 md:p-8 space-y-4 text-center">
          <MailCheck className="h-9 w-9 text-brand mx-auto" />
          <p className="text-sm font-medium">Password updated — you&apos;re signed in.</p>
          <p className="text-xs text-muted-foreground">Taking you to your dashboard…</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={card}>
      <CardContent className="p-6 md:p-8 space-y-5">
        <div className="text-center space-y-2">
          <LockKeyhole className="h-8 w-8 text-brand mx-auto" />
          <h1 className="font-display text-2xl">Choose a new password</h1>
          <p className="text-xs text-muted-foreground">At least 6 characters. You&apos;ll be signed straight in afterwards.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-pw">New password</Label>
          <Input
            id="rs-pw" type="password" placeholder="••••••••" value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-pw2">Confirm new password</Label>
          <Input
            id="rs-pw2" type="password" placeholder="••••••••" value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && password && confirm && submit()}
          />
        </div>
        {error && (
          <p className="text-xs rounded-md border border-rose-500/40 bg-rose-500/5 text-rose-400 px-2.5 py-2">{error}</p>
        )}
        <Button
          onClick={submit}
          disabled={busy || password.length < 6 || !confirm}
          className="w-full h-11 text-base font-semibold"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update password'}
          {!busy && <ArrowRight className="h-4 w-4 ml-1" />}
        </Button>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
        >
          ← Back to HustlePortal
        </button>
      </CardContent>
    </Card>
  )
}

export default function ResetPage() {
  return (
    <div className="min-h-screen hp-gradient-bg flex items-center justify-center p-6">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </div>
  )
}
