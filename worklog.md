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

---
Task ID: 38
Agent: Main agent (Super Z)
Task: User added YOCO_SECRET_KEY (verified matches code env name) + wants FREE TIER to work consistently, no billing; AI Lead Finder still hitting daily limits.

Work Log:
- Confirmed YOCO_SECRET_KEY is the exact env var read by src/lib/yoco.ts + health check; payment rail ready
- Read discover/reveal routes: 1 AI call per scan, 1 per reveal — frugal; the problem is daily bucket SIZE, not call volume
- KEY INSIGHT: free-tier quota is PER MODEL (GenerateRequestsPerDayPerProjectPerModel); ListModels shows ~10 usable flash models but old chain only used flash-latest + 3.5-flash
- Rebuilt gemini.ts: MODEL_PREFERENCE extended to 11 flash models; resolveModels now returns FULL pool (preference entries + any other visible flash Gemini models, gemma/pro/excluded families filtered); callGemini round-robins over the pool via per-key cursor — bursts spread across per-model RPM buckets, day spreads across per-model RPD buckets
- PerDay 429 no longer benches the whole KEY (only the drained model); QUOTA platform copy now says daily reset ~02:00 SAST + map fallback
- Diagnose probes pool members: flash-latest, flash-lite-latest, 3.8-flash, 3.5-flash
- Deploy hiccup: sandbox reset wiped paramiko; restored with python3 -m pip install --break-system-packages paramiko (RUNBOOK: .git/hp-deploy shim + keys survive resets, the pip package does not)
- Pushed f95bfda, awaiting build

Stage Summary:
- Free-tier capacity now = pool_size × per-model daily bucket (was 1-2 models' worth)
- Yoco payment rail verified configured
- Next: post-build diagnose to map which pool models have headroom + live discover scan test

---
Task ID: 39
Agent: Main agent (Super Z)
Task: Free-tier consistency pass — Yoco verify, pool round-robin, OSM fallback revival, honest 503 handling.

Work Log:
- Yoco: YOCO_SECRET_KEY is the exact env var read by src/lib/yoco.ts + health; /api/health reports yoco:true — payment rail ready
- Engine (f95bfda): MODEL_PREFERENCE 4→11 flash models; resolveModels returns FULL discovered pool; callGemini round-robins via per-key cursor; PerDay 429 no longer benches the whole key; day-aware QUOTA copy
- Diagnose (013bd4d): probes the FULL pool (stop at first success, walk all on failure), 503 overload class + advice, verdict names the live model
- 503 copy: engine now says "Google is shedding free-tier traffic" instead of blaming quota
- OSM (df8c6db + d474f41): PROBED the chain — all Overpass mirrors refuse datacenter IPs (de instant-refused, kumi/coffee 30s timeouts from sandbox); Nominatim category sparse in Soweto (1 bar); Photon works but is name-text search. Fixes: 6 mirrors (added mail.ru, osm.ch, osm.jp), Photon keyless POI fallback, 10s/mirror + 8s geocode time discipline, discover note surfaces the real map reason

Stage Summary:
- Free-tier capacity = pool size × per-model buckets (was effectively 2 models); bursts still rest the engine — spacing scans out is part of the deal
- Map fallback is honest but data-thin in townships; metro scans return some results
- 4 commits deployed: f95bfda, 013bd4d, df8c6db, d474f41
- Billing (Tier 1) remains the single-lever fix when the user chooses; everything shipped works either way

---
Task ID: 40
Agent: Main agent (Super Z)
Task: User sees My Projects but no option to add a new project beyond 2 — make creation discoverable.

Work Log:
- Root cause: no cap anywhere (POST /api/projects allows unlimited); the only create path was an input labeled "Add another company workspace" buried at the bottom of the Company workspace card, while the My Projects card (where users look) had none. Naming split-brain: workspace vs project.
- ProfileView: replaced buried multi-company input with a first-class "+ New project" button in the My Projects card header; inline create form (name required + optional description) submits on Enter, creates, activates the new workspace, toasts, reloads rows + session.
- Removed the duplicate create input in Company workspace card, left a pointer line to My Projects (one canonical path).
- AppShell ProjectSwitcher footer: "+ Manage workspaces" → "+ New project in Profile & Team"; sets sessionStorage hp:open-new-project then navigates — ProfileView consumes the flag on mount, opens the form and smooth-scrolls to the My Projects card (robust against conditional view mount timing).
- Copy audit: no dashes anywhere in new strings.
- tsc clean on touched files, build OK 35s, pushed 5f5fa15.
- Prod verify scripts/verify_project40.mjs: 11/11 PASS — default auto-created, create 2nd + 3rd (beyond 2), description persisted, blank name 400, delete returns to 2 with default intact, deployed bundle contains the new UI.

Stage Summary:
- Creating projects now lives where users look: My Projects card, plus a handoff from the top-nav workspace switcher.
- No project cap exists or was added; free users can add as many as they want.

---
Task ID: 41
Agent: Main agent (Super Z)
Task: Lead Finder works again (quota reset) — page felt sticky; user wants a project dropdown on lead generation + leads loading into the chosen project + per-project memory.

Work Log:
- ROOT BUG FOUND: Lead.projectId is nullable and POST /api/leads NEVER set it; attachDefaultProject exists but is called nowhere. Every app-created lead (discover, manual, CSV) landed projectId=null, invisible in per-project counts.
- API: POST /api/leads now resolves projectId via resolveProject (explicit > default), so no lead is ever orphaned. GET /api/leads accepts projectId filter (ALL = classic mixed view; bogus id 404). Import route does the same for CSV rows. Discover route teaser now grounds on the REQUESTED project, not always the default.
- UI DiscoverDialog: "Save leads to" project dropdown at top (defaults to active workspace), re-aim mid-dialog; per-project memory in localStorage (hp_discover_mem) restores definition/city/siteUrl/limit per project on open and on switch; saves pass projectId; saves parallelized with Promise.allSettled (5 leads = one round trip, not five).
- UI LeadsView: workspace filter dropdown (follows active workspace by default, All workspaces option covers legacy null-project rows); soft refresh (skeletons only on cold board, board stays put on refetch); 350ms debounced company search now actually searches; LeadCard memoized with stable openLead callback; filteredLeads/pipelineValue memoized.
- Quick capture + CSV import also target the active workspace.
- Deploy shim: paramiko wiped by sandbox reset, restored per runbook (pip --break-system-packages).
- Pushed 250ae01. Prod verify scripts/verify_project41.mjs: 11/11 PASS (targeting, fallback, counts, scoping, 404, discover accepts projectId, bundle carries new UI). First run showed 2 FAILs that were script assertion bugs (route returns 200 not 201), product behavior was proven correct by the counts check in the same run.

Stage Summary:
- Leads are now hard-scoped to projects end to end: dropdown targets, every create path stamps projectId, list filters per project, search remembers per project.
- Note: discover teaser on the throwaway QA account returned mode=NONE (no profile + daily bucket drained at test time) — honest empty state, not a regression; user's own scans already work.

---
Task ID: 42
Agent: Main agent (Super Z)
Task: Switching projects/organisations must repopulate the lead pipeline, clients and invoices with that workspace's data. Data stayed the same despite switching.

Work Log:
- ROOT CAUSE (4 gaps): (1) GET /api/clients and GET /api/invoices had NO projectId filter, so views reloaded into the same rows; (2) POST /api/clients and /api/whatsapp/import never stamped projectId (orphans); (3) LeadsView stuck on an explicit dropdown pick (leadProject never reset when the top-bar switcher changed); (4) dashboard was always whole-business.
- APIs: /api/clients GET accepts ?projectId= (ALL or omitted keeps the classic mixed view, bogus id 404, same contract as leads); POST stamps via resolveProject. /api/invoices GET accepts the same filter. /api/dashboard accepts ?projectId= to scope pipeline/byStage/finance (tasks stay personal/team by design). /api/whatsapp/import lands contacts in the requested workspace.
- UI: LeadsView + ClientsView + InvoicesView share one pattern: workspace dropdown (follows active workspace by default, All workspaces covers legacy rows), "the top-bar switcher always wins" (explicit picks reset on switch via useEffect on activeProjectId), soft refresh keeps the board in place while the fresh list arrives. New clients + WhatsApp imports join the workspace you are looking at. Invoice composer targets the effective workspace.
- DashboardView passes the active workspace to /api/dashboard and /api/leads and reloads on switch.
- Client.projectId already existed in schema (Task 34/35 era) — no migration needed.
- BUILD NOTE: gitignored debris (src/app/api/{seed,expenses,goals,notes,payments,time-entries}) breaks local Turbopack builds (imports ensureWorkspaceData which does not exist). Quarantined the six dirs out of the tree for the build, restored after. Vercel never sees them (gitignored). If a future local build fails on those paths, move them out, build, move back.
- Deploy shim runbook held: paramiko pip package wiped by reset, reinstalled (--break-system-packages), keys/shim in .git/hp-deploy/ intact.
- Pushed 250ae01..9d62e45. Production verify scripts/verify_project42.mjs (COMMITTED this time — 40/41 scripts were lost to resets): 21/21 PASS vs https://www.hustleportal.online — client create default-stamp, explicit-target, cross-filter invisibility, mixed view, bogus 404, WhatsApp import targeting, invoice targeting + list filter, leads regression, dashboard scoped 1+1=2 unscoped, bundle carries dropdowns. First run 20/21: script bug (res.json() consumes body before text()) — fixed with plain fetch.

Stage Summary:
- Production runs 9d62e45. Switching workspaces in the top bar now repopulates pipeline, clients, invoices and dashboard numbers, seamlessly. Every create path stamps a workspace; no more orphans.
- Contract note: ?projectId=ALL or omitted = legacy mixed view everywhere; bogus id = 404 with honest error.

---
Task ID: 43 (HOLD)
Agent: Main agent (Super Z)
Task: User asked to switch AI Lead Finder to DeepSeek ($10 credits). MID-TASK user said WAIT: they rotated Google keys (new account) and want to test lead gen on Google first.

Work Log:
- DeepSeek engine BUILT (not pushed): src/lib/deepseek.ts (chat completions api.deepseek.com, key chain user setting DEEPSEEK_API_KEY > env, brand-voice errors, 401/402/429/5xx classes, validateDeepseekKey with REAL /user/balance); settings route allows+validates DEEPSEEK_API_KEY; status route DeepSeek row (platform env + balance); diagnose route deepseek section (key accepted, balance, credits-out copy). Discover route was fully rewired (OSM real-data primary + DeepSeek ranking with server-side anti-fabrication: contacts copied verbatim from source records, non-matching answers dropped) then REVERTED per user request.
- AUTO-COMMITTER STRIKE RISK: background process committed in-progress work as 8d20613 (UUID name). Verified NOT on origin. Local hold commit 4dc07f3 restores Gemini-primary discover; plumbing stays dormant. DO NOT PUSH without user go-ahead.
- PROD PROBE of the fresh Google setup (scripts/diag_fresh_gemini.mjs):
  * Platform key = NEW AQ.Ab8…esXg — rotation IS live in production. ListModels 200, 45 models. gemini-3.6-flash live generation 200 (4 other models 503 shedding at that moment).
  * Lead scan x2: BOTH mode=NONE (quota-class note). OSM fallback: mirrors refuse (chronic datacenter-IP block, Task 39).
  * Plain advisor call: 502 (30s pool walk exhausted in the storm). Minutes earlier the same pool passed.
- DIAGNOSIS: rotated key is VALID; Google free tier is in a bursty 503/quota storm. Pattern across OLD and NEW key: the search-grounded lead scan is the most quota-fragile call (grounding bucket tiny or shedding), plain generation is sturdier, OSM is dead from Vercel IPs. Waiting for 02:00 SAST reset = clean test of whether the grounded bucket refills (bucket) or never was there (structural).

Stage Summary:
- Production UNCHANGED (still 9d62e45 behavior). DeepSeek build parked on local commits 8d20613+4dc07f3 (tip 4dc07f3 = Gemini primary + dormant plumbing).
- Decision fork for user: (1) 24h Google trial after 02:00 SAST reset, one spaced scan; (2) ship DeepSeek plumbing (missing bit: IntegrationsView key card) for quota-free ranking, Gemini kept only for grounded scan; (3) if grounding proves structural-blocked: search API (Brave/Serper free tier) feeding real results to DeepSeek ranking = full lead-gen off Google for near-zero cost.

---
Task ID: 43
Agent: Super Z (main)
Task: "Gemini on my other profile of the activated api key? We must make this work.. atleast even if its once/twice for a presentation. If i cant use deepseek, can i use z.ai? can i pay as i go here? you can browse the internet right?" — research the options, then make the AI Lead Finder work regardless of Google's mood.

Work Log:
- Researched live (web search + z.ai docs): Gemini free tier slashed since Dec 2025 (Flash 250→20 RPD, further Apr 2026 cuts, some projects at limit 0) = the "Google is being weird" root cause. DeepSeek: pay as you go via card/PayPal, but NO web browsing (ranking only). z.ai: pay as you go on the Billing page, GLM-4.6 $0.60/1M in + $2.20/1M out, Web Search in Chat tool $0.01/use, search-prime engine, docs.z.ai/guides/tools/web-search.
- Resurrected the parked DeepSeek plumbing (local commits 8d20613+4dc07f3) and shipped it.
- NEW src/lib/zai.ts: GLM engine (api.z.ai/api/paas/v4), model walk glm-4.6→4.7→5.3-flash, web_search tool (search-prime, count 10) when search:true, key chain user setting ZAI_API_KEY > env, brand-voice error classes (401/402/429/5xx/timeout), validateZaiKey with REAL micro generation probe.
- /api/leads/discover rewired to an engine chain: 1) Gemini grounded (22s) 2) z.ai GLM grounded (20s, gentle notice names which engine carried the scan) 3) OSM real directory + DeepSeek ranking (anti-fabrication: contacts copied verbatim from source records, non-matching answers dropped) 4) raw OSM 5) Explee; honest combined error names the most actionable cause (money/key beats quota).
- /api/settings: ZAI_API_KEY allowed+masked+save-time probe; validation var retyped to a union (Gemini/DeepSeek/z.ai verdicts).
- /api/status: new z.ai GLM engine row (platform env key, real 8-token probe, 401/402/429 copy).
- /api/ai/diagnose: zaiDiag section (key source, masked, real probe, verdicts); "no Gemini key but z.ai live" verdict added.
- IntegrationsView: z.ai GLM + DeepSeek key cards with save-time verdict notes (engineVerdicts state).
- Fixed parked-commit type errors: enrichOsmWithDeepseek null-company guard, zai keySource narrowing, settings validation union.
- Quarantine build dance OK (34.7s), scripts/verify_task43.mjs (committed via git add -f), pushed ba0e4e5, production verify 18/18 PASS.

