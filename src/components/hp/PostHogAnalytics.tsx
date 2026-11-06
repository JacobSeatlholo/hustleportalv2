'use client'
/**
 * PostHog product analytics (Task 167), zero effect on the project until you
 * flip it on: set NEXT_PUBLIC_POSTHOG_KEY + NEXT_PUBLIC_POSTHOG_HOST in
 * Vercel → Environment Variables and redeploy. With the variables unset this
 * component renders nothing and never even downloads the posthog-js bundle.
 *
 * Sits beside GaAnalytics and shares the same single-page-app trick: every
 * section change (dashboard → leads → invoices…) is fired as an `hp_view`
 * event so funnels show the real journey.
 *
 * Why PostHog on top of GA4: GA counts visitors, PostHog answers product
 * questions — activation funnels (signup → first lead → first invoice →
 * first emailed invoice), session replays (inputs masked), feature flags,
 * in-app surveys. EU region recommended for the POPIA posture; events ride
 * the same-origin /ingest reverse proxy so ad blockers don't eat them.
 *
 * Privacy red lines honoured here:
 *  - users are identified by the internal user id ONLY — never email, name,
 *    business name or phone (POPIA personal information stays out of PostHog);
 *  - input/textarea/select values are masked in autocapture and replays;
 *  - Do-Not-Track is respected;
 *  - the landing page's existing "We measure anonymous usage" disclosure
 *    (Privacy & POPIA notice link) already covers this tool.
 */
import { useEffect, useRef } from 'react'
import { useHp } from './store'

type PostHogClient = (typeof import('posthog-js'))['default']

export default function PostHogAnalytics() {
  const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST
  const view = useHp((s) => s.view)
  const session = useHp((s) => s.session)

  const userId = session?.user?.id ?? null
  const role = session?.user?.role ?? null
  const persona = session?.user?.persona ?? null

  const ph = useRef<PostHogClient | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  // Boot once, lazily. The dynamic import keeps posthog-js (~50KB gz) out of
  // the bundle entirely while the env vars are unset.
  useEffect(() => {
    if (!KEY || ph.current) return
    let dead = false
    import('posthog-js').then((m) => {
      if (dead || ph.current) return
      const host = HOST || 'https://eu.i.posthog.com'
      m.default.init(KEY, {
        api_host: '/ingest', // same-origin reverse proxy → first-party events
        ui_host: host.replace('.i.posthog.com', '.posthog.com'),
        capture_pageview: false, // single-page app: hp_view per section instead
        capture_pageleave: true,
        autocapture: true,
        // POPIA discipline: autocapture records THAT a thing was clicked, not
        // WHAT it said — element text and attributes (lead names, amounts,
        // hrefs…) are masked. Replays keep input values masked too.
        mask_all_text: true,
        mask_all_element_attributes: true,
        session_recording: { maskAllInputs: true },
        respect_dnt: true,
        persistence: 'localStorage+cookie',
      })
      ph.current = m.default
      // Catch up on anything that happened before the module landed.
      if (userId) m.default.identify(userId, { role, persona })
      if (viewRef.current) m.default.capture('hp_view', { view: viewRef.current })
    })
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [KEY, HOST])

  // Fire hp_view on every SPA section change.
  useEffect(() => {
    if (!ph.current || !view) return
    ph.current.capture('hp_view', { view })
  }, [view])

  // Identify on login — internal id only, never email/name/phone.
  useEffect(() => {
    if (!ph.current || !userId) return
    ph.current.identify(userId, { role, persona })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, role, persona])

  return null // the tracking is all in the effects — nothing to render
}
