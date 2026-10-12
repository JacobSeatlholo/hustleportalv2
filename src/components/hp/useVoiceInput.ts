'use client'
/**
 * Voice dictation — press the mic, talk, the words land in the field.
 * Built on the browser's Web Speech API (Chrome, Edge, Safari; en-ZA first).
 * Degrades honestly: the mic button only appears where the browser supports it,
 * and permission problems surface as one plain line, never a silent failure.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechEventLike {
  resultIndex: number
  results: { length: number; [i: number]: SpeechResultLike }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: SpeechEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
}

export function voiceSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
}

export function useVoiceInput(onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const finalRef = useRef('')
  // keep the latest writer without re-arming the recognition object
  const writeRef = useRef(onText)
  writeRef.current = onText

  const stop = useCallback(() => {
    try { recRef.current?.stop() } catch { /* already stopped */ }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Ctor) {
      setError('Voice typing works in Chrome, Edge or Safari.')
      return
    }
    const rec = new Ctor()
    rec.lang = 'en-ZA'
    rec.continuous = true
    rec.interimResults = true
    finalRef.current = ''
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0]?.transcript || ''
        if (r.isFinal) finalRef.current += t
        else interim += t
      }
      const text = (finalRef.current + interim).replace(/\s+/g, ' ').trimStart()
      if (text) writeRef.current(text)
    }
    rec.onend = () => setListening(false)
    rec.onerror = (e) => {
      setListening(false)
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone permission is off. Allow it in your browser settings and try again.')
      } else if (e.error === 'no-speech') {
        setError('Nothing heard — tap the mic and speak again.')
      }
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
      setError(null)
    } catch {
      setListening(false)
    }
  }, [])

  useEffect(() => () => { try { recRef.current?.stop() } catch { /* unmount */ } }, [])

  return { listening, error, supported: voiceSupported(), start, stop, toggle: () => (listening ? stop() : start()) }
}