Stage Summary:
- Production ba0e4e5. Lead Finder = engine chain, no longer hostage to Google. z.ai GLM = recommended engine for the $10 budget (~2c/scan ⇒ hundreds of scans); DeepSeek ranks OSM records; Gemini still first when it works; OSM floor guarantees real leads with zero keys.
- User action: create z.ai key (z.ai open platform → API Keys), top up on Billing page, paste under Integrations → instant save-time probe verifies. Same for their other-profile Gemini key (free tier now tiny: fine for once/twice, not daily).
- Open: user has NOT yet supplied the real z.ai key (or chosen user-level vs platform env). Yoco secret verification still pending. AI budget governance now = z.ai/DeepSeek spend (no more 02:00 SAST quota narrative for z.ai).

---
Task ID: 43b
Agent: Super Z (main)
Task: User decided "Lets do that" on buying $10 z.ai credits. Prep the platform so the moment their key is saved, their scans run on their credits first.

Work Log:
- Priority flip in /api/leads/discover: a personal z.ai key (UserSetting ZAI_API_KEY) now puts the GLM engine FIRST in the chain (user credits, deterministic behaviour, ~2c/scan); Gemini demoted to automatic backup. Without a personal key: Gemini first, platform z.ai pool second (unchanged for everyone else).
- Gemini rescue after z.ai failure names money/key causes once, gently (BALANCE/KEY_INVALID/RATE → "a top up on the z.ai billing page puts it back in front").
- Shared aiSearchResponse() helper dedupes the two AI_SEARCH return blocks; docstring updated; Integrations z.ai card retitled "pay as you go engine" with FIRST-copy.
- tsc clean, quarantine build 34.5s OK, pushed 085b674, production verify 18/18 PASS (verify exercised the new path: fake z.ai key ran FIRST and was honestly rejected).

Stage Summary:
- Production 085b674. Engine chain final: user z.ai key ⇒ z.ai → Gemini → OSM(+DeepSeek rank) → Explee; no user key ⇒ Gemini → platform z.ai → OSM → Explee.
- Waiting on user: buy $10 at z.ai Billing, create API key, paste under Integrations (save-time probe verifies in the same minute). Their other-profile Gemini key can also ride along as extra backup.
- Cost math communicated: ~$0.02/scan ⇒ $10 ≈ 500+ grounded scans.

---
Task ID: 43c
Agent: Super Z (main)
Task: User saved their z.ai key in Vercel env as GLM_key and redeployed. Make the AI Lead Finder actually use it (demo grade).

