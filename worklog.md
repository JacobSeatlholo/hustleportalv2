# HustlePortal Worklog
(Durable mirror kept at .git/hp-deploy/worklog.md — root copy gets wiped on sandbox resets)

---
Task ID: 26-27
Agent: Super Z (main)
Task: Diagnose user reports — "no option to push when done" + "web app still goes to 404".

Work Log:
- Investigated InstallApp.tsx: line 34 is VALID (`const [hidden, setHidden]`) — earlier cat output was a display artifact eating "[h". Not a bug.
- FOUND 404 ROOT CAUSE: Task 13-era manifest had start_url /dashboard + shortcuts /leads, /invoices — routes that never existed (single-page app). Task 23 fixed the manifest, but PWA icons installed BEFORE that still target the dead paths → permanent Vercel 404 on tap.
- BH external links all verified 200 (terms/privacy/cookies/shop/products). Manifest serving correct (application/manifest+json), icons 200, layout links manifest.
- Task 26 (8319482): next.config.ts redirects — /dashboard → /?source=pwa, /leads → /?view=leads, /invoices → /?view=invoices (permanent 308). Stale home-screen icons self-heal with zero user action. COMMITTED, NOT YET PUSHED.
- Sandbox reset AGAIN mid-session (partial restore): scripts/git_ssh_paramiko.py, /home/z/.ssh, venv paramiko, worklog.md wiped; .git + tracked files survived.
- Rebuilt infra DURABLY this time: paramiko in .venv, keypair v2 + shim stored under .git/hp-deploy/ (proven reset-surviving location). Key v1 (user-authorized this morning) unrecoverable → v2 pubkey needs one-time authorization.

Stage Summary:
- Pending push: 8319482 Task 26 (stale-icon 404 fix).
- BLOCKER: deploy key v2 authorization. Pubkey: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAKQx3Nv55Qgu4SQy+FxqvG2zniGS6BRNt7wD3F8kGw6
- Learned: store reset-fragile infra under .git/hp-deploy/ (shim, key, worklog mirror). User-side "no option to push" = GitHub UI has no push button (push happens from agent side).

---
Task ID: 27
Agent: Super Z (main)
Task: Welcome email on signup + pricing strategy brainstorm.

Work Log:
- Read plans.ts: plans are MONTHLY SUBSCRIPTIONS (Operator R199/mo: 5 lead reveals + AI + tools; Boss R499/mo: 10+ reveals + 5 seats + priority AI), MRR target R45k, referrals R10/R50, welcome credit R99 via PlatformConfig (welcome_credit_cents=9900).
- Spotted value-per-rand inversion: Operator R39.80/lead vs Boss R49.90/lead — Boss sells on seats/priority, must be made a no-brainer (more reveals or money features).
- Implemented welcome email (Task 27, 88a6866): awaited-but-wrapped sendSystemMail in register action, personalized subject with first name + actual credit amount, body = 3 onboarding moves (profile → Lead Finder → pipeline), deep link {base}/?view=leads, reply-to team inbox, never blocks signup. Typecheck clean.
- Queued behind deploy key v2 authorization: commits 8319482 (stale-icon redirects) + 88a6866 (welcome email).

Stage Summary:
- Pending push: 8319482 + 88a6866. BLOCKER: user must add deploy key v2 (stored durably in .git/hp-deploy/ now).
- Pricing brainstorm delivered in chat: strategy is winning for ACQUISITION; retention needs annual plan, pause-not-cancel, rollover, win-back emails; Boss tier needs stronger differential.

---
Task ID: 28
Agent: Super Z (main)
Task: Deploy Tasks 26+27 after user authorized deploy key v2; verify in prod.

Work Log:
- User added deploy key v2; push c7d8855..88a6866 succeeded (Task 26 redirects + Task 27 welcome email).
- New build live 19:43 UTC. Verified: /dashboard → 308 /?source=pwa, /leads → 308 /?view=leads, /invoices → 308 /?view=invoices — stale home-screen icons now self-heal.
- Smoke: /api/auth login proper error JSON, GET / 200, manifest 200.

