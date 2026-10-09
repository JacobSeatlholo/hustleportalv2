'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import { api, type Challenge } from './shared'
import { useHp, type ViewKey } from './store'
import { Loader2, Users, UserPlus, Trophy, LogOut, CheckCircle2, Circle } from 'lucide-react'

interface TeamInfo {
  id: string
  name: string
  role: string
  members: { id: string; name: string; email: string; role: string }[]
}

const INDUSTRIES = ['Creative Agency', 'Freelancer', 'Tech / SaaS', 'Retail', 'Consulting', 'Construction', 'Food & Bev', 'Health', 'Other']
const CITIES = ['Cape Town', 'Johannesburg', 'Durban', 'Pretoria', 'Port Elizabeth', 'Other']

export default function ProfileView() {
  const { session, loadSession, logout } = useHp()
  const { toast } = useToast()
  const [form, setForm] = useState({
    name: '', businessName: '', industry: '', city: '', phone: '',
  })
  const [saving, setSaving] = useState(false)
  const [teams, setTeams] = useState<TeamInfo[]>([])
  const [teamName, setTeamName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [busyTeam, setBusyTeam] = useState(false)

  useEffect(() => {
    if (session) {
      setForm({
        name: session.user.name || '',
        businessName: session.user.businessName || '',
        industry: session.user.industry || '',
        city: session.user.city || '',
        phone: session.user.phone || '',
      })
    }
  }, [session])

  useEffect(() => {
    api<{ teams: TeamInfo[] }>('/api/teams').then((r) => setTeams(r.teams)).catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    try {
      await api('/api/profile', { method: 'PATCH', body: JSON.stringify(form) })
      toast({ title: 'Profile saved' })
      await loadSession()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function createTeam() {
    if (!teamName.trim()) return
    setBusyTeam(true)
    try {
      await api('/api/teams', { method: 'POST', body: JSON.stringify({ name: teamName }) })
      const r = await api<{ teams: TeamInfo[] }>('/api/teams')
      setTeams(r.teams)
      setTeamName('')
      toast({ title: 'Team created', description: 'Now invite teammates by email.' })
      await loadSession()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyTeam(false)
    }
  }

  async function invite(teamId: string) {
    if (!inviteEmail.trim()) return
    setBusyTeam(true)
    try {
      await api('/api/teams', { method: 'POST', body: JSON.stringify({ action: 'invite', teamId, email: inviteEmail }) })
      const r = await api<{ teams: TeamInfo[] }>('/api/teams')
      setTeams(r.teams)
      setInviteEmail('')
      toast({ title: 'Teammate added to your team' })
    } catch (e) {
      toast({ title: 'Invite failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyTeam(false)
    }
  }

  if (!session) return null
  const level = session.level
  const challenges: Challenge[] = session.challenges
  const doneCount = challenges.filter((c) => c.done).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">My Profile</h1>
          <p className="text-sm text-muted-foreground">{session.user.email}</p>
        </div>
        <Button variant="outline" size="sm" onClick={logout} className="text-red-600 hover:text-red-700">
          <LogOut className="h-4 w-4 mr-1" /> Sign out
        </Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: level + challenges */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5 text-center space-y-2">
              <div className="text-4xl">{level.icon}</div>
              <div className="font-display text-2xl">{level.name}</div>
              <div className="text-sm text-muted-foreground">Level {level.level} · {session.user.xp} XP</div>
              <Progress value={level.progress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {level.next ? `${level.next.min - session.user.xp} XP to ${level.next.name}` : 'Max level — legend.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" /> Today&apos;s challenges
                <Badge variant="secondary" className="ml-auto">{doneCount}/{challenges.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {challenges.map((c) => (
                <div key={c.key} className="flex items-center gap-2 text-sm">
                  {c.done
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    : <Circle className="h-4 w-4 text-stone-300 shrink-0" />}
                  <span className={c.done ? 'line-through text-muted-foreground' : ''}>{c.label}</span>
                  <span className="ml-auto text-xs text-amber-700">+{c.xp} XP</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right: forms */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Business profile</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Your name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Business name</Label>
                  <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Industry</Label>
                  <div className="flex flex-wrap gap-1">
                    {INDUSTRIES.map((i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setForm({ ...form, industry: i })}
                        className={`text-xs px-2 py-1 rounded-full border transition ${form.industry === i ? 'bg-amber-400/90 border-amber-500 text-black font-medium' : 'bg-white text-muted-foreground hover:border-amber-300'}`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>City</Label>
                  <div className="flex flex-wrap gap-1">
                    {CITIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm({ ...form, city: c })}
                        className={`text-xs px-2 py-1 rounded-full border transition ${form.city === c ? 'bg-amber-400/90 border-amber-500 text-black font-medium' : 'bg-white text-muted-foreground hover:border-amber-300'}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp number</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+27 …" />
              </div>
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
              </Button>
            </CardContent>
          </Card>

          {/* Team */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Team</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {teams.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Create a team to share tasks and pipelines with your people. Teammates need a HustlePortal account first.
                  </p>
                  <div className="flex gap-2">
                    <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name, e.g. Nkosi Brands Crew" />
                    <Button onClick={createTeam} disabled={busyTeam || !teamName.trim()}>
                      {busyTeam ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create team'}
                    </Button>
                  </div>
                </div>
              ) : (
                teams.map((t) => (
                  <div key={t.id} className="rounded-xl border p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{t.name}</span>
                      <Badge variant={t.role === 'OWNER' ? 'default' : 'secondary'}>{t.role.toLowerCase()}</Badge>
                    </div>
                    <div className="space-y-1">
                      {t.members.map((m) => (
                        <div key={m.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <div className="h-6 w-6 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-[10px] font-bold">
                            {m.name.slice(0, 1).toUpperCase()}
                          </div>
                          {m.name} <span className="text-xs">({m.email})</span>
                        </div>
                      ))}
                    </div>
                    {t.role === 'OWNER' && (
                      <div className="flex gap-2">
                        <Input
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="teammate@email.co.za"
                          className="flex-1"
                        />
                        <Button variant="outline" onClick={() => invite(t.id)} disabled={busyTeam || !inviteEmail.trim()}>
                          <UserPlus className="h-4 w-4 mr-1" /> Invite
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export type { ViewKey }