Work Log:
- Root cause one: the engine only read env ZAI_API_KEY, so GLM_key sat invisible. getPlatformZaiKey() now walks aliases (ZAI_API_KEY, GLM_key, GLM_API_KEY, GLM_KEY, ZAI_KEY) and strips surrounding quotes. Platform key present now also flips zaiFirst in discover (GLM leads the chain, Gemini demoted to backup).
- Root cause two (found via live debugging + new glmTrace): the key IS accepted but the GLM account behind it refuses every scan sized request with 429 on BOTH doors (plain 8 token probes pass; 900/1600 token grounded scans 429; free flash rung hangs 10s+ on tool calls, then glm-4-flash 400s). Diagnosis probes: plain 200 and web search probe 200 earlier in the day, then hard 429 wall = trial/daily quota or zero balance on the account, not a code bug.
- Engine rebuilt as a two door walk: ENDPOINTS = Zhipu bigmodel first (wrong door 401 is cheap) then z.ai; sticky door memory (10 min TTL, warm instance) keeps the last door that answered in front; arrears sniffing (Zhipu code 1113 / balance words) skips paid rungs straight to free flash rungs; pacing is per door (a paced door no longer blinds the walk); flash attempts capped at 10s so a hung model steps aside; paid attempts 28s; discover scan budget raised 20s to 34s; adaptive maxTokens (cap<=3 leads = 900 else 1600).
- Honesty plumbing: probeZaiKey shared by status row, save time verdict and diagnose; diagnose now also probes the web search tool and keeps the door's own error words (searchOk/searchRaw); status row copy adapts (Live on z.ai / via Zhipu / top up / rejected); scan note names the door that carried it.
- QA: scripts/probe_glm_live.mjs (demo proof, spends ~3c when credits live), scripts/scan_once.mjs (one shot scan with glmTrace), scripts/diag_zai_only.mjs, verify_task43.mjs made state agnostic. All committed via git add -f.
- Production verify 18/18 PASS (ecb7b3f). Real scan still mode NONE: the account needs its $10 top up (or daily quota reset ~18:00 SAST) before glm-4.6 serves scans; every rejection along the way was honest and named the cause.

Stage Summary:
- Production ecb7b3f. Engine chain final: platform or personal z.ai key puts GLM first (two doors, Zhipu first, door memory) -> Gemini grounded backup -> OSM + DeepSeek ranking -> Explee; honest notes throughout; debug:true returns glmTrace.
- Waiting on user: top up $10 on the z.ai billing page on the SAME account the key came from (or wait for the Zhipu daily reset around 18:00 SAST for a few free scans). The moment credits land, scans run with no code change needed.

---
Task ID: 43d
Agent: Super Z (main)
Task: User reported "Search load failed" after loading the $10 and the api key. Ensure the lead generation system actually works.

Work Log:
- Live trace diagnosed the real failure chain: zhipu/glm-4.6 429 with the door's own words "余额不足或无可用资源包,请充值" (insufficient balance OR no available resource package) — the GLM web search tool is billed apart from model tokens on the Zhipu door and this account cannot pay for it; free flash rungs then hung 10s each (glm-4.5-flash) or 400ed (glm-4-flash) on the tool payload; Gemini 503ed (free tier shedding); the keyless OSM map directory was skipped because a fixed 32s elapsed gate saw the budget already burned. Result: mode NONE, 0 leads, ~39s, user sees "Search failed".
- zai.ts: readDoorError() captures the door's own words once per failure; trace lines now carry status + words; on a SEARCH walk one arrears refusal ends the whole walk in one knock (~0.6s, one key = one account) with BALANCE copy naming the door and the fix; plain walks keep the free rung fallback; search walk bench (TIMEOUT 10 min, 400 60 min) so dead rungs stop taxing later scans; probeZaiSearch() added (one tiny grounded request, sticky door first).
- status route: z.ai row now probes the SEARCH tool after a plain 200 and tells the truth ("Live for AI answers on GLM credits, but the web search tool was refused (not covered by the current balance). A top up on the billing page brings web grounded scans here. Google and the real map directory carry scans meanwhile.").
- discover route: OSM gate is runway based (>16s of the 50s budget left) instead of a fixed elapsed wall; zaiWhy(reason, who) notice on every fallback exit (Gemini success AND both OSM branches) names the door, the cause and the fix gently; glmTrace attached to OSM responses too when debug.
- osm.ts: Overpass phase cap 12s per query (mirrors hang from datacenter IPs and were starving the fallbacks); Nominatim category search now sweeps a viewbox+bounded box (~9x10km) around the geocoded point instead of city= which returned the city node itself ("Johannesburg, type city"); both searchNominatimLeads call sites pass place. Probe evidence from sandbox: Nominatim 200 in 0.5-0.9s, Photon category search delivers real POIs (8 supermarkets, 1 bar around JHB CBD).
- QA: scripts/verify_task43d.mjs (committed -f). Production verifies: 10/10 then 11/11 PASS after the trace fix. Real scans now return mode OSM with REAL Soweto businesses (Kwa Lichaba Lounge, Chaf-Pozi, The Net Cafe) in ~27s, honest notice, zero fabricated contacts.

Stage Summary:
- Production f56ad91. Scan chain under a broken wallet + 503 Google: GLM arrears knock (0.5s, door words in trace) -> Gemini (usually fast fail today) -> OSM (Overpass 12s phase -> Nominatim viewbox sweep -> Photon) = REAL leads every time, with a gentle notice naming the door to top up. The lead generation system works again without waiting for money.
- User actions that still unlock the web grounded GLM engine: top up the account that owns the key ON THE ZHIPU OPEN PLATFORM (open.bigmodel.cn) — the door's words say the web search tool has no balance/package there — or generate a key on z.ai if the $10 lives there and swap it into GLM_key. Adding the DeepSeek key (DEEPSEEK_API_KEY in Vercel or under Integrations) turns on AI ranking of the map directory leads.

---
Task ID: 43e
Agent: Super Z (main)
Task: User sent a screenshot of the GLM-5.3 docs page asking "where?" and wants the lead generation system working. Diagnose the live door state, align the engine with the current GLM model family, and make every honest message name the key/money platform mismatch.

Work Log:
- Live diagnose against production: key 5aa56e…CGy2 accepted on the Zhipu door, plain generation OK, but a REAL scan still got zhipu/glm-4.6 → 429 "余额不足或无可用资源包,请充值" — the $10 lives on z.ai (international) while the key was minted on the Zhipu open platform. Search billing follows the key's platform, so the scan path still falls to OSM (which delivered 5 real Soweto leads in 27s, 11/11 PASS).
- False positive found and killed: /api/ai/diagnose claimed searchOk true minutes before the scan was refused, because probeZaiKey(search:true) lets the FREE flash rung answer "Reply: OK" without ever invoking the search tool. zaiDiag now uses probeZaiSearch (pins glm-4.6, walks both doors), same truth as the status row.
- probeZaiSearch prompt now FORCES a real search invocation ("Search the web for one current news headline from Johannesburg…"), max_tokens 64, so an empty wallet can no longer dress up as search ready on the status row either.
- MODEL_PREFERENCE realigned with the docs page the user is reading: glm-4.6 stays the proven workhorse, glm-5.3 + glm-5.3-flash (current generation per docs.z.ai) follow as retirement rungs, speculative glm-4.7 dropped. New missingModelBench: a 400 whose door words name the model as unknown/unsupported benches that rung for EVERY walk (60 min), so a retired flagship never taxes plain generations more than once per instance hour.
- Mismatch story named everywhere, gently: search walk BALANCE error, status row detail, diagnose message, and the discover zaiWhy notice all now say "top up on that platform's billing page, or save a key from the platform that holds your credits".
- Bonus: fixed pre-existing keySource narrowing type error in src/lib/deepseek.ts (same pattern zai.ts already used). App tsc clean; skills/ tooling errors untouched (outside the build).
- QA: build OK 34.2s; verify_task43d.mjs 11/11 PASS pre-deploy; post deploy diag + full scan verify re-run.

Stage Summary:
- Engine chain unchanged and healthy: GLM first (two doors) → Gemini grounded → OSM + DeepSeek ranking → Explee, with real Soweto leads landing even on a broken wallet.
- The ONE user action that lights up web grounded GLM scans: generate the API key ON z.ai (top right "API Keys" on docs.z.ai / z.ai console, where the $10 lives), then save it under Integrations → z.ai card (instant probe, no redeploy) or swap it into Vercel GLM_key and redeploy. Zhipu-minted keys and z.ai credits are two different houses.

---
Task ID: 43f
Agent: Super Z (main)
Task: User replaced GLM_key with a new key ("put the new key in my environment variables on vercel. Lets see if the ai lead finder scan works"). Verify the scan path and identify why the grounded engine still does not carry scans.

Work Log:
- Live diag: fingerprint CHANGED (5aa56e…CGy2 → 34cd02…lXiU), so the new key is live in the serverless runtime. searchOk still false, arrears words on the search probe.
- scan_once trace is DEFINITIVE: one line, zhipu/glm-4.6 → 429 (692ms) "余额不足或无可用资源包,请充值。" A z.ai-minted key would have drawn a 401 on the Zhipu door and a second line for the z.ai door. One Zhipu arrears line = the new key is ALSO a Zhipu open platform key. The user minted twice on open.bigmodel.cn while the $10 lives on z.ai.
- Shipped (452c8f2): the refusing door now names the key's home in both System Status and /api/ai/diagnose ("A billing refusal means that door accepted the key, and a door only accepts keys minted on its own platform"). Billing/pacing refusals (402/429) prove ownership; 401s do not, so ownership is only claimed on billing refusals.
- Deploy hiccup: paramiko was missing again after the sandbox reset (background pip had died silently); reinstalled synchronously, push 83dc39c..452c8f2 OK.
- Post deploy: plain probe hit 429 pacing (probe storm from repeated QA on the free rungs); transient, retries on its own. Search path evidence unchanged.

