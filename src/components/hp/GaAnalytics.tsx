'use client'
/**
 * Google Analytics 4, zero effect on the project until you flip it on:
 * set NEXT_PUBLIC_GA_MEASUREMENT_ID (G-XXXXXXXXXX) in Vercel → Environment
 * Variables and redeploy. No DNS records, no Vercel domain dialogs, nothing
 * else. With the variable unset this component renders nothing at all.
 *
 * The app is a single page: every section change (dashboard → leads → tasks…)
 * is reported as a page_view so GA shows the real funnel.
 * South African visitors are in scope of POPIA; the landing page discloses
 * the use of analytics and links the privacy policy.
 */
import Script from 'next/script'
import { useEffect } from 'react'
import { useHp } from './store'

export default function GaAnalytics() {
  const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  const view = useHp((s) => s.view)

  useEffect(() => {
    if (!GA_ID || !view) return
    const w = window as unknown as { gtag?: (...args: unknown[]) => void }
    w.gtag?.('event', 'page_view', {
      page_title: view,
      page_path: `/?view=${view}`,
      page_location: `${window.location.origin}/?view=${view}`,
    })
  }, [view, GA_ID])

  if (!GA_ID) return null

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}', { send_page_view: true });`}
      </Script>
    </>
  )
}