Stage Summary:
- Production runs 88a6866. Welcome email now sends on every signup (awaited, non-blocking). Legacy PWA 404 eliminated.
- Durable infra proven: .git/hp-deploy/ (shim + key + worklog mirror) survived the mid-session reset.

---
Task ID: 29
Agent: Super Z (main)
Task: Pricing strategy live + add-contact save bug + full E2E QA for production.

Work Log:
- Task 28 (6d563ff): pricing package — Boss 12 verified reveals (fixed the R39.8 vs R49.9 per-lead inversion), annual plans (R1,990/R4,990 = 2 months free) with Monthly/Annual toggle in GrowView, Subscription.billingCycle + pausedUntil schema fields, plan reveal credits auto-granted on every activation/renewal (webhook + sandbox — closes the paid-but-no-reveals gap: Operator R75, Boss R180), pause-30-days-not-cancel (frozen days, auto-resume shifts renewsAt, /api/subscribe/pause), rollover copy (credits never expire — verified), Landing+GrowView copy aligned.
- Task 29: ClientsView Add/Edit client dialog had NO submit button (save() existed but was unreachable) — restored DialogFooter with Cancel + "Add client"/"Save changes".
- Task 30/30b/30c (ef093c8, c1cc0e6, 7a3182d): lead discover 504 root cause chain — (a) stage budget, (b) REAL cause: callGemini keys×models each re-arming a fresh 55s timeout → chain-wide deadline, (c) OSM 3-mirror chain ×30s + sweep + Nominatim could stack 180s → wall-clock deadline through every stage. Discover now always answers honestly within ~50s.
- scripts/e2e_prod_qa.mjs: 21-check E2E (register→session→mail→wallet R99→profile→discover→reveal honesty→clients CRUD→invoice→task→finance→subscribe annual→quota grant→pause/resume→Boss R4,990→logout→session cleared). Final result 19 PASS / 0 FAIL (2 informational skips).
- UI QA via agent-browser on prod: signup with CityField+Tag location works, welcome tour, Clients → Add Client dialog has Cancel+Add client buttons, full save flow produced "Client added — Thandi Mokoena is now in your CRM." toast; GrowView shows Monthly/Annual toggle flipping buttons to R1,990/yr + R4,990/yr. Screenshot: download/qa_grow_annual.png.
- QA-run emails land on hustleqa.example.com (fake domain) — Resend accepts then bounces; harmless.
- YOCO_SECRET_KEY appears NOT set in Vercel prod (subscribe returned sandbox:true) — worth flagging to the user for real payments.

Stage Summary:
- Production runs 7a3182d. E2E 19/0. All user-reported issues fixed (pricing update, save button, 504).
- Durable infra: .git/hp-deploy/ survived multiple resets; e2e script committed under scripts/.

---
Task ID: 31
Agent: Super Z (main)
Task: Mobile UX overhaul (top bar unreachable), inventory, push notifications, seamless team invites, per-business mail identity, 5km lead finder, stage filter, simple messaging.