Stage Summary:
- Production 452c8f2. Engine chain healthy, map directory still delivering real Soweto leads on every scan. The single blocker is platform mismatch: Zhipu key + z.ai credits. The fix is one z.ai-minted key (docs.z.ai top right API Keys button) saved under Integrations or GLM_key. The product now names the key's home platform on every billing refusal, so the mismatch is visible without a debug trace.

---
Task ID: 43g
Agent: Super Z (main)
Task: User sent a Billing History screenshot from z.ai to challenge the "your key is a Zhipu key" story. Correct the record, fix whatever the screenshot proves, and retest.

Work Log:
- CORRECTION of 43e/43f: the billing history shows API Key ID 5aa56e637fa... (the OLD key, same 5aa56e prefix as the masked platform key) billed for INFERENCE on z.ai, plus a Prepaid Resource Pack "100 million GLM-" (Paid). The keys were z.ai keys ALL ALONG. One login serves both doors (a z.ai key passes auth on the Zhipu door), so the "the refusing door is the key's home" inference was wrong and is retracted. The user's $10 became a 100M token Resource Pack, not cash balance (cash $0, bonus $0).
- Root cause finally precise: model inference is covered (billing history: inference postpaid entries Paid), but the WEB SEARCH TOOL is billed as a separate service and neither billing pocket covers it: Zhipu door "余额不足或无可用资源包", z.ai door "Insufficient balance or no resource package. Please recharge."
- Fixed the real engine bug (38e85b6): the search walk's one knock arrears short circuit ended the walk on the FIRST door's refusal and never asked the second door. Now arrearsDoors counts across the walk and the walk only ends with BALANCE after BOTH doors refuse; probeZaiSearch likewise asks both doors and keeps the most informative refusal (billing beats auth).
- Retracted the ownership claims: status row and diagnose no longer say "This key belongs to {door}" (false under shared auth); they now say both doors refused and name the fix (small top up or search bundle where the credits live). discover zaiWhy BALANCE copy aligned.
- Live retest on production 38e85b6: trace shows BOTH doors refusing (zhipu 426ms Chinese words, z.ai 776ms English words), scan still delivered 3 real Soweto leads via OSM with the honest both doors notice. The walk fix is proven live; the remaining blocker is genuinely billing side.

Stage Summary:
- Production 38e85b6. Engine chain final and honest: both doors asked, real leads every scan, no fabricated contacts. The ONE remaining user action: on z.ai billing, either Add Payment with a small amount (search calls cost a fraction of a cent, $2 to $5 is hundreds of grounded searches) or buy a search bundle under Usage Bundles. The 100M token pack keeps paying the model side; it just cannot pay the web search tool.

---
Task ID: 43h
Agent: Super Z (main)
Task: User is on aistudio.google.com creating the free Gemini key for the AI Lead Finder search layer. Reported their new key starts with "AQ" not "AIza", and asked whether it goes in the phone app (Integrations) or Vercel env. Fix whatever blocks the save, deploy, and hand back the paste step.

Work Log:
- Verified via web search: Google moved AI Studio keys to new "auth keys" starting with AQ. (classic keys remain AIza...). New keys work on the native generativelanguage endpoints but ride the documented x-goog-api-key HEADER instead of the ?key= query param (docs Oct 2026: "all new keys created in AI Studio are automatically created as auth keys").
- Found the save gate would reject valid AQ keys: validateGeminiKey shape check only knew /^AIza[0-9A-Za-z_-]{30,}$/ and every direct fetch hardcoded ?key=.
- Shipped a key-generation-agnostic carrier: new exported geminiFetchTarget(key, pathAndQuery) in src/lib/gemini.ts picks the carrier by prefix (AIza keeps ?key=, AQ gets x-goog-api-key header). All four Gemini fetch sites now use it: resolveModels ListModels, callGemini generateContent, validateGeminiKey probe, status route live probe, diagnose route ListModels + live generate. Shape check now accepts both /^(AIza…|AQ\S{30,})$/, message names both formats, dead BASE const removed from diagnose route, Integrations placeholder now "AIza… or AQ… (Google issues both)".
- Local sanity: regex 6/6 (AIza true, AQ. true, AQ/ true, short AQ false, sk-ant false, ya29 false); URL builder verified for both carriers. tsc filtered clean on all four files.
- Read screenshot of user's AI Studio usage dashboard: Free tier badge, success rate back at 100%, real token flow across Gemini 3.5/3.6/3.7/3.8 Flash — the project is healthy; the ~490 x 429 burst around Oct 14 is pacing, not a broken key.
- Context correction absorbed from 43g: the GLM_key is a z.ai key (billing history proved it); the $10 lives in a 100M GLM token pack covering model inference; only the web search tool needs cash. The Gemini free key therefore completes the search layer at $0; no change needed on the z.ai side.

Stage Summary:
- AQ auth key support shipped on top of 38e85b6 (commit pending push). User next step: paste the AQ key under Integrations → Gemini card (instant, no redeploy, probed on save); Vercel GEMINI_API_KEY platform slot is the optional later move for all users. Once saved, the scan chain runs GLM (tokens covered by pack) → Gemini grounded (free Google search) → OSM + DeepSeek fallback. Scan test fires the moment they confirm the save.

---
Task ID: 43i
Agent: Super Z (main)
Task: User demanded plug and play: AI search must work immediately after registration. Their scan still fell through "even with the new key added" (AQ Gemini key). Find why the Gemini leg failed, fix it, and prove fresh-user scans end to end.

Work Log:
- plugnplay_probe (fresh QA user, zero keys) on production: GLM both doors 429 (known), OSM delivered 3 real leads but "AI ranking is resting" (platform DeepSeek key MISSING), and the diagnose verdict was DAMNING: "No key could complete a live AI call".
- KEY DISCOVERY: the platform GEMINI_API_KEY in Vercel is ALREADY the user's new AQ key (masked AQ.Ab8…esXg) — they put it in Vercel instead of Integrations. ListModels with the AQ header carrier: 200, 46 models visible → the AQ carrier from 43h is PROVEN working live.
- The failure: live-generate on gemini-flash-latest TIMED OUT (20s). Google rotated the flash alias to a thinking model; quiet thinking minutes do not fit scan/probe budgets. The alias sat at the head of every pool and probe.
- Shipped (one commit): liteFirst() reorders the discovered pool lite-first on the search path (speed flag threaded through callGemini); thinkingConfigFor(model) adds thinkingBudget 0 (named 2.5 models) / thinkingLevel low (named 3.x models), aliases untouched; status probe + diagnose live walk now lead with lite models and raise probe maxOutputTokens 8→64 so thinking cannot strangle a healthy probe; discover route final NONE note now ALSO names the Google engine's own error instead of burying it under the GLM balance refusal; settings route trims pasted values on store (trailing newline keys can no longer poison headers).

Stage Summary:
- Deployed for retest: fresh-user scan should now run GLM refuse → Gemini backup on lite models with thinking off (platform AQ key, proven valid) → grounded AI leads with ZERO user setup. OSM + DeepSeek stay behind as fallback (platform DeepSeek key still missing — user can add their DeepSeek key to Vercel for ranked fresh-user leads). Post-deploy plugnplay probe decides success.

---
Task ID: 43j
Agent: Super Z (main)
Task: User demanded plug and play AI search after registration. After the latency fixes, fresh-user scans still fell to OSM. Find the real scan-time Gemini failure and fix or explain it.

Work Log:
- Added geminiTrace (per-model scan visibility, debug mode) mirroring glmTrace; threaded through callGemini/geminiGenerate and every discover response shape.
- Trace reveal: EVERY grounded call 429s instantly (~120ms) "You exceeded your current quota" across all 12 pool models; 2.5-flash family 404s "no longer available to new users". The ungrounded live probe (gemini-flash-lite-latest) succeeds 200 right before the scan — generation quota is fine, the GOOGLE SEARCH GROUNDING bucket for this project is drained.
- Full 429 body captured (trace slice raised to 1600 + quotaId/limit/retryDelay extraction with pretty-JSON tolerant regexes): bare RESOURCE_EXHAUSTED, NO named quotaId — a project-level wall. The user's AI Studio dashboard earlier showed ~490 429 attempts today: the drain is consistent with the day's QA/scan storms hitting grounded endpoints.
- Quota-storm breaker shipped: on a bare 429 (no named bucket) the model walk breaks immediately instead of hammering all 12 models, WITHOUT benching the key (ungrounded features — mail, OCR — share the project but not this bucket and stay healthy). Named-bucket 429s keep per-model rotation.
- Production deploys this task: ab6b4c7 (latency discipline + honest note + trim), 31b958d (geminiTrace), f56a03d/d9ae347/e5528af (trace capture + storm breaker).

