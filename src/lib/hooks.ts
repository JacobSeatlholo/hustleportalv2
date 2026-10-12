'use client'

import { useCallback, useEffect, useState } from 'react'

export type ApiError = { error: string }

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  })
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as ApiError
    throw new Error(payload.error || `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

export function useResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const json = await apiFetch<T>(url)
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