Work Log:
- Diagnosed "can't tap top bar" — small tap targets, no safe-area padding, no thumb-reach navigation. Fixed: 40-44px targets, env(safe-area-inset-top) on header, mobile BOTTOM NAV (Home/Leads/Tasks/Invoices + More→drawer), one-time tilt-tip dialog (standalone+phone only, localStorage hp_tilt_tip_dismissed).
- Inventory: InventoryItem model + /api/inventory (GET/POST/PATCH adjust±/DELETE) + InventoryView (add dialog, ±1 quantity, low-stock badge, stock/retail value KPIs). New nav item after Tasks. ViewKey + page.tsx validation updated.
- Tasks: destination dropdown now Personal | Business | Team(s). Business = teamId null + isPrivate false, shown with Business badge.
- Lead Finder: CityField gained onCoords (fires on GPS fix, cleared on edit; raw coords handed up even when reverse geocode fails). Discover sends lat/lng → Gemini prompt: "within a 5 km radius of GPS pin…" + CONTACT DETAILS ARE THE PRIZE rule (website+phone+email prioritised, never constructed). OSM fallback searches 5000m radius around the pin, skipping Nominatim. Auto-add: results saved to pipeline automatically (localStorage hp_discover_autoadd, default ON) with "✓ in pipeline" badges; manual flow retained when toggled off. Engagement: rotating status steps + elapsed-seconds counter + progress bar during the honest ~40s search.
- Pipeline: stage filter Select (All stages / Contacted / Qualified / Quote Sent / Won / Lost) — filters kanban columns and list.
- Teams: invite requires NO existing account — TeamInvite model parked by email + invitation email (register link); /api/auth register auto-joins pending invites and returns joinedTeams. Owner sees pending list with cancel (DELETE /api/teams?inviteId=). Existing accounts still added instantly with a notification email.
- Mail identity: userSendingIdentity() — project/business name → "<label> via HustlePortal <slug>@hustleportal.online>"; sendViaPlatform uses it (RESEND_FROM env still wins); MailStatus.sendingAs surfaced in MailView status line.
- Push: web-push dep; VAPID keys auto-generated into PlatformConfig (no env access needed); PushSubscription model; public/sw.js (push + notificationclick routing); /api/push GET key + POST subscribe/unsubscribe/test (subscribe sends a welcome push); PwaNotifications component (sidebar compact opt-in + Profile card with Send test); vercel.json cron daily-reminders 05:00 UTC (07:00 SAST) pushes tasks-due-today summary (CRON_SECRET optional).
- Landing hero: "Tell us what you do. We find your customers." + sub "You tell us what you sell. Our AI finds verified leads near you and loads them into your pipeline — ready to call, ready to close. Simple."
- tsc clean (tracked files), next build OK, pushed 7a3182d..21b9e44.

Stage Summary:
- Production deploying 21b9e44. All 8 user-reported items implemented (top bar, messaging, mail identity, lead finder location+prompt+auto-add+engagement, notifications, stage dropdown, tasks personal/business, team invites, inventory).
- Notes for user: VAPID/keys need no setup; vercel.json cron active on deploy; optional env CRON_SECRET hardens the cron; web-push requires HTTPS + installed app on Android (iOS 16.4+ requires Add-to-Home-Screen first).

---
Task ID: 32
Agent: Super Z (main)
Task: AI 403 "Google blocked the AI request" root-fix + per-section tutorials + custom email goals + task comment threads.

Work Log:
- DIAGNOSIS (prod probes, scripts/diag_ai_403*.mjs): user's own Gemini key under Integrations is 403-blocked by Google (Generative Language API disabled/restrictions) AND platform key search-grounded calls were 429-quota-limited; plain generateContent was healthy (pitch 200 in 7.6s). bestError ranked the user 403 (9) over platform 429/timeout and returned EMPTY second-cause clause for OTHER → user saw ONLY the 403 advice; the 429 chain also burned the 30s budget and starved the OSM fallback (discover → 0 leads).
- gemini.ts hardening: 403/429 now key-level fatals (break to next key immediately — no 4-model retry on a blocked key); shortOtherCause never empty (covers PERMISSION with exact fix, EMPTY, OTHER/timeout); fallback-success returns notice ("your key was blocked — this answer came from HustlePortal AI"); exported validateGeminiKey (ListModels probe + AIza shape check).
- Save-time validation: PUT /api/settings validates GEMINI_API_KEY instantly; IntegrationsView shows green/amber verdict card + toast with the exact Google fix (fresh key at aistudio.google.com/apikey / enable Generative Language API / clear restrictions). Key still saved — starts working the moment Google-side is fixed.
- Notice surfacing: discover/business-url/sales-pitch/generate-email forward `notice`; LeadsView prepends to the results note; ProfileView toasts it on analysis/pitch success.
- SectionTutorial system: tutorials.ts registry (19 sections, brand-voice steps) + SectionTutorial.tsx (floating thumb-reach Tutorial button, auto-opens ONCE for 8 core views via hp_tut_seen_<view>, hp:section-tutorial event for replay); mounted in AppShell next to WelcomeTour.
- MailView custom goal: "✍ Write my own goal…" option with free-text input (e.g. "Welcome email for my team"); generate-email already accepted arbitrary goals.
- Task comments: TaskComment model (schema additive) + /api/tasks/[id]/comments GET/POST (creator/assignee/team-member visibility) + TasksView inline discussion threads (bubble with live count, chat-style, Enter-to-send) + _count includes on task list/create.
- Schema push happens on Vercel via build.mjs step 1 (db push with prod DATABASE_URL). tsc clean, next build clean.
- Deployed: e417a7b..8a0ba1e (8a0ba1e).

