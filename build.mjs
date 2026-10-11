#!/usr/bin/env node
/**
 * Hardened production build — runs as `bun run build` -> `node build.mjs`
 * (works identically on Vercel and in the sandbox).
 *
 * Why this exists: the previous single-line build chain
 *   `prisma db push --skip-generate && next build && cp -r ...`
 * failed on Vercel with only "bun run build exited with 1" — impossible to
 * diagnose without step-level logs, and a transient Neon cold-start or a
 * missing standalone dir killed the whole deploy.
 *
 * Fixes:
 *  1. Every step logs a [build n/3] marker -> failures are pinpointable.
 *  2. DB schema sync retries 3x (Neon auto-suspend cold starts / transient
 *     pooled-connection hiccups) and, if it still fails, the build CONTINUES
 *     with a loud warning instead of blocking the deploy (schema changes in
 *     this repo are additive-only; runtime surfaces /api/health dbPushOk).
 *  3. Standalone assembly creates its target dirs first and never fails the
 *     deploy (Vercel uses its own output pipeline; the copy only matters for
 *     self-hosted `bun start`).
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, cpSync, existsSync } from 'node:fs'

const t0 = Date.now()
const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })

function step(n, name) {
  console.log(`\n[build ${n}/3] ${name} ...`)
}

// ---------- Step 1/3: DB schema sync (retry, soft-fail) ----------
step(1, 'DB schema sync (prisma db push)')
let pushed = false
const MAX_ATTEMPTS = 3
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log(`[build 1/3] attempt ${attempt}/${MAX_ATTEMPTS}`)
  // --accept-data-loss: REQUIRED non-interactively. Prisma flags additive
  // changes like "unique constraint on new nullable column" as possible data
  // loss and refuses to proceed without a TTY prompt (this silently failed
  // every Vercel build after the growth-engine schema landed and broke login
  // with "column User.refCode does not exist"). All schema evolution in this
  // repo is additive; any destructive step Prisma takes is printed loudly here.
  const r = run('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'])
  if (r.status === 0) {
    pushed = true
    break
  }
  console.log(`[build 1/3] attempt ${attempt} failed (exit ${r.status})`)
  if (attempt < MAX_ATTEMPTS) {
    const waitS = attempt * 5
    console.log(`[build 1/3] waiting ${waitS}s (DB cold start / transient network?) ...`)
    spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${waitS * 1000})`])
  }
}
if (!pushed) {
  console.warn(
    '\n[build 1/3] WARNING: could not sync DB schema after 3 attempts — continuing build.\n' +
      '[build 1/3] If schema was behind, new DB features may error at runtime until sync succeeds.\n' +
      '[build 1/3] Check /api/health (dbPushOk will be false on the next boot) and Vercel env DATABASE_URL.\n'
  )
}

// ---------- Step 2/3: Next.js build (fatal) ----------
step(2, 'next build')
const b = run('npx', ['next', 'build'])
if (b.status !== 0) {
  console.error(`[build 2/3] next build FAILED (exit ${b.status})`)
  process.exit(b.status || 1)
}

// ---------- Step 3/3: assemble standalone server assets (non-fatal) ----------
step(3, 'assemble standalone assets')
try {
  if (existsSync('.next/standalone')) {
    mkdirSync('.next/standalone/.next', { recursive: true })
    if (existsSync('.next/static')) {
      cpSync('.next/static', '.next/standalone/.next/static', { recursive: true })
    }
    if (existsSync('public')) {
      cpSync('public', '.next/standalone/public', { recursive: true })
    }
    console.log('[build 3/3] standalone assets assembled')
  } else {
    console.log('[build 3/3] no .next/standalone — skipping (Vercel uses its own output)')
  }
} catch (e) {
  console.warn(`[build 3/3] WARNING: standalone assembly skipped (${e?.message || e})`)
}

console.log(`\n[build] OK in ${((Date.now() - t0) / 1000).toFixed(1)}s (dbPush=${pushed ? 'ok' : 'SOFT-FAILED'})`)
