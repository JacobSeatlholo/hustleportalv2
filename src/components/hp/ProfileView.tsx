'use client'

import { useEffect, useState } from 'react'
import { replayTour } from './WelcomeTour'
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
import CityField from './CityField'
import PwaNotifications from './PwaNotifications'
import { Loader2, Users, UserPlus, Trophy, LogOut, CheckCircle2, Circle, Building2, Sparkles, Compass, Globe, Copy, Check, ScanSearch, Bell } from 'lucide-react'

interface TeamInfo {
  id: string
  name: string
  role: string
  members: { id: string; name: string; email: string; role: string }[]
  pending?: { id: string; email: string }[]
}

interface UrlAnalysis {
  businessName?: string
  industry?: string
  tagline?: string
  city?: string
  phone?: string
  email?: string
  audience?: { summary?: string; demographics?: string; painPoints?: string[] }
  brand?: { voice?: string; personality?: string[] }
  positioning?: string
  pitches?: { type?: string; subject?: string; body?: string }[]
  keywords?: string[]
  sourceUrl?: string
  analyzedAt?: string
}

const INDUSTRIES = ['Creative Agency', 'Freelancer', 'Tech / SaaS', 'Retail', 'Consulting', 'Construction', 'Food & Bev', 'Health', 'Other']

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

  // AI business-URL dissection
  const [urlInput, setUrlInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<UrlAnalysis | null>(null)
  const [copiedPitch, setCopiedPitch] = useState<number | null>(null)

  // (city geolocation + free-text live in the shared CityField component)

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
        setUrlInput(r.project.website || '')
      })
      .catch(() => {})
    // load last saved analysis for this workspace
    api<{ analysis: UrlAnalysis | null }>(`/api/ai/business-url${activeProjectId ? `?projectId=${activeProjectId}` : ''}`)
      .then((r) => setAnalysis(r.analysis))
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
      const res = await api<{ added?: boolean; invited?: boolean }>('/api/teams', {
        method: 'POST',
        body: JSON.stringify({ action: 'invite', teamId, email: inviteEmail }),
      })
      const r = await api<{ teams: TeamInfo[] }>('/api/teams')
      setTeams(r.teams)
      setInviteEmail('')
      toast(
        res.added
          ? { title: 'Teammate added to your team', description: 'They got an email with the news — shared tasks are live for them now.' }
          : { title: 'Invitation sent', description: 'The moment they register with this email, they land in your team automatically.' }
      )
    } catch (e) {
      toast({ title: 'Invite failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyTeam(false)
    }
  }

  async function cancelInvite(inviteId: string) {
    try {
      await api(`/api/teams?inviteId=${inviteId}`, { method: 'DELETE' })
      const r = await api<{ teams: TeamInfo[] }>('/api/teams')
      setTeams(r.teams)
      toast({ title: 'Invite cancelled' })
    } catch {
      toast({ title: 'Could not cancel invite', variant: 'destructive' })
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
      const r = await api<{ pitch: string; notice?: string }>('/api/ai/sales-pitch', {
        method: 'POST',
        body: JSON.stringify({ projectId: activeProjectId }),
      })
      setSalesPitch(r.pitch)
      toast({
        title: 'Sales pitch generated ✓',
        description: r.notice || 'Grounded in your workspace profile.',
      })
    } catch (e) {
      toast({ title: 'Pitch failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setPitching(false)
    }
  }

  async function analyzeUrl() {
    if (!urlInput.trim()) {
      toast({ title: 'Add your web address first', description: 'e.g. bloombeauty.co.za — the AI reads the site and fills your profile.', variant: 'destructive' })
      return
    }
    setAnalyzing(true)
    try {
      const r = await api<{ analysis: UrlAnalysis; notice?: string }>('/api/ai/business-url', {
        method: 'POST',
        body: JSON.stringify({ url: urlInput, projectId: activeProjectId }),
      })
      setAnalysis(r.analysis)

      // Auto-fill the profile FOR THE USER TO VERIFY & CONFIRM — empty fields only,
      // nothing overwrites what they already typed, and nothing saves until "Save changes".
      const a = r.analysis || {}
      const filled: string[] = []
      setForm((f) => {
        const next = { ...f }
        if (!f.businessName && a.businessName) { next.businessName = a.businessName; filled.push('business name') }
        if (!f.industry && a.industry) { next.industry = a.industry; filled.push('industry') }
        if (!f.city && a.city) { next.city = a.city; filled.push('city') }
        if (!f.phone && a.phone) { next.phone = a.phone; filled.push('WhatsApp number') }
        return next
      })
      setWs((w) => ({
        ...w,
        website: w.website || urlInput.trim(),
        name: w.name || a.businessName || '',
        industry: w.industry || a.industry || '',
        valueProp: w.valueProp || a.tagline || a.positioning || '',
        tone: w.tone || a.brand?.voice || '',
        contactEmail: w.contactEmail || a.email || '',
        contactPhone: w.contactPhone || a.phone || '',
        offerings: w.offerings || (a.keywords?.length ? a.keywords.join(', ') : ''),
      }))

      if (filled.length > 0) {
        toast({
          title: 'Profile drafted from your website ✓',
          description: `${r.notice ? r.notice + ' ' : ''}Filled: ${filled.join(', ')}. Check each field, then press Save changes to confirm.`,
        })
      } else {
        toast({ title: 'Business analysis complete ✓', description: r.notice || 'Your profile fields were already filled — review them and save.' })
      }
    } catch (e) {
      toast({ title: 'Analysis failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setAnalyzing(false)
    }
  }

  async function copyPitch(idx: number, subject: string, body: string) {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`)
      setCopiedPitch(idx)
      setTimeout(() => setCopiedPitch(null), 1500)
    } catch {
      toast({ title: 'Could not copy — select the text manually', variant: 'destructive' })
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => replayTour()}>
            <Compass className="h-4 w-4 mr-1" /> Replay the tour
          </Button>
          <Button variant="outline" size="sm" onClick={logout} className="text-red-600 hover:text-red-700">
            <LogOut className="h-4 w-4 mr-1" /> Sign out
          </Button>
        </div>
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
              {/* Website-first onboarding: key in the website, Gemini drafts the profile, user verifies & confirms */}
              <div className="rounded-xl border border-brand/30 bg-brand/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Globe className="h-4 w-4 text-brand" />
                  Have a website? Let AI fill this in
                </div>
                <div className="flex gap-2">
                  <Input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="yourbusiness.co.za"
                    inputMode="url"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    onClick={analyzeUrl}
                    disabled={analyzing}
                    className="shrink-0 bg-brand text-black hover:brightness-110 font-semibold"
                  >
                    {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {analyzing ? 'Reading…' : 'Fill my profile'}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  We read your site once, Gemini drafts your profile, and you confirm. Empty fields only — nothing overwrites what you already entered, and nothing saves until you press Save changes.
                </p>
              </div>
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
                <CityField value={form.city} onChange={(v) => setForm({ ...form, city: v })} label="City" hint="Pick a shortcut, type any city or township, or tag your location — nothing is stored until you save." />
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

              {/* AI business-URL dissection */}
              <div className="rounded-xl border border-brand/25 bg-brand/5 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <ScanSearch className="h-3.5 w-3.5 text-brand" /> AI website analysis — audience, brand &amp; pitches
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste your business web address and the AI studies your site: who buys from you, what your brand sounds like,
                  and three ready-to-send sales pitches. Everything is saved to this workspace and quietly sharpens every AI draft.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="yourbusiness.co.za"
                    aria-label="Business website"
                  />
                  <Button size="sm" variant="outline" onClick={analyzeUrl} disabled={analyzing} className="shrink-0">
                    {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                    {analyzing ? 'Reading your site…' : 'Analyze'}
                  </Button>
                </div>
                {analysis && (
                  <div className="space-y-3 pt-1">
                    <div className="grid sm:grid-cols-2 gap-2">
                      {analysis.audience?.summary && (
                        <div className="rounded-lg border bg-card p-2.5">
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Your audience</p>
                          <p className="text-xs leading-relaxed">{analysis.audience.summary}</p>
                          {analysis.audience.demographics && <p className="text-[11px] text-muted-foreground mt-1">{analysis.audience.demographics}</p>}
                        </div>
                      )}
                      {analysis.brand?.voice && (
                        <div className="rounded-lg border bg-card p-2.5">
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Brand voice</p>
                          <p className="text-xs leading-relaxed">{analysis.brand.voice}</p>
                          {analysis.brand.personality && analysis.brand.personality.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {analysis.brand.personality.slice(0, 6).map((p) => (
                                <Badge key={p} variant="secondary" className="text-[10px]">{p}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {analysis.audience?.painPoints && analysis.audience.painPoints.length > 0 && (
                      <div className="rounded-lg border bg-card p-2.5">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">What your buyers struggle with</p>
                        <ul className="text-xs space-y-1">
                          {analysis.audience.painPoints.slice(0, 5).map((pp) => (
                            <li key={pp} className="flex gap-1.5"><CheckCircle2 className="h-3 w-3 text-brand mt-0.5 shrink-0" />{pp}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis.positioning && (
                      <div className="rounded-lg border bg-card p-2.5">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Positioning</p>
                        <p className="text-xs leading-relaxed">{analysis.positioning}</p>
                      </div>
                    )}
                    {analysis.pitches && analysis.pitches.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Ready-to-send pitches</p>
                        {analysis.pitches.slice(0, 4).map((p, i) => (
                          <div key={i} className="rounded-lg border bg-card p-2.5 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="outline" className="text-[10px] border-brand/40 text-brand">{p.type || 'Pitch'}</Badge>
                              <button
                                className="text-muted-foreground hover:text-foreground transition inline-flex items-center gap-1 text-[11px]"
                                onClick={() => copyPitch(i, p.subject || '', p.body || '')}
                              >
                                {copiedPitch === i ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                                {copiedPitch === i ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            {p.subject && <p className="text-xs font-medium">{p.subject}</p>}
                            {p.body && <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">{p.body}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {analysis.keywords && analysis.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {analysis.keywords.slice(0, 8).map((k) => (
                          <Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {analysis.sourceUrl ? `Analyzed from ${analysis.sourceUrl}` : 'Saved to this workspace'} — every AI draft now grounds on this research.
                    </p>
                  </div>
                )}
              </div>

              {/* Multi-company */}
              <div className="border-t pt-3 space-y-2">
                <Label className="text-xs text-muted-foreground">Add another company workspace (multi-business)</Label>
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
                      {(t.pending || []).map((p) => (
                        <div key={p.id} className="flex items-center gap-2 text-sm text-muted-foreground/70">
                          <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                          </div>
                          <span className="truncate">{p.email}</span>
                          <span className="text-[10px] uppercase tracking-wide">pending</span>
                          {t.role === 'OWNER' && (
                            <button onClick={() => cancelInvite(p.id)} className="ml-auto text-xs hover:text-red-500 transition">cancel</button>
                          )}
                        </div>
                      ))}
                    </div>
                    {t.role === 'OWNER' && (
                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <Input
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="teammate@email.co.za"
                            className="flex-1"
                          />
                          <Button variant="outline" onClick={() => invite(t.id)} disabled={busyTeam || !inviteEmail.trim()}>
                            <UserPlus className="h-4 w-4 mr-1" /> Add member
                          </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Already on HustlePortal? Added instantly. Not yet? They get an email — registering with this address drops them straight into your team.
                        </p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Push notifications (installed app) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" /> Notifications</CardTitle>
            </CardHeader>
            <CardContent>
              <PwaNotifications />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export type { ViewKey }