Stage Summary:
- User-facing: their 403 key is now diagnosed at paste-time with the exact fix; even with a broken key every AI feature keeps working on the platform key WITH an honest notice; platform 429 no longer starves the map fallback; every section has a Tutorial button + one-time walkthroughs; email goals are free-typable; tasks have team comment threads.
- Follow-ups for user: (a) their own Gemini key still needs the Google-side fix (or remove it — AI keeps working); (b) platform search-grounding 429 is quota-cooldown, retry clears it, OSM fallback covers meanwhile.

---
Task ID: 33
Agent: Super Z (main)
Task: "AI still not reading my business website" root-fix + sealed task records (sent/opened timestamps) + NPO 30% rate + dash-free outcome copy.

Work Log:
- DIAGNOSIS (prod probes): (a) user typed businesshustleco.za (dead address, HTTP 000) instead of businesshustle.co.za — app only said "could not reach"; (b) with the correct domain the 9,314-char site text WAS fetched but the single big AI payload (profile+3 pitches, 1,200 token default/30s) timed out; (c) platform key free-tier quota then drained to persistent 429s (per-model buckets).
- business-url redesign: domain rescue (probe businesshustle.co.za / .co.za / www variants on DNS failure + notice "we read X instead"), profile-FIRST compact AI pass (900 tok/28s), pitch drafts as best-effort enrichment only if clock allows, and a NO-AI FLOOR: extractFromHtml reads og:site_name/title/description/mailto/tel/SA-phone so the profile fills from the site's own stated facts even when AI quota is gone. Rescue notice survives AI failure. tsc+build clean.
- Sealed task records: TaskEvent model (append-only, sha256 hash chain, seq, denormalised actorName) + lib/taskrecord.ts (recordTaskEvent/verifyChain). Wired: create→SENT/CREATED, PATCH→STATUS ("moved to Done")/SENT on reassign/EDIT, comments→COMMENT, GET /api/tasks/[id]/record → seals OPENED on first non-creator read + returns {events, verified}. Tasks GET attaches _openedAt (earliest OPENED per task).
- TasksView UI: ShieldCheck "record" button per task → timeline (actor, detail, en-ZA timestamp, #seal hash) + "verified" badge; emerald "Opened" chip on rows whose assignee opened.
- NPO 30%: plans.ts (NPO_DISCOUNT_RATE/priceWithNpoDiscount/isValidNpoNumber/normalizeNpoNumber), Subscription.npoNumber, subscribe POST validates (6-digit, e.g. 044-291) + discounts both cycles (Operator R139.30, Boss R349.30, annual R1,393/R3,493), GrowView nonprofit card (apply/remove, localStorage persistence, struck-through originals, honest renewal-certificate line), landing pricing mentions it.
- Copy pass (Landing+GrowView+new copy): removed every " — " separator, power-word outcome phrasing, vision line "owner-operators, growing teams and organisations of any size, including registered nonprofits".
- gemini.ts 429 rework: 429 is per-model quota (not key-wide) → rotate to next Flash model + honour Google's named retryDelay when ≤8s (once per key:model); 403/KEY_INVALID stay key-level fatals.
- Deploys: e16c722 → ed91ca1 → f33b282 → ccceac9 → 036951f. scripts/verify_task33.mjs: 21 PASS / 0 FAIL vs prod (rescue+facts, records chain incl. SENT "Alice Record sent to Ben Open"/OPENED "Ben Open opened it"/STATUS, NPO amountCents=13930).

Stage Summary:
- Production runs 036951f. The user's exact failing flow now works: www.businesshustleco.za → rescued → Business Hustle name+tagline saved to profile in ~5-29s, with or without AI quota.
- Notes for user: (a) their own Gemini key under Integrations is STILL 403-blocked Google-side — remove it or paste a fresh key from aistudio.google.com/apikey to unlock full AI depth (positioning + pitch drafts) during busy minutes; (b) platform free quota recovers each minute/day — floor keeps profiles flowing meanwhile; (c) YOCO_SECRET_KEY still not set in Vercel prod (sandbox subscriptions).

---
Task ID: 34
Agent: Super Z (main)
Task: Google Analytics advice + wiring, My Projects hub (monday.com style), task descriptions with voice input + due times + reminders, website-grounded Lead Finder, currency localizer, legal email footer.

Work Log:
- SCREENSHOT DIAGNOSIS: the Vercel dialog was NOT Google Analytics — it was the DNS "Wildcard Domain Override" prompt (a record being added would override the wildcard *.hustleportal.online entry and disable wildcard matching for online.hustleportal.online + *.online.hustleportal.online). Advised: cancel it; GA needs zero DNS records. Also a red "Invalid 'name' parameter" was visible on that page.
- GA4 (GaAnalytics.tsx, mounted in layout): loads only when NEXT_PUBLIC_GA_MEASUREMENT_ID is set in Vercel env; unset = zero footprint. Reports page_view per section change (single-page app → real funnel in GA). POPIA disclosure line added to the landing footer (links Privacy & POPIA + Cookie Policy).
- Projects hub: schema +Project.description, +ProjectMember (projectId/userId unique, cascade); /api/projects/[id]/members GET/POST/DELETE (owner-only, upsert); PATCH +description; listProjects ships members. ProfileView "My Projects" card: per-project name (tap to activate), description textarea + save, leads/clients/invoices counts, member chips with remove, "+ Assign teammate…" select fed by the union of the user's team members, inline delete confirm (default workspace protected).
- Tasks: Details expander on the add bar — description textarea + en-ZA voice dictation (useVoiceInput, Web Speech API, Chrome/Edge/Safari, mic buttons on title + description, honest error lines), due TIME input; date+time resolve in the browser's timezone and ship as a UTC instant. TaskRow shows the notes (line-clamped, Show more) + time chip next to the date.
- Reminders: daily-reminders cron body now lists the day's schedule (top 3 with SAST times + "+ N more"); NEW TaskReminders component (mounted in AppShell) fires a LOCAL notification at the exact due minute while the app is open (service worker when available), 30s tick + 5 min poll, silent no-op without permission.
- Lead Finder: DiscoverDialog gained "Your website (optional)" input; discover route readSellerSite() fetches the site (8s cap, UA, redirect-follow) and extracts title/meta/visible text (1.2k chars) into the prompt as seller context — leads matched to what the business actually sells; graceful when the site can't be read.
- Currency localizer: src/lib/currency.ts (ZAR billing ALWAYS; formatPrice en-ZA comma decimals matching rands(); USD display at R18.50/$ honest rounding; conversionNote discloses Rand settlement); /api/geo reads x-vercel-ip-country, unknown ⇒ ZA ⇒ ZAR (a South African can never be served dollars); useCurrency hook caches one fetch; Landing plan cards + annual line + GrowView prices/buttons/NPO strikethroughs + note lines all route through it.
- Email legal footer: legalFooter() in mailer.ts appended to EVERY platform send (sendViaPlatform branded + sandbox attempts, sendSystemMail branded + sandbox) — BH support sign-off, six point disclaimer (confidentiality with the ACTUAL sending address, liability, viruses, unsolicited email, advice, conduct), © Business Hustle Worldwide · Simple Eternity Holdings (Pty) Ltd, Terms + Privacy links. Gmail sends excluded (user's own identity).
- Deployed da4912e (036951f..da4912e). Production health shows ProjectMember table; /api/geo live (HK egress → USD proves edge detection; ZA → ZAR). scripts/verify_task34.mjs: 24 PASS / 0 FAIL (geo contract, projects CRUD + assign/unassign via team auto-join, task description + timed dueDate + PATCH, website-grounded discover 14.9s honest OSM answer, currency formatting incl. R139,30 en-ZA).

Stage Summary:
- Production runs da4912e. GA4 is wired and inert until the env var lands; Wildcard dialog: cancel, nothing else needed.
- User notes: (a) GA = create GA4 property → Measurement ID G-… → Vercel env NEXT_PUBLIC_GA_MEASUREMENT_ID → redeploy; (b) voice dictation needs Chrome/Edge/Safari + mic permission; (c) exact-time reminders fire while the app is open — the 07:00 SAST push carries the day's timed schedule; (d) non-SA visitors see converted estimates, billing stays ZAR.

---
Task ID: 35
Agent: Super Z (main)
Task: AI Lead engine root-fix (drained user key benched + per-key model cache) + conversion engine (free-plan gates, one upgrade dialog) + live system status panel.

Work Log:
- PROD DIAGNOSIS: diag_ai_403_v2 probe — platform key HEALTHY (pitch 200 in 7.5s); discover returned 0 leads in 50.3s (search-grounding quota + slow map run, retry case). User's NEW AI Studio account (businesshustleworldwide@gmail.com) screenshot shows a PLAYGROUND banner ("Upgrade to unlock Gemini 3 Flash Preview") which does NOT block API keys; their OLD drained key from seatlholojacob@gmail.com is still saved under Integrations and fires FIRST on every call (429 tax). User action: create key at aistudio.google.com/apikey on the new account, paste under Integrations (save-time validation verdicts), optionally same key into Vercel env GEMINI_API_KEY.
- gemini.ts hardening: per-key model winner cache (Map keyed by key hash — user key and platform key see different model lists); KEY_COOLDOWN 10-min bench — key-level fatals (403/invalid) AND PerDay 429 walls demote a key to the BACK of the chain so one drained key no longer taxes every request; PerDay detection benchKey()s without breaking the per-model rotation for RPM 429s.
- Conversion engine (server = only place a limit is real): src/lib/limits.ts (FREE_LIMITS discover=5 / inventory=3 / emails=6; planState() mirrors subscribe GET lazy lifecycle incl. PAUSED auto-resume + PAST_DUE decay, PAUSED counts as paid; upgradeJson() returns the one 402 shape) + src/lib/upgrade-copy.ts (brand voice: no dashes, simple english, outcome phrasing, honest perks).
- Gates wired: /api/leads/discover (cap raised to 30 for paid; free >5 → 402 BEFORE any AI work), /api/inventory POST (count >= 3 → 402), /api/emails POST (SENT count >= 6 → 402, failed sends never burn one, success returns freeRemaining).
- Client contract: shared api() sees 402 {upgrade:true} → dispatches hp:upgrade event AND throws friendly Error (existing catch blocks just work). src/components/hp/useUpgrade.tsx: fetchPlan/usePlan (module cache, 5-min TTL, /api/subscribe), requestUpgrade(), ONE UpgradeListener dialog (mounted in AppShell; brand perks, "Operator starts at R199 a month. Pause or cancel any time. Annual works out to 2 months free.", CTA → ?view=grow via setView + replaceState).
- Feature UIs: LeadsView DiscoverDialog (default 5 leads, >5 options labelled "· Operator" for free, honest hint line); InventoryView (free slot meter card, "N of 3 free stock slots open", See Operator); MailView (free email meter, per-send countdown toast "N free emails left"); InvoicesView (NEW "Your business logo" card: SVG upload paid-only, preview, Remove, OPERATOR badge + Unlock on Operator for free; per-invoice Logo label gated too; resetForm defaults composer logo to the business logo).
- Invoice logo pipeline: /api/invoice-logo GET/PUT/DELETE (PUT = Operator-gated; server-side SVG sanitize: script/foreignObject/use+href/animate+href stripped, on*= handlers stripped, javascript: URIs stripped; stored as base64 data URL in UserSetting INVOICE_LOGO, 150KB cap); /api/invoices GET now ships logoUrl.
- System status panel: /api/status (auth, 45s instance cache; rows: database SELECT 1, AI engine ListModels probe 4s, email engine RESEND key + readLastSystemSend last-delivered stamp, push VAPID keys in PlatformConfig); IntegrationsView SystemStatusCard mounted FIRST (green/amber dots, ALL SYSTEMS LIVE badge, browser-side voice dictation row, auto-refresh 60s, honest "checked Xs ago").
- QA: tsc clean (tracked files), next build OK (35.3s, no schema changes). Deployed 4219363..0b0f561. scripts/verify_task35.mjs vs prod: 18 PASS / 1 FAIL — the FAIL was the script's own missing profile-fill before sales-pitch (app validation gate, not AI); follow-up scripts/qa35_pitch.mjs with filled profile: pitch 200 in 7.0s → effective 19/19. Verified live: free 402s (discover/inventory/logo, fast pre-AI), status rows ok, sandbox Operator opens every gate, SVG sanitised (script stripped), invoices GET ships logoUrl, DELETE ok.

Stage Summary:
- Production runs 0b0f561. Free plan: 5 leads per search, 3 stock items, 6 emails, no logo. Operator opens all four, in-app one-tap dialog does the selling (calm, honest, no dashboards of hype).
- AI engine: a drained user key now benches itself for 10 min instead of taxing every call; per-key model discovery. With the user's OLD key still under Integrations, notices stay truthful and the platform key answers.
- User next steps: (a) create the API key on businesshustleworldwide@gmail.com at aistudio.google.com/apikey (Playground banner is irrelevant to API keys), paste under Integrations → instant verdict; (b) optionally set the same key as GEMINI_API_KEY in Vercel env for the platform pool; (c) old key self-recovers when its daily quota resets (midnight Pacific).

---
Task ID: 36
Agent: Super Z (main)
Task: Recap + catch-up audit + extensive production QA for full-on production; user reported 429 (old key still in place, not yet rotated).

Work Log:
- AUDIT: backlog vs code. Verified already-built: Yoco full integration (lib/yoco.ts + webhooks + register, needs only YOCO_SECRET_KEY), invoice bank details, service-request dual channel, reset flow, free gates, upgrade dialog, system status. Remaining open items are USER-SIDE env actions only (Gemini key rotation, YOCO_SECRET_KEY, GA id, optional CRON_SECRET).
- BUG FOUND+FIXED (prod): POST /api/service-requests 500'd whenever body omitted urgency — the route tested String(body.urgency || 'THIS_WEEK') against URGENCY but then USED raw String(body.urgency) → "undefined" → URGENCY["undefined"].dueInDays crash. Fixed (normalize once), route now wraps in try/catch and returns honest error+detail instead of opaque 500. Verified live: task created + team email sent (emailSent=true).
- COPY (brand voice, no dashes): rewrote all user-facing AI engine errors (gemini.ts friendlyError/shortOtherCause/NO_KEY/fallback notice) — removed em-dashes, removed the false "HustlePortal AI picked up the request" claim on total failure, clean one-message composition; discover NONE note rebuilt as one clean message (no clause pile-up); mailer.ts user-facing notices + email signature lines de-dashed; welcome email subject+body de-dashed.
- QA: tsc clean (src), build OK 35s. Prod suites: e2e_prod_qa 30/0, verify_task33 21/0, verify_task34 24/0, verify_task35 18/1(known script artifact: sales-pitch needs filled profile), NEW scripts/qa_final_sweep.mjs 44/0 (public surfaces, all data routes, email 6-send gate fires at #7, service request dual channel, AI contract+honesty, sealed task record chain, session lifecycle). diagnose probe: platform key ACCEPTED, 45 models visible — 429s are purely quota, exactly as diagnosed.
- Deploys: 6ad74bc (copy+surfacing) then 7d82537 (urgency fix). Both verified against https://www.hustleportal.online.

Stage Summary:
- Production runs 7d82537. QA: 5 suites, 137 checks, 0 real failures. One real prod bug fixed (service requests).
- User next steps (env actions only they can do): (1) rotate Gemini key — new key from aistudio.google.com/apikey on businesshustleworldwide@gmail.com → paste under Integrations (instant verdict) AND replace GEMINI_API_KEY in Vercel env → redeploy; (2) YOCO_SECRET_KEY sk_live_/sk_test_ in Vercel → redeploy → Setup Checklist one-click webhook register; (3) GA when ready: NEXT_PUBLIC_GA_MEASUREMENT_ID; (4) optional CRON_SECRET.

---
Task ID: 37
Agent: Main agent (Super Z)
Task: Gemini key rotation STILL failing after user rotated key + redeployed; wildcard DNS approved; diagnose root cause with production data.

Work Log:
- Prod probe: registered fresh QA account, ran /api/health + /api/ai/diagnose + live plan call against https://www.hustleportal.online
- Health: all green, aiPlatformKey=true, yoco=true, 29 tables
- Diagnose verdict: platform key (NEW AQ.Ab8…oE0g format) VALID (ListModels 200, 45 models), but generateContent 429 on gemini-flash-latest — new key's quota ALSO blocked
- Patched src/lib/gemini.ts: per-(key,model) quota bench — PerDay 429 or zero-limit benches that model 30min/6h so drained models stop heading every walk
- Patched src/app/api/ai/diagnose/route.ts: 429 no longer stops the walk (tests ALL models to find headroom), quotaForensics() parses bucket/quotaId/limit/retryDelay, scenario advice (zero limit → billing or new project; PerDay → reset ~09:00 SAST; PerMinute → self-clears)
- Committed dd961f9, pushed main, awaiting Vercel build

Stage Summary:
- Rotation was done CORRECTLY (Vercel env has the new key); the blocker is Google-side quota on the new key's project
- Next: re-run diagnose after build → read forensics → user-side fix is billing or fresh key in a different project (if limit 0) or wait for 09:00 SAST reset (if PerDay)
- Wildcard ALIAS *.hustleportal.online → cname.vercel-dns-017.com confirmed live and harmless (user approved it mid-work)
- Build 3194af3 live. QA sweep: 44 PASS / 0 FAIL. Diagnose now reports bucket=GenerateRequestsPerDayPerProjectPerModel-FreeTier, retryDelay≈81500s (reset ≈ midnight UTC ≈ 02:00 SAST). Status panel AI row honestly reports drained daily quota. 2.5-flash variants 404 on generation for this project (Google-side); flash-latest + 3.5-flash are the usable pair, both day-blocked.
- ROOT CAUSE (final): rotation was correct; new key valid; DAILY free-tier bucket per project+model exhausted by today's testing. Fix is user-side: enable billing on the key's Google Cloud project (Tier 1) or wait for the 02:00 SAST reset and ration scans.

Stage Summary:
- Engine: per-(key,model) quota bench (30min PerDay / 6h zero-limit) shipped dd961f9
- Diagnose: full-model 429 walk + quotaForensics + scenario advice shipped dd961f9
- Status panel: real-generation probe, honest AI row shipped 3194af3
- AI down ≠ app down: sweep green, gates verified, honest 502s in brand voice
