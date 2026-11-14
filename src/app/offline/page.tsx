import Link from 'next/link'

export const metadata = {
  title: 'Offline — HustlePortal',
}

/**
 * The service worker's offline landing (sw.js precaches this URL): served when
 * a navigation fails with no cached copy. Static on purpose — no session read,
 * no client fetches — so it renders with zero network.
 */
export default function OfflinePage() {
  return (
    <main className="min-h-screen hp-gradient-bg flex items-center justify-center px-6 text-center">
      <div className="max-w-md space-y-4">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">No connection</p>
        <h1 className="font-display text-4xl">You&rsquo;re offline</h1>
        <p className="text-sm text-muted-foreground">
          The app opens from this device, and pages you visited recently still load from the cache.
          Anything you save while offline — like a note from a call — queues on this device and syncs
          automatically the moment you reconnect.
        </p>
        <Link href="/" className="inline-block text-sm underline underline-offset-4">
          Try the app again
        </Link>
      </div>
    </main>
  )
}
