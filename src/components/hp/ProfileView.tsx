'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import { api, type Challenge, type ProjectFull } from './shared'
import { useHp, type ViewKey } from './store'
import { Loader2, Users, UserPlus, Trophy, LogOut, CheckCircle2, Circle, Building2, Sparkles } from 'lucide-react'

interface TeamInfo {
  id: string
  name: string
  role: string
  members: { id: string; name: string; email: string; role: string }[]
}

const INDUSTRIES = ['Creative Agency', 'Freelancer', 'Tech / SaaS', 'Retail', 'Consulting', 'Construction', 'Food & Bev', 'Health', 'Other']
const CITIES = ['Johannesburg', 'Durban', 'Pretoria', 'Port Elizabeth', 'Other']

export default function ProfileView() {
  const { session, loadSession, logout, activeProjectId, setActiveProject, bumpRefresh } = useHp()
  const { toast } = useToast()
  const [form, setForm] = useState({
    name: '', businessName: '', industry: '', city: '', phone: '',
  })
  const [saving, setSaving] = useState(false)
  const [teams, setTeams] = useState<TeamInfo[]>([])
  const [teamName, setTeamName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [busyTeam, setBusyTeam] = useState(false)

  // company workspace (per-project profile the AI grounds on)
  const [projects, setProjects] = useState<{ id: string; name: string; isDefault: boolean }[]>([])
  const [ws, setWs] = useState({
    name: '', industry: '', valueProp: '', targetMarket: '',
    offerings: '', tone: '', website: '', contactEmail: '', contactPhone: '',
  })
  const [salesPitch, setSalesPitch] = useState('')
  const [wsSaving, setWsSaving] = useState(false)
  const [pitching, setPitching] = useState(false)
  const [newWsName, setNewWsName] = useState('')

  useEffect(() => {
    if (!activeProjectId) return
    api<{ project: ProjectFull }>(`/api/projects/${activeProjectId}`)
      .then((r) => {
        setWs({
          name: r.project.name || '',
          industry: r.project.industry || '',
          valueProp: r.project.valueProp || '',
          targetMarket: r.project.targetMarket || '',
          offerings: r.project.offerings || '',
          tone: r.project.tone || '',
          website: r.project.website || '',
          contactEmail: r.project.contactEmail || '',
          contactPhone: r.project.contactPhone || '',
        })
        setSalesPitch(r.project.salesPitch || '')
      })
      .catch(() => {})
  }, [activeProjectId])

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

  // workspace list mirrors the session (for the picker inside this view)
  useEffect(() => {
    if (session) setProjects(session.projects)
  }, [session])

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

  async function saveWorkspace() {
    if (!activeProjectId) return
    setWsSaving(true)
    try {
      const r = await api<{ project: ProjectFull }>(`/api/projects/${activeProjectId}`, {
        method: 'PATCH',
        body: JSON.stringify(ws),
      })
      setSalesPitch(r.project.salesPitch || '')
      toast({ title: 'Workspace saved ✓', description: 'AI drafts and pitches now ground on this profile.' })
      await loadSession(true)
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setWsSaving(false)
    }
  }

  async function generatePitch() {
    if (!activeProjectId) return
    setPitching(true)
    try {
      const r = await api<{ pitch: string }>('/api/ai/sales-pitch', {
        method: 'POST',
        body: JSON.stringify({ projectId: activeProjectId }),
      })
      setSalesPitch(r.pitch)
      toast({ title: 'Sales pitch generated ✓', description: 'Grounded in your workspace profile.' })
    } catch (e) {
      toast({ title: 'Pitch failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setPitching(false)
    }
  }

  async function createWorkspace() {
    if (!newWsName.trim()) return
    try {
      const r = await api<{ project: { id: string; name: string; isDefault: boolean } }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: newWsName }),
      })
      setNewWsName('')
      setActiveProject(r.project.id)
      toast({ title: 'Workspace created ✓', description: `${r.project.name} is now active.` })
      await loadSession(true)
    } catch (e) {
      toast({ title: 'Could not create workspace', description: e instanceof Error ? e.message : '', variant: 'destructive' })
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
                <Trophy className="h-4 w-4 text-brand" /> Today&apos;s challenges
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
                  <span className="ml-auto text-xs text-brand">+{c.xp} XP</span>
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
                        className={`text-xs px-2 py-1 rounded-full border transition ${form.industry === i ? 'bg-brand border-brand text-black font-medium' : 'bg-transparent text-muted-foreground hover:border-brand/60'}`}
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
                        className={`text-xs px-2 py-1 rounded-full border transition ${form.city === c ? 'bg-brand border-brand text-black font-medium' : 'bg-transparent text-muted-foreground hover:border-brand/60'}`}
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

          {/* Company workspace (per-project profile) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-brand" /> Company workspace
                <Badge variant="secondary" className="ml-auto">feeds the AI</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {projects.length > 1 && (
                <div className="space-y-1.5">
                  <Label>Editing workspace</Label>
                  <select
                    value={activeProjectId || projects.find((p) => p.isDefault)?.id || ''}
                    onChange={(e) => setActiveProject(e.target.value)}
                    className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (default)' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Workspace / business name</Label>
                  <Input value={ws.name} onChange={(e) => setWs({ ...ws, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Industry</Label>
                  <Input value={ws.industry} onChange={(e) => setWs({ ...ws, industry: e.target.value })} placeholder="Creative agency" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Value proposition — what you actually do for people</Label>
                <Textarea rows={2} value={ws.valueProp} onChange={(e) => setWs({ ...ws, valueProp: e.target.value })} placeholder="We turn township businesses into brands people trust — logos, sites and socials that sell." />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Target market</Label>
                  <Input value={ws.targetMarket} onChange={(e) => setWs({ ...ws, targetMarket: e.target.value })} placeholder="Spaza shops, salons & gyms in Gauteng" />
                </div>
                <div className="space-y-1.5">
                  <Label>Tone of voice</Label>
                  <Input value={ws.tone} onChange={(e) => setWs({ ...ws, tone: e.target.value })} placeholder="Warm, straight-talking, no jargon" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Offerings — one per line</Label>
                <Textarea rows={3} value={ws.offerings} onChange={(e) => setWs({ ...ws, offerings: e.target.value })} placeholder={'Social media retainer — R7,500/mo\nLogo & brand kit — R3,200\nLanding page — R1,850'} />
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Website</Label>
                  <Input value={ws.website} onChange={(e) => setWs({ ...ws, website: e.target.value })} placeholder="https://…" />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact email</Label>
                  <Input value={ws.contactEmail} onChange={(e) => setWs({ ...ws, contactEmail: e.target.value })} placeholder="hello@business.co.za" />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact phone</Label>
                  <Input value={ws.contactPhone} onChange={(e) => setWs({ ...ws, contactPhone: e.target.value })} placeholder="+27 …" />
                </div>
              </div>
              <Button onClick={saveWorkspace} disabled={wsSaving}>
                {wsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save workspace'}
              </Button>

              {/* AI sales pitch */}
              <div className="rounded-xl border border-brand/25 bg-brand/5 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-brand" /> AI sales pitch
                  </span>
                  <Button size="sm" variant="outline" onClick={generatePitch} disabled={pitching}>
                    {pitching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Generate'}
                  </Button>
                </div>
                {salesPitch ? (
                  <p className="text-sm whitespace-pre-line">{salesPitch}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Fill in the profile above, then generate — Gemini writes a pitch grounded only in what you put here.
                    Needs a Gemini API key in Integrations.
                  </p>
                )}
              </div>

              {/* Multi-company */}
              <div className="border-t pt-3 space-y-2">
                <Label className="text-xs text-muted-foreground">Add another company workspace (multi-business hustle)</Label>
                <div className="flex gap-2">
                  <Input value={newWsName} onChange={(e) => setNewWsName(e.target.value)} placeholder="e.g. Sibo Events" className="flex-1" />
                  <Button variant="outline" onClick={createWorkspace} disabled={!newWsName.trim()}>Create</Button>
                </div>
              </div>
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
                          <div className="h-6 w-6 rounded-full bg-brand/15 text-brand flex items-center justify-center text-[10px] font-bold">
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