Stage Summary:
- Plug and play chain is structurally complete and proven piecewise: fresh user → GLM refuse (honest) → Gemini grounded (ready; AQ platform key verified 200; blocked ONLY by the project's drained grounding bucket right now) → OSM real leads (3 real Soweto businesses every probe). Paths to live grounding: (1) fresh Google project + fresh key = fresh bucket instantly, (2) wait for Google's daily reset (~09:00 SAST / midnight Pacific), (3) small z.ai cash top up revives the GLM search leg (100M token pack already pays tokens). Monitor at https://ai.dev/rate-limit. Platform DeepSeek key still missing — fresh-user OSM leads stay unranked until the user adds their DeepSeek key to Vercel.

---
Task ID: 43k
Agent: Super Z (main)
Task: User reported scans still failing with the triple message (GLM balance refusal + map busy + Gemini quota) and suspected the missing DeepSeek key. Demanded plug and play.

Work Log:
- Root causes isolated: (1) platform GLM key fronted EVERY scan and its search tool is balance refused, so every scan paid a dead attempt plus billing noise the seller cannot act on; (2) the Gemini quota message said "try again in a minute" for what is a DAILY grounded-search drain (resets ~09:00 SAST), sending the user retrying against a wall; (3) OSM fallback gates (>20s/>8s remaining) got starved after the AI legs ate the budget, producing "map directory busy" even when Nominatim/Photon could answer; (4) DeepSeek absence confirmed HARMLESS (NO_KEY path returns raw OSM leads).
- gemini.ts: friendlyError QUOTA now distinguishes PerMinute (pacing, one more try) vs day/bare walls (refills around 09:00 South African time); PerMinute 429s ride a new 65s per-(key,model) bench (MODEL_RATE_COOLDOWN_MS) so repeated scans stop re-paying the 429 storm; the park-and-retry delay path (up to 8s per drained model) retired in favour of bench + rotate.
- discover route: zaiFirst now requires a PERSONAL z.ai key (Integrations); the platform GLM pool never fronts grounded scans and all its BALANCE/RATE/KEY_INVALID notices are suppressed (zaiWhy + engineErrors gated on personalZai); final NONE note therefore leads with the honest Gemini quota words; "AI ranking is resting" clause dropped from unranked OSM note.
- osm.ts: Overpass phase cap now dynamic (remaining minus 18s reserve, clamped 4-12s) so Nominatim and Photon ALWAYS get their turn; their gates lowered to >10s/>5s; fetch timeouts tightened (Nominatim 15s to 10s, Photon 12s to 8s).
- Deployed e9174bd (d7015f2..e9174bd). Live probe on production (fresh QA user, zero keys): Gemini leads with ONE fast 429 attempt (149ms, bare wall breaker fires, no pool hammering), GLM backup refuses silently (notice none), OSM delivered 3 real Soweto businesses (Kwa Lichaba Lounge, Chaf-Pozi, The Net Cafe) with clean note. Plug and play proven: register, scan, real leads, zero setup.

Stage Summary:
- The triple-error message is dead: no billing noise, honest quota wording, map directory no longer starved. Fresh users get real leads 24/7 even on a drained AI day. Paths to live grounded AI scans: fresh Google project key (new bucket, instant), daily reset ~09:00 SAST, or fund z.ai search. Platform DeepSeek key still absent by user choice, ranking sugar only.

---
Task ID: 43l
Agent: Super Z (main)
Task: User pasted a NEW Gemini key and scans still failed ("unacceptable, this is literally the product"). Demanded a live front end test, key validity check, and a fix.

Work Log:
- Live forensics via production API (sandbox has no DB/env access): registered fresh QA users, ran /api/ai/diagnose + reproduced the user's EXACT 10:51 scan (massage/floatation in Cape Town, ubuntuwellness.com) with debug traces.
- Key verdict: the "saved key" quota message is the OWN-KEY QUOTA class, which only appears when Google ACCEPTED the key and refused quota. Keys are VALID. Root cause of the AI wall: every key the user owns (old AIza, AQ in Integrations, AQ in Vercel) lives in ONE Google project whose daily grounded-search allowance is drained (bare RESOURCE_EXHAUSTED, no quotaId). A new key in the SAME project shares the drained bucket. Live reproduce at ~11:30 SAST (after the 09:00 reset) still 429s: drained again by the morning's scan storms.
- BUG 1 (osm.ts keywords): "massage|wellness|float|sauna|rehab|physio|therapy" matched NO category in buildTagFilters/buildNominatimQuery, so the map directory had ZERO coverage for the wellness scan. Added the wellness entry (shop massage/beauty/spa/cosmetics/nails) to both maps + physio/therapy to healthcare.
- BUG 2 (osm.ts Nominatim carrier, the structural one): Nominatim /search silently ignores shop/craft/office/leisure category params and answers 400 "Nothing to search for". ONLY amenity= is a recognised param, which is why tavern scans worked and shop scans never did. Sandbox-proven fix: the documented special phrase form q=[shop=massage] works for every category ([shop=massage] 3 rows, [shop=beauty] 8 rows in Cape Town). searchNominatimLeads now sends one bracket phrase per sibling value (up to 3), merges rows, and a refused phrase no longer kills siblings.
- NEW ENGINE (discover route): enrichOsmWithGlm ranks real map records via zaiGenerate PLAIN generation (json_object, temperature 0.3) using the ALREADY PAID 100M GLM token pack, zero Google, zero DeepSeek, zero setup for any user. Shared rankingPrompt + matchRankedToSource verifier with the DeepSeek leg (anti fabrication guarantee unchanged: every company must map to a source record). enrichOsmWithAi orchestrates: personal DeepSeek key first, GLM engine for everyone else, raw real records as the floor. Notes now name the engine that ranked.
- gemini.ts: own-key day-quota message now carries the escape hatch: "A brand new key in a brand new project at aistudio.google.com/apikey starts a fresh allowance right away."
- Also: Overpass generic sweep now only fires when Overpass actually ANSWERED (a down mirror chain no longer burns 12s on a pointless second phase).
- Deploys: d252b67 (43l) then 5ebbba7 (43m). Post-deploy live verify with the user's EXACT scan: mode OSM, 5 REAL leads with phones (Lnna Thai Massage & Beauty +27 79 527 7901, Dee Dee Thai Therapy +27 21 434 6948, The Piercery +27 63 680 4950, Yemenya Spa and Hair +27 21 439 2266, Racecourse Road). Soweto taverns regression scan: 3 real leads, no regression. GLM ranking walk could not finish this run (4.6 both doors 429 arrears for the search wallet, 4.5-flash timeouts on both doors, glm-4-flash 400 on Zhipu) but the raw-records floor held exactly as designed.

Stage Summary:
- The product now delivers real, contact-bearing leads for the user's exact query on a day when Google grounding is drained, the GLM search wallet is unfunded, AND Overpass mirrors are down. Nominatim bracket phrases are the reliable directory workhorse. AI grounded scans return when the user creates a key in a NEW Google project (per-project bucket) or at the daily reset. GLM plain ranking observed flaky this run (free rung timeouts) and stays as a best effort layer above the raw floor.

---
Task ID: 44
Agent: Super Z (main)
Task: User confirmed scans work and asked for measures so leads stay FRESH and ACTIVE forever, the finder survives onboarding scale, and every lead stays real and verifiable.

Work Log:
- Designed and shipped the VERIFIED LEAD POOL: three new tables (LeadPool: one deduped row per real business ever found, fingerprint name+area; LeadPoolHit: topic fingerprint to business links; ScanRun: per scan log doubling as rate limit anchor and warm window).
- Engine capture pass (rememberScanResults in src/lib/leadpool.ts): every scan result from ANY engine (Gemini, ZAI, OSM, Explee) lands in the pool with first/last seen, confirmCount bump on re-sightings (the still active signal), SA phone normalization to +27 with shape check, website liveness ping (HEAD then GET then http, 3.5s, max 8 sites, budget guarded), verify score 0 to 100 (real source 40, phone 20, live site 25, reconfirmed 15), merge never clobbers good facts with blanks, OSM node/way ids become openstreetmap.org source links.
- Pool first serving in discover route: topic fingerprint = normalized seller words + area (or 1km GPS bucket) computed BEFORE seller site context, so every seller describing the same client in the same area shares one pool topic. Enough fresh records (21 days, non stale) = instant serve, ZERO engine calls. 10 minute warm window serves partial pools when anyone scanned the topic recently. Both exclude leads the seller already saved and rotate least recently served faces first.
- Guardrails: 12s cooldown between ANY scans per user + daily allowance (free 25, paid 100), DB backed (survives serverless churn), gentle copy with Retry-After, no hyphens.
- Freshness cron /api/cron/leads-refresh (vercel.json 30 4 * * *): demotes businesses unseen 60 days to stale (never served fresh again), re-pings the 60 stalest websites, upgrades to active or drops the website badge honestly. Zero AI quota.
- UI (LeadsView): Verified pool mode badge, per lead chips "Checked · website live" / "Checked · phone on file" / "Confirmed · phone on file" / "Reconfirmed on scans" / "Map listed" / "Web found" plus "seen X days ago" freshness line.
- AI and OSM answers now ALSO top up from the pool when engines return fewer than asked, and the OSM path keeps ranking order + seller whys while adding verification chips.
- Deployed 7bebccc (5ebbba7..7bebccc). Live production probe scripts/pool_probe.mjs with the user's EXACT wellness scan: 6/6 PASS. Seller A first scan: OSM, 5 real Cape Town businesses with real phones, chips live (3 website live, 1 phone on file, 1 map listed). Rescan 13s later: mode POOL, zero engine calls. Immediate third scan: gentle 429 cooldown. Brand new seller B first ever scan same topic: mode POOL instant, zero engine calls. All on fresh zero key QA users, so plug and play still holds.

Stage Summary:
- The three promises are live in production: FRESH (re-sightings prove active, 60 day demotion, rotation keeps new faces coming, verified chips show exactly how fresh), VERIFIABLE (every lead carries a badge backed by a real check and a clickable source link, anti fabrication verifier unchanged), SCALE (first scan of a topic pays, everyone after serves free, cooldown + daily caps stop abuse, OSM floor untouched). Onboarding can now never stampede the engines: a thousand sellers on the same topic cost one scan.

---
Task ID: 45
Agent: Super Z (main)
Task: "Do a complete end to end test to ensure we have cleaned out all bugs and or inefficiencies. The scan works, now make it more efficient and sustainable for future client use." (Yoco payments next.)

Work Log:
- Baseline: full E2E suite (e2e_prod_qa.mjs) against production BEFORE changes: 30 passed, 0 failed. Core journey healthy on 7bebccc.
- Code audit found 4 real issues:
  1. INEFFICIENCY: rememberScanResults wrote pool rows SEQUENTIALLY (up to 30 roundtrips x ~100ms on Neon = seconds of tail latency on EVERY engine scan). Now classifies merges vs creates first (no DB), then applies both in parallel chunks of 8.
  2. INEFFICIENCY: serveFromPool shipped up to 400 full pool rows and sorted in JS. Now Postgres does the rotation sort (orderBy relation lastServedAt asc nulls first, then lastSeenAt desc) and only the head 150 rows ship. JS sort kept as deterministic tiebreak.
  3. BUG: daily scan allowance window refilled at 02:00 SAST, not midnight as the copy promised (the shift-back-then-floor shortcut skipped the final 2h shift back to UTC). Fixed with true SAST midnight computation.
  4. SCALE: ScanRun grew one row per scan forever (cooldown, daily cap and warm window all live within one day). Daily cron now prunes rows older than 45 days (prunedScans in the cron response).
  5. SCALE: cron stalest-first website recheck had no index on lastVerifiedAt. Added @@index([lastVerifiedAt]) on LeadPool (schema additive, db push on Vercel build).
- E2E hardened (coverage gaps closed):
  - Reveal honesty contract NOW TESTED end to end: discover -> save top lead to pipeline (POST /api/leads) -> reveal (charged only when real contact) -> second reveal never charges twice. Previously skipped because discover results carry no id.
  - Balance baseline for the credit-grant check taken just before subscribe, so a legitimate reveal charge can never fake a failed grant.
  - New checks: discover names its engine (mode + source), every lead carries a real business name, NPO 30% sandbox amount = R139.30 with npoNumber stored.
- QA: prisma validate OK (dummy URL; sandbox has no DATABASE_URL), tsc clean on src/ (only pre-existing skills/ error outside the build), next build OK. Deployed 7bebccc..82f5170.

Stage Summary:
- Production 82f5170: every engine scan is now seconds faster on the capture path, the serve path ships 2.5x less data, the daily allowance refills when the copy says it does, and the scan log can no longer grow forever. E2E suite now covers the reveal money contract and the NPO discount.
- Post-deploy regression next: full E2E + pool probe live.

---
Task ID: 45b
Agent: Super Z (main)
Task: Post-deploy regression on production 82f5170.

Work Log:
- Canary: /api/cron/leads-refresh answered with the new prunedScans key (0 pruned, 0 demoted, 0 rechecked) — new build confirmed live, cron clean.
- Full E2E (now 37 checks): RESULT 37 passed, 0 failed. First ever live coverage of the reveal honesty contract (no verified contact found -> NOT charged, honest message) and the NPO 30% sandbox rate (R139.30, npoNumber stored). Discover served mode POOL with zero engine calls on the hot QA topic.
- Pool probe: 6/6 PASS (chips on every lead, rescan serves from pool, gentle 429 cooldown, brand new seller serves instantly and free).

Stage Summary:
- Production 82f5170 fully verified: efficiency pass (parallel capture, DB side rotation) + sustainability pass (SAST midnight, scan log prune, lastVerifiedAt index) landed with zero regressions. The platform is ready for the Yoco payment gateway work.

---
Task ID: 46
Agent: Super Z (main)
Task: "How can we find human contact leads as well? Can we look at LinkedIn or anywhere with more leads we can fetch and verify, for an efficient GTM lead generation system when a user clicks AI Lead gen?"

Work Log:
- Honest LinkedIn answer: LinkedIn blocks scraping (ToS + 999 walls), so no scraping. Instead the DECISION MAKER LAYER captures humans from public web sources legally: LinkedIn/Facebook public pages, company team pages, directories and news that appear in legitimate search results. Copy verbatim or drop, never construct.
- Built the PEOPLE PASS (discover route): one grounded Gemini call naming the owner/founder/decision maker behind the businesses a scan just found, with role + public profile URL. Runs IN PARALLEL with the GLM map ranking call (different engines, different quotas) so scans stay just as fast. Budget guarded (13s runway, 12s timeout), silent skip on drained days (honest floor: leads without names).
- Anti fabrication holds everywhere: every answer company must map back to a real lead of this scan; sanePersonName (letters only, no filler words) + saneProfileUrl (real URL shape) on input AND on the AI answer; names never clobber a name another engine found.
- Scan prompts (both Gemini and GLM) now carry the PEOPLE ARE THE PRIZE rule: contactName + role + profileUrl when the results actually show them.
- Humans ride the verified lead pool: LeadPool + Lead gain role and profileUrl (additive schema, db push on Vercel build), merge keeps best facts, rotation serves them like every other verified fact. Pool served leads carry names forward to every seller for free.
- UI: result cards show "Ask for Thabo (Owner)" + a public profile link; lead card in the pipeline shows the decision maker block (free facts, never behind the reveal paywall: only email/phone are paid).
- Deploy hiccup: paramiko installs into /home/z/.venv (the shim's interpreter), NOT the system python. venv install + push OK.
- Deployed 1c9c5b6..0405140. Probes: people_probe.mjs 4/4 PASS (5 real Soweto leads, honest no names on a drained grounding day, human fields persist end to end), e2e 37/37, pool probe 6/6.

Stage Summary:
- Production 0405140: when a user clicks AI Lead gen they now get businesses WITH named humans where the public web names them (owner, role, public profile link), all verified and anti fabrication guarded. On drained Google days the scan honestly delivers businesses without names. GTM flow: scan, see the human, open the public profile, reach out. Yoco payments remain the next door.

---
Task ID: 47
Agent: Super Z (main)
Task: "As the business owner, i want an executive dashboard to manage my clients and subscriptions... clients, their projects, account status, payment history. Activate and deactivate accounts, manually add leads into their pipeline from explee. Master account ceo@businesshustle.co.za, dont disrupt anything on it."

Work Log:
- Recon: single-page app already had an 'admin' view (growth stats + config + flat user list, no actions) and one admin route pattern. Master account had NO reliable exec guarantee in prod (sandbox has no prod DB access) -> self-heal design required.
- Schema (additive, zero disruption): User.accountStatus @default("ACTIVE") + suspendedAt + suspendReason. Every existing account (incl. CEO) stays ACTIVE by default; nothing on the loaded account moves.
- lib/admin.ts: EXEC_EMAILS pinned to ceo@businesshustle.co.za; isExecUser (role ADMIN | platformAdmin | exec email); ensureExecAdmin = lazy idempotent self-heal that flips ONLY the two privilege flags on that one email, wired into register, login and getSessionUser so the Exec Dashboard nav simply appears on his next session load. requireExec guard for all new routes.
- Deactivation that bites: getUserId now nulls for SUSPENDED accounts -> every API 401s instantly; sign in returns friendly copy ("This account is paused. Reply to any HustlePortal email..."); daily-reminders cron skips paused owners (skippedSuspended in response). Guard rail: exec/admin accounts can never be paused.
- APIs: GET /api/admin/exec (KPIs: new signups 7d/30d, clients, MRR, paying/past-due/paused/canceled, topups30d PAID-only, wallet float, leads) + roster (plan, pay state, wallet, lead/client/invoice/project counts, joined, last activity, account status, isAdmin); GET+PATCH /api/admin/exec/client/[id] (full desk: subscription card, topups w/ Yoco refs, credit ledger, workspaces w/ counts, pipeline stages, recent invoices; PATCH pause w/ reason / restore); POST /api/admin/exec/client/[id]/leads (EXPLEE|MANUAL source, single or pasted list, company+city fingerprint dedup vs their last 1000 leads, lands in their default workspace at stage NEW via resolveProject, cap 200/batch, honest message with created/skipped).
- UI: AdminView rebuilt into the Executive Dashboard (nav label 'Exec Dashboard'): 6-card KPI strip (new signups highlighted), Newest members spotlight (answers "I dont see any new register that comes in"), searchable/filterable client roster with per-row pause/restore + Open, right-side client drawer (identity chips, plan card, wallet + topups + credit ledger, workspaces, pipeline stages, invoices), Add leads dialog (One lead / Paste a list tabs, Explee source select), Pause dialog with reason + honest copy. Revenue mission (GrowthSection) and lead economy config kept.
- QA local (sqlite schema swap, db/custom.db, dev server on 3000): scripts/exec_local_qa.mjs 35/35 PASS - CEO self-heal on register AND login, KPIs exact (members 4, new7 4, MRR 19900, topups 15000 PAID-only), roster shapes, detail (PAID+PENDING topups, welcome-bonus ledger, default workspace), pause -> me 401 everywhere + login 403 friendly copy + restore -> login 200, inject 2 -> dedup batch (created 1 skipped 2) -> client sees 3 EXPLEE/NEW leads with project, exec-pause 400, non-admin 403 wall x4, unauth 401. Schema restored to postgres + regenerate after. Browser (agent-browser): dashboard renders (screenshot download/qa_exec_dashboard.png), drawer + Add leads dialog submitted a real lead (verified in DB), Pause dialog renders, no blocking errors.
- Deploy 1: 94cb322 (10 files). Prod probe scripts/exec_prod_probe.mjs 9/9 PASS (route live 401 marker, 403 wall on all 4 exec surfaces + legacy config, QA client session + wallet healthy after the auth.ts hot-path change). Full E2E regression 37/37 PASS.
- Deploy 2: c2ff337 (cron silence for paused accounts + probe script). Live marker: cron answers with skippedSuspended key; {"ok":true,usersWithDueTasks:2,notified:0,skippedSuspended:0}.

Stage Summary:
- Production c2ff337: the owner has a real control room - every client, their plan, their money (topups + credit ledger), their pipeline; pause/restore that actually locks the door; lead injection into any client's pipeline (Explee or typed, deduped). ceo@businesshustle.co.za is the master account by design: next time he signs in (or his session loads) the Exec Dashboard nav appears; only his two privilege flags ever flipped, nothing else touched.
- For the user: first visit -> sidebar shows "Exec Dashboard" (if not visible, refresh once). Yoco payments remain the next door; per-renewal payment rows do not exist yet (single-row subscription model) so payment history shows wallet purchases + credit ledger + plan state today.

---
Task ID: 48
Agent: Super Z (main)
Task: "A user will load their credit, then we get a notification via email with the information for Explee (https://explee.com/), if possible automate the campaign to run through api. This translates into a part in the exec dashboard that shows a pool of leads per client for me to add on to their pipeline."

Work Log:
- Recon: Exec Dashboard core already live (Task 47). Explee identified: AI-agent lead gen SaaS with a REAL public API at api.explee.com (FastAPI, X-API-Key auth, spec at /public/api/openapi.json). CRITICAL FIND: the old lib/explee.ts posted {definition, location:{cities}, limit} but the real contract requires {filters:{definition, geo_city, geo_include}, page, page_size} — Explee had been silently failing. Rewritten to spec (searchCompanies + meta.credits_charged/remaining_balance parsed).
- Schema (additive): ClientPoolLead — per client lead bench (userId+fingerprint unique, source EXPLEE|POOL|MANUAL, status NEW|ADDED|DISMISSED, leadId stamped when added). User.poolLeads relation. db push runs on Vercel build.
- lib/campaign.ts: clientCampaignBrief (profile + default workspace: offerings/targetMarket/valueProp → natural language definition) + runClientCampaign (Explee live search first; free verified-pool serve as honest fallback when key missing/drained/quiet; landOnBench dedup: pipeline-saved → skip, bench ADDED/DISMISSED → skip, bench NEW → refresh empty facts; rememberScanResults captures Explee answers into the global LeadPool; ScanRun logged).
- lib/execnotify.ts: onPaidTopUp(topUpId) — single hook after any top-up turns PAID (Yoco webhook AND sandbox path, both via next/server after() so the payment response is never delayed): exec email to ceo@businesshustle.co.za with client, amount, wallet, campaign brief + deep link ?view=admin&client=<id>; auto campaign when amountCents >= campaign_auto_cents (config, default 50000 = R500 = smallest pack); campaign result email. Owner's own topups stay quiet (isExecEmail check). sendSystemMail best effort, never touches the payment flow.
- Exec APIs: overview KPIs +poolNew/poolArrivals24h + roster poolCount; client detail +pool rows (NEW first) + counts + campaign history; NEW /api/admin/exec/client/[id]/pool: POST run campaign (manual always allowed), PATCH add/addAll/dismiss (adds create Leads stage NEW in default workspace via resolveProject, source preserved, bench row stamped ADDED+leadId).
- UI: PoolCard in client drawer (Run campaign + search words/area override, waiting list with Add/dismiss per row, Add all N, In pipeline tail, dismissed count, campaign history line); KPI Leads sub shows pool counts; roster shows "N pooled"; AdminView deep link opens drawer from ?client=; Explee key hint copy updated (campaigns run live with key, verified pool without).
- BUG FOUND BY PROD PROBE: campaign ScanRuns tripped the client's own 12s scan cooldown + ate their daily allowance. Fix (48b, b1e2da9): campaigns log mode CAMPAIGN and checkScanAllowance excludes CAMPAIGN in both cooldown lookup and daily count. Discover's own EXPLEE mode untouched.
- QA: local 32/32 (scripts/exec_pool_local_qa.mjs on embedded Postgres: self-heal, campaign modes, bench math, add/addAll/dismiss, dedup vs pipeline, refresh-in-place, exec email stamp, auto campaign on topup, allowance untouched, walls 401/403/400, owner-quiet rule); browser pass (drawer renders pool card, In pipeline badges, no console errors; screenshots download/qa_exec_pool*.png). Deploy 1: 231ec3f. Deploy 2: b1e2da9.
- Prod verification: exec pool probe 11/11 (route live, 4 walls 403, topup credited 9900→59900, reference stamped, discover answers 200 mode=OSM immediately after the auto campaign — allowance fix proven live), E2E 37/37, pool probe 6/6.

Stage Summary:
- Production b1e2da9: the credit story is fully automated — client loads credit → owner gets an email with everything needed to act → a campaign fires through the Explee API (or the free verified pool until the key is set) → leads wait in a per client pool on the Exec Dashboard → owner adds the winners to that client's pipeline in one tap. Nothing reaches a client's pipeline without the owner's tap. NOTE: 3 QA probe topups fired real notification emails to the CEO inbox (live proof; QA client names "Pool Probe").
- Next doors: Yoco live keys (YOCO_SECRET_KEY + webhook secret in Vercel) turn the sandbox topups into real money; Explee API key in the Exec Dashboard settings switches campaigns from the verified pool to live Explee data (0.5 credits/company, balance shown in the result email).

---
Task ID: 46-research
Agent: main
Task: Explee API research + env var naming for API key

Work Log:
- Fetched https://explee.com/ and located public API docs at https://api.explee.com/public/api/docs
- Downloaded OpenAPI spec (https://api.explee.com/public/api/openapi.json, v1.0.0) and mapped all endpoints
- Confirmed auth: single API key via X-API-Key header, resolves to whole organization (no workspace ID needed)
- Rate limit: 10000 req/hour, 150 concurrent

Stage Summary:
- ENV VAR DECISION: save key as EXPLEE_API_KEY in Vercel (Production + Preview). No other explee credentials required.
- Full automation confirmed possible via API: POST /autogtm/campaigns (create), /campaigns/import (own leads), /approve, /start, /stop, GET /autogtm/hot-leads, GET /campaigns/{id}/inbox, GET /billing/balance, POST /search/people, POST /find-and-enrich
- This validates the full chain: client credit top-up -> email notify owner -> automated explee campaign -> hot-leads -> per-client pool in exec dashboard -> owner injects into client pipeline
- OpenAPI spec cached at scripts/tmp/explee_openapi.json for implementation reference

---
Task ID: 48c
Agent: Super Z (main)
Task: "okay I've added the key" — owner saved EXPLEE_API_KEY on Vercel. Make the app actually use it and prove the live Explee chain on production.

Work Log:
- GAP FOUND: getConfig('explee_api_key') read ONLY the PlatformConfig DB row (Exec Dashboard settings). The Vercel env var the owner just set was never consulted, so campaigns would have kept falling back to the free verified pool with the key sitting dormant.
- Fix (src/lib/config.ts): ENV_FALLBACKS map; getConfig falls back to process.env.EXPLEE_API_KEY when the DB row is absent. DB row (dashboard settings) still wins when present. hasExpleeKey, campaign.ts key gate, expleeSearchCompanies and the discover fallback B all light up automatically. tsc clean.
- Deployment marker (src/app/api/health/route.ts): integrations.explee boolean added alongside yoco, so key wiring is confirmable at a glance without exposing the secret.
- Probe script scripts/explee_live_probe.mjs (deployed via git add -f): fresh QA client -> R500 starter pack sandbox topup -> wallet 9900 to 59900 -> discover answers 200 right after the after() campaign (allowance untouched) -> bonus exotic topic (typewriter repair, Colesberg) to reach discover fallback B directly.
- Deploys: f51459a (config env fallback + probe), 363c2ac (health marker).

Stage Summary:
- (verification pending: waiting for Vercel build, then explee_live_probe + regression)
- Post-deploy verification (production 363c2ac):
  - health integrations.explee: True within one poll of the build going live (the Vercel env var is present AND the new code reads it; permanent at a glance check for the owner).
  - explee_live_probe 8/8: QA client registered, R500 starter pack sandbox PAID (ref HP-MV8G38QD), wallet 9900 to 59900, discover 200 immediately after the after() campaign (CAMPAIGN mode allowance exclusion still holds).
  - DECISIVE engine proof via bench topic: the auto campaign's topic ("new customers in Johannesburg that would pay for what they sell" + Johannesburg, built deterministically from a QA profile with no profile fields) had NEVER been scanned before. Minutes later a brand new user scanning that exact topic got mode POOL with LIVE EXPLEE B2B rows (SOCRATI: email online@socrati.co.za, linkedin.com/company/96766671 sourceRef, employees 15, score 93, Checked website live; Trendyland: email, phone, domain, employees 2). Only a live Explee search inside the auto campaign could have captured those faces under that fingerprint. Chain proven: topup -> owner email -> live Explee campaign -> bench + shared pool -> free pool serve for the next seller.
  - Regression: E2E 37/37 PASS, pool probe 6/6 PASS.
  - WATCHED ANOMALY: 2 transient 402 responses on discover during probing (fresh QA users), gone on 3/3 subsequent runs and all regressions green. Our code has no 402 path; looks like a Vercel edge/usage blip. If it recurs, check Vercel usage/plan limits, not app code.

Stage Summary:
- Production 363c2ac: the Explee key the owner added on Vercel is LIVE in the product. Every client topup at or above R500 now fires a real Explee campaign (0.5 Explee credits per company from the owner's explee balance), the owner gets the result email naming the engine and remaining balance, and leads land on the per client bench in the Exec Dashboard for one tap review. The verified pool remains the honest free fallback whenever Explee is quiet. Probe scripts: explee_live_probe.mjs, explee_bench_probe.mjs.

---
Task ID: 49
Agent: Super Z (main)
Task: "I want the price to be R299 now. keep R199 as the launch special. subtly put in that the normal price is R299/month."

Work Log:
- Design decision (zero payment risk): priceCents / annualCents stay R199 / R1,990 — the charged amounts (subscribe route, Yoco checkout, existing subscription rows, NPO 30% math = R139.30) are untouched. Added normalCents: 29900 + normalAnnualCents: 299000 to the Operator PlanDef as a display only anchor. Absent on Boss = no special.
- Surfaces: Landing plan card shows "Normally R299 · launch special" (gentle strikethrough, 10px muted) under the price; the annual line shows R1,990 Operator with R2,990 struck through; GrowView card carries the same anchor on both cycles; useUpgrade dialog copy now reads "Operator is R199 a month during launch, normally R299." Copy rules held: no hyphens, gentle not salesy.
- plans.ts header comment updated to normal price MRR math. tsc clean. Lint errors present are pre-existing in untouched files.
- Deploy f1fa5fa. Verified live: served chunk 9b727f07d5d1e3b8.js contains the anchor renders + 29900 + the new dialog line (landing is client rendered so HTML curl cannot see it; chunk grep is the honest check).
- Regression: E2E 37/37 PASS.

Stage Summary:
- Production f1fa5fa: everywhere a client sees the Operator plan they also see, quietly, that it is normally R299 a month — the R199 launch special framing is live on the landing page, the in app plans view and the upgrade dialog. What clients are charged is unchanged (R199 / R1,990, NPO R139.30 / R1,393). When the launch ends, set priceCents 29900 + annualCents 299000 and drop the two normal fields: one file, no other edits.

---
Task ID: 50
Agent: Super Z (main)
Task: "The yoco key is in and let us now use actual live data on the exec dashboard ahead of the launch."

Work Log:
- Recon: exec feed was already DB driven (real users, subs, topups) but revenue KPIs mixed sandbox QA money with real card money, the dashboard had no Yoco mode/webhook visibility, the DEMO/LIVE data mode select was display only legacy (nothing reads CONFIG_KEYS.MODE), and the sandbox instant pay paths were open to ANY production visitor while the key was missing/invalid.
- Revenue truth: exec feed + growth route + admin config now count provider YOCO only for MRR, subscribers, byPlan and topup totals; sandbox amounts surface as transparent sub lines (sandboxTopups30dCents, testMrrCents) instead of silently vanishing. Roster display unchanged.
- Exec feed new payments block: keyMode (key text decides, stored webhook mode as fallback), webhookConfigured + source + webhookMode, and recent 12 PAID topups joined with payer names (the money pulse).
- AdminView: new Payments card (Yoco live/test/not connected badge, webhook state incl stale mode warning, one tap Register webhook button, latest payments list), MRR and Top ups 30d KPI sub lines, provider chips (Yoco/Sandbox) on client drawer topup rows, Data mode select replaced by an honest Discovery engine status (Live Explee vs Verified pool fallback).
- Webhook mode tracking: CONFIG_KEYS.YOCO_WEBHOOK_MODE stored at register time (Yoco response names the mode); register GET + webhooks GET return webhookMode; PaymentsCard distinguishes ready vs registered for another mode (test era webhook would silently swallow live payments).
- KEY FORMAT FIX: getYocoSecretKey was strict sk_ prefixed; the owner's real Yoco key starts yoco_live_... (59 chars). Relaxed to reject only whsec_ values and let Yoco validate; yocoModeFromKey detects live/test from key text. E2E then confirmed mode=live from the key text, and the real checkout call returned Yoco 401: the saved value is NOT a working secret key (likely the key label/ID copied instead of the key value).
- LAUNCH INTEGRITY: sandbox instant activation (subscribe + topup) closed to QA probe accounts only (@hustleqa.example.com). Real visitors get an honest gentle message (503) and NEVER free plans/credit, even while the gateway is misconfigured. E2E + all probes register on the QA domain so they keep working.
- Client error copy: when Yoco rejects/fails, clients see "Card payments are momentarily unavailable. Please try again in a moment."; raw Yoco detail goes to server logs (console.error in both routes).
- Diagnostics: webhooks GET adds a key shape hint (first7...last4 + length, only when the value is clearly the wrong secret type) so the owner can see what Vercel holds without exposing it. Probe scripts/key_diag.mjs (local) printed the decisive hint: yoco_li...d381 (59 chars).
- Probes: e2e_prod_qa.mjs gained 4 Yoco gateway checks (status endpoint, key present, LIVE mode, webhook ready for current key mode); explee_live_probe.mjs is live era aware with three branches (live checkout OK / live rejected while key is bad / sandbox).
- Deploys: 027a507 (live data + payments card), 0a1123c (sandbox closure + webhook mode + hint), 40169cb (Yoco as validator + mode fallback), d227c93 (gentle client error copy).

Stage Summary:
- Production d227c93: exec dashboard now runs on actual live money. MRR/subscribers/topups count only real Yoco card payments; the Payments card shows gateway mode, webhook state and the latest settled payments with a one tap webhook registration; the fake Demo mode setting is gone. Sandbox free paths are closed to everyone except QA probes.
- VERDICT ON THE KEY: the value saved in YOCO_SECRET_KEY authenticates NOWHERE: Yoco returns 401 on a real checkout call. It starts yoco_li...d381 (59 chars) and looks like a key LABEL, not the secret key value. OWNER TODO: Yoco Portal → copy the actual secret key value → replace YOCO_SECRET_KEY on Vercel → redeploy → open Exec Dashboard → tap Register on the Payments card. E2E then goes full green automatically (34/38 now; the 4 fails are exactly key 401 x3 + webhook not yet registered for live mode).
- Regression: exec_prod_probe 9/9 PASS, explee_live_probe 5/5 PASS (honest live rejected branch), E2E 34/38 (4 expected Yoco key gate failures).
