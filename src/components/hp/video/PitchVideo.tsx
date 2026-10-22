import React, { useMemo } from 'react'
import { AbsoluteFill, Easing, Img, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion'

/**
 * PitchVideo, the HustlePortal marketing video template, v4.
 * 15 seconds, 30fps, resolution independent (scales from the 720 design grid
 * to 1080 and beyond). The member can attach their own logo: it pops in the
 * opener, rides on the computer screen in the machine scene and crowns the
 * closing call to action.
 *
 * Two themes share the opener and the call to action, only the middle act
 * differs: machine (default) is the retro computer, clean is the classic
 * bold services list from v2. The member picks in the Video Studio.
 *
 * The machine scene is our answer to "make the presentation appear inside a
 * computer": a retro micro computer boots on the stage, the CRT powers on
 * with the classic line flash, a short boot sequence types out the member's
 * name, then their services play as slides ON the screen, scanlines and
 * phosphor glow and all, before the camera flies into the screen into the
 * call to action. It is styled after the classic 8 bit micros, it is not a
 * real emulator: a real emulator runs on wall clock timing and breaks frame
 * exact rendering, everything here is deterministic (spring, interpolate,
 * Math.sin and a seeded noise texture only) so the Player preview and the
 * browser render are frame identical. System fonts only, so no webfont can
 * fail mid render.
 */

export interface PitchProps {
  businessName: string
  tagline: string
  services: string[]
  kicker?: string
  city?: string
  phone?: string
  accent?: string
  logoSrc?: string
  /** False when the logo came from a format without transparency (a JPG). */
  logoHasAlpha?: boolean
  /** Which middle act plays: the retro computer (default) or the classic clean list. */
  theme?: 'machine' | 'clean'
}

export const PITCH_FPS = 30
export const PITCH_DURATION = 450 // 15 seconds

export const PITCH_WIDTH = 1920
export const PITCH_HEIGHT = 1080

export interface QualityPreset {
  key: string
  label: string
  width: number
  height: number
  bitrate: number
  note: string
}

/**
 * Controlled high bitrates: motion graphics at these rates come out pristine.
 * The chain is also the FALLBACK LADDER: a machine that refuses a rung drops
 * to the next one, so an export always lands at some quality. Bitrates are
 * tuned so 15 seconds at Maximum stays inside the email attachment cap.
 */
export const QUALITY_PRESETS: QualityPreset[] = [
  { key: 'max', label: 'Maximum', width: 1920, height: 1080, bitrate: 4_600_000, note: 'Full HD' },
  { key: 'sharp', label: 'Sharp', width: 1280, height: 720, bitrate: 4_200_000, note: 'HD, smallest file' },
  { key: 'light', label: 'Light', width: 960, height: 540, bitrate: 3_500_000, note: 'Runs on the weakest devices' },
]

export const ACCENT_PRESETS: { key: string; label: string; color: string }[] = [
  { key: 'ember', label: 'Ember', color: '#f97316' },
  { key: 'ocean', label: 'Ocean', color: '#0ea5e9' },
  { key: 'forest', label: 'Forest', color: '#22c55e' },
  { key: 'grape', label: 'Grape', color: '#a855f7' },
  { key: 'crimson', label: 'Crimson', color: '#ef4444' },
  { key: 'gold', label: 'Gold', color: '#eab308' },
]

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace'

const PhoneIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
)

const PinIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

/** Soft hero plate behind the logo so JPG logos look intentional on the dark stage. */
const LogoPlate: React.FC<{ src: string; size: number; radius: number; pad: number; opacity?: number }> = ({ src, size, radius, pad, opacity = 1 }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(255,255,255,0.07)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: radius,
      padding: pad,
      opacity,
    }}
  >
    <Img src={src} style={{ width: size, height: size, objectFit: 'contain' }} />
  </div>
)

const Scene1: React.FC<PitchProps> = ({ businessName, tagline, kicker, accent = '#f97316', logoSrc }) => {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const s = height / 720

  // Opener entrance
  const rise = spring({ frame, fps, config: { damping: 200, mass: 0.9 } })
  const nameBlur = interpolate(frame, [0, 14], [10, 0], { extrapolateRight: 'clamp' })
  const nameOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' })
  const nameY = interpolate(rise, [0, 1], [70 * s, 0])
  const nameSize = (businessName.length > 24 ? 62 : businessName.length > 16 ? 76 : 96) * s

  const logoIn = spring({ frame: frame - 2, fps, config: { damping: 14, mass: 0.8 } })
  const kickerOpacity = interpolate(frame, [8, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const kickerBlur = interpolate(frame, [8, 22], [6, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const lineGrow = spring({ frame: frame - 16, fps, config: { damping: 200 } })
  const lineWidth = interpolate(lineGrow, [0, 1], [0, 320 * s])
  const sweep = interpolate(frame, [46, 76], [-60, 380], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const tagOpacity = interpolate(frame, [34, 54], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const tagY = interpolate(frame, [34, 54], [24 * s, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  // Gentle exit so the wipe takes over from a moving frame
  const exit = interpolate(frame, [96, 105], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const exitY = interpolate(frame, [96, 105], [0, -18 * s], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: exit, transform: `translateY(${exitY}px)` }}>
      <div style={{ textAlign: 'center', padding: `0 ${90 * s}px`, maxWidth: '92%' }}>
        {logoSrc ? (
          <div style={{ opacity: interpolate(logoIn, [0, 1], [0, 1]), transform: `scale(${interpolate(logoIn, [0, 1], [0.7, 1])})`, marginBottom: 30 * s, display: 'flex', justifyContent: 'center' }}>
            <LogoPlate src={logoSrc} size={110 * s} radius={26 * s} pad={16 * s} />
          </div>
        ) : null}
        {kicker ? (
          <p
            style={{
              fontFamily: FONT,
              fontSize: 20 * s,
              fontWeight: 700,
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
              color: accent,
              marginBottom: 18 * s,
              opacity: kickerOpacity,
              filter: `blur(${kickerBlur}px)`,
            }}
          >
            {kicker}
          </p>
        ) : null}
        <h1
          style={{
            fontFamily: FONT,
            fontSize: nameSize,
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.03em',
            margin: 0,
            lineHeight: 1.04,
            overflowWrap: 'break-word',
            opacity: nameOpacity,
            filter: `blur(${nameBlur}px)`,
            transform: `translateY(${nameY}px)`,
            textShadow: '0 10px 50px rgba(0,0,0,0.5)',
          }}
        >
          {businessName}
        </h1>
        <div style={{ width: lineWidth, height: 8 * s, borderRadius: 4 * s, background: accent, margin: `${30 * s}px auto 0`, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, width: 60 * s, left: `${sweep}px`, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)' }} />
        </div>
        <p
          style={{
            fontFamily: FONT,
            fontSize: 32 * s,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.86)',
            marginTop: 28 * s,
            opacity: tagOpacity,
            transform: `translateY(${tagY}px)`,
            lineHeight: 1.35,
          }}
        >
          {tagline}
        </p>
      </div>
    </AbsoluteFill>
  )
}

/** The clean theme: the classic full screen services list from v2, restored
 * and stretched to live in the same 235 frame slot the machine scene fills. */
const Scene2: React.FC<PitchProps> = ({ services, accent = '#f97316', logoSrc, logoHasAlpha }) => {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const s = height / 720
  const rows = services.filter((x) => x && x.trim()).slice(0, 3)
  const textSize = (rows.some((r) => r.length > 26) ? 34 : 44) * s

  const kick = spring({ frame: frame - 2, fps, config: { damping: 200 } })
  const exit = interpolate(frame, [226, 235], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const ringDrift = Math.sin(frame / 70) * 30 * s

  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: `0 ${130 * s}px`, opacity: exit }}>
      {/* Depth: slow accent ring on the right edge */}
      <div
        style={{
          position: 'absolute',
          right: -140 * s + ringDrift,
          top: height / 2 - 260 * s,
          width: 520 * s,
          height: 520 * s,
          borderRadius: 999,
          border: `${2.5 * s}px solid ${accent}22`,
        }}
      />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 * s, marginBottom: 46 * s, opacity: interpolate(kick, [0, 1], [0, 1]) }}>
          <div style={{ width: 12 * s, height: 12 * s, borderRadius: 3 * s, background: accent }} />
          <p style={{ fontFamily: FONT, fontSize: 24 * s, fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: accent, margin: 0 }}>
            What we do
          </p>
        </div>
        {rows.map((x, i) => {
          const enter = spring({ frame: frame - 8 - i * 15, fps, config: { damping: 200, mass: 0.8 } })
          const bullet = spring({ frame: frame - 12 - i * 15, fps, config: { damping: 12, mass: 0.6 } })
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 28 * s,
                marginBottom: 34 * s,
                opacity: interpolate(enter, [0, 1], [0, 1]),
                transform: `translateX(${interpolate(enter, [0, 1], [130 * s, 0])}px)`,
                filter: `blur(${interpolate(enter, [0, 1], [5, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 16 * s,
                  height: 16 * s,
                  borderRadius: 5 * s,
                  background: accent,
                  boxShadow: `0 0 ${26 * s}px ${accent}55`,
                  flexShrink: 0,
                  transform: `rotate(${interpolate(bullet, [0, 1], [-90, 0])}deg) scale(${interpolate(bullet, [0, 1], [0.4, 1])})`,
                }}
              />
              <span style={{ fontFamily: FONT, fontSize: textSize, fontWeight: 600, color: '#ffffff', lineHeight: 1.2 }}>{x.trim()}</span>
            </div>
          )
        })}
      </div>
      {logoSrc && logoHasAlpha ? (
        <Img
          src={logoSrc}
          style={{
            position: 'absolute',
            right: 70 * s,
            bottom: 54 * s,
            width: 120 * s,
            height: 120 * s,
            objectFit: 'contain',
            opacity: 0.3,
            filter: 'grayscale(0.1)',
          }}
        />
      ) : null}
    </AbsoluteFill>
  )
}

// The machine scene timeline, in scene local frames. One table so the whole
// act stays readable: the computer rises, the CRT fires up, the boot text
// types out, a burst of static flips the screen into slide mode, the
// member's services play on the screen, then the camera dives in.
const M_BOOT_L1 = 34 // HUSTLE MICROS 64K
const M_BOOT_L2 = 60 // LOADING <NAME>
const M_BOOT_BAR = 92 // ############ loader blocks
const M_READY = 118 // READY.
const M_RUN = 130 // RUN
const M_SWITCH = 137 // static burst, screen flips to slides
const M_SLIDES = 141 // first slide starts
const M_SLIDE_LEN = 28
const M_ZOOM = 211 // camera starts diving into the screen
const M_WHITE = 227 // screen flash floods the frame

/** Deterministic seeded static texture, generated once, same every render. */
function useNoiseTexture(): string {
  return useMemo(() => {
    try {
      const c = document.createElement('canvas')
      c.width = 120
      c.height = 68
      const ctx = c.getContext('2d')
      if (!ctx) return ''
      const d = ctx.createImageData(120, 68)
      let a = 1234567
      for (let i = 0; i < d.data.length; i += 4) {
        a = (a * 1664525 + 1013904223) >>> 0
        const v = (a >>> 16) & 255
        d.data[i] = v
        d.data[i + 1] = v
        d.data[i + 2] = v
        d.data[i + 3] = 255
      }
      ctx.putImageData(d, 0, 0)
      return c.toDataURL('image/png')
    } catch {
      return ''
    }
  }, [])
}

const SceneComputer: React.FC<PitchProps> = ({ businessName, tagline, services, accent = '#f97316', logoSrc, logoHasAlpha }) => {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const s = height / 720
  const noise = useNoiseTexture()

  // Boot name: uppercase, letters and digits only, keeps the CRT line short.
  const bootName = (businessName || '').toUpperCase().replace(/[^A-Z0-9 &']/g, '').trim().slice(0, 14) || 'YOUR BUSINESS'

  // Slides: the services play on the screen, or the tagline if none were entered.
  const slides = (services.map((x) => (x || '').trim()).filter(Boolean) as string[]).slice(0, 3)
  if (slides.length === 0 && tagline.trim()) slides.push(tagline.trim())
  if (slides.length === 0) slides.push(bootName)

  // Rise of the whole machine onto the stage
  const rise = spring({ frame, fps, config: { damping: 200, mass: 0.9 } })
  const riseY = interpolate(rise, [0, 1], [110 * s, 0])
  const riseOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' })

  // CRT power on: a dot becomes a line, the line becomes the picture
  const lineX = interpolate(frame, [12, 19], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const lineY = interpolate(frame, [19, 27], [0.012, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const flashFade = interpolate(frame, [24, 31], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const phosphorIn = interpolate(frame, [20, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const ledOn = frame >= 14

  // Boot text typing, deterministic char counts from the frame number
  const typed = (text: string, start: number) => {
    if (frame < start) return ''
    const n = Math.min(text.length, Math.floor((frame - start) / 1.3))
    return text.slice(0, n)
  }
  const barCount = frame < M_BOOT_BAR ? 0 : Math.min(12, Math.floor((frame - M_BOOT_BAR) / 1.8))
  const cursorOn = Math.floor(frame / 8) % 2 === 0

  // Screen mode and slide state
  const slidesMode = frame >= M_SWITCH + 4
  const current = Math.max(0, Math.min(slides.length - 1, Math.floor((frame - M_SLIDES) / M_SLIDE_LEN)))
  const sinceSlide = frame - (M_SLIDES + current * M_SLIDE_LEN)
  const text = slides[current] || slides[0]
  const textSize = (text.length > 24 ? 36 : text.length > 14 ? 42 : 50) * s

  // Static bursts: the big one when the screen flips, small ones per slide.
  // Gated on the slide section: below M_SLIDES the clamp would otherwise hand
  // back the burst PEAK for every boot frame and bury the boot text in noise.
  const switchBurst = interpolate(frame, [M_SWITCH, M_SWITCH + 2.5, M_SWITCH + 5], [0, 0.85, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const slideBurst = frame < M_SLIDES ? 0 : interpolate(sinceSlide, [0, 2, 4], [0.7, 0.35, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const burst = Math.max(switchBurst, slideBurst)

  // The dive into the screen at the end
  const zoom = interpolate(frame, [M_ZOOM, 235], [1, 3.6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) })
  const screenBright = interpolate(frame, [M_ZOOM, 235], [1, 2.1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const whiteOut = interpolate(frame, [M_WHITE, 235], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  // Subtle CRT life: flicker and slow scanline drift, both frame exact
  const flicker = 0.955 + 0.045 * Math.sin(frame / 2 + 1)
  const scanDrift = ((frame * 0.6) % 4) * s

  const glowP = 'rgba(120,240,160,'
  const bootLines: { at: number; content: string; cursor: boolean }[] = [
    { at: M_BOOT_L1, content: typed('HUSTLE MICROS 64K', M_BOOT_L1), cursor: frame >= M_BOOT_L1 },
    { at: M_BOOT_L2, content: typed(`LOADING ${bootName}`, M_BOOT_L2), cursor: frame >= M_BOOT_L2 && frame < M_BOOT_BAR + 26 },
  ]
  const showBar = barCount > 0
  const showReady = frame >= M_READY
  const showRun = frame >= M_RUN

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', opacity: riseOpacity }}>
      {/* Accent rim light behind the machine */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: height * 0.42,
          width: 980 * s,
          height: 620 * s,
          transform: 'translateX(-50%)',
          background: `radial-gradient(50% 50% at 50% 50%, ${accent}1f, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: 'relative',
          marginBottom: 34 * s,
          transformOrigin: '50% 33%',
          transform: `translateY(${riseY}px) scale(${zoom})`,
        }}
      >
        {/* Desk shadow */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -26 * s,
            width: 760 * s,
            height: 46 * s,
            transform: 'translateX(-50%)',
            background: 'radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,0.55), transparent 70%)',
          }}
        />
        {/* Monitor */}
        <div
          style={{
            position: 'relative',
            width: 560 * s,
            height: 430 * s,
            borderRadius: 20 * s,
            background: 'linear-gradient(180deg, #e4dbc9 0%, #d3c7b0 55%, #b6aa91 100%)',
            boxShadow: `0 ${26 * s}px ${60 * s}px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -3px 0 rgba(0,0,0,0.22)`,
          }}
        >
          {/* Vent grille */}
          <div
            style={{
              position: 'absolute',
              top: 13 * s,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 190 * s,
              height: 5 * s,
              background: `repeating-linear-gradient(90deg, rgba(0,0,0,0.28) 0, rgba(0,0,0,0.28) ${2 * s}px, transparent ${2 * s}px, transparent ${7 * s}px)`,
              opacity: 0.6,
            }}
          />
          {/* Bezel and screen */}
          <div
            style={{
              position: 'absolute',
              left: 36 * s,
              right: 36 * s,
              top: 30 * s,
              height: 348 * s,
              borderRadius: 14 * s,
              background: 'linear-gradient(180deg, #332e26 0%, #23201a 100%)',
              padding: 12 * s,
              boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.65)',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                borderRadius: 10 * s,
                overflow: 'hidden',
                background: '#050805',
              }}
            >
              {/* Phosphor picture, only after power on */}
              <AbsoluteFill style={{ opacity: phosphorIn, filter: `brightness(${screenBright})` }}>
                <AbsoluteFill
                  style={{
                    background: 'radial-gradient(120% 100% at 50% 45%, #0c1b11 0%, #07100a 55%, #030604 100%)',
                    opacity: flicker,
                  }}
                />
                {!slidesMode ? (
                  /* Boot text */
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      padding: `${26 * s}px ${28 * s}px`,
                      fontFamily: MONO,
                      fontSize: 24 * s,
                      lineHeight: 1.6,
                      color: '#8cf5ae',
                      textShadow: `0 0 ${6 * s}px ${glowP}0.75), 0 0 ${18 * s}px ${glowP}0.35)`,
                    }}
                  >
                    {bootLines.map((l, i) =>
                      l.content ? (
                        <div key={i}>
                          {l.content}
                          {l.cursor && cursorOn ? <span style={{ display: 'inline-block', width: 0.55 * 24 * s, height: 22 * s, background: '#8cf5ae', verticalAlign: 'text-bottom', marginLeft: 2 * s }} /> : null}
                        </div>
                      ) : null,
                    )}
                    {showBar ? <div>{'#'.repeat(barCount)}</div> : null}
                    {showReady ? <div>{typed('READY.', M_READY)}</div> : null}
                    {showRun ? (
                      <div>
                        {typed('RUN', M_RUN)}
                        {cursorOn ? <span style={{ display: 'inline-block', width: 0.55 * 24 * s, height: 22 * s, background: '#8cf5ae', verticalAlign: 'text-bottom', marginLeft: 2 * s }} /> : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  /* The member's presentation, playing on the screen */
                  <AbsoluteFill>
                    {/* Screen header: who is presenting */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: `${18 * s}px ${26 * s}px`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 * s, minWidth: 0 }}>
                        <div style={{ width: 13 * s, height: 13 * s, background: accent, boxShadow: `0 0 ${12 * s}px ${accent}` , flexShrink: 0 }} />
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 15 * s,
                            letterSpacing: '0.18em',
                            textTransform: 'uppercase',
                            color: '#cdebd8',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            textShadow: `0 0 ${8 * s}px ${glowP}0.5)`,
                          }}
                        >
                          {businessName}
                        </span>
                      </div>
                      {logoSrc ? (
                        logoHasAlpha ? (
                          <Img src={logoSrc} style={{ height: 38 * s, maxWidth: 110 * s, objectFit: 'contain', filter: `drop-shadow(0 0 ${8 * s}px rgba(255,255,255,0.25))` }} />
                        ) : (
                          <div style={{ flexShrink: 0 }}><LogoPlate src={logoSrc} size={30 * s} radius={7 * s} pad={5 * s} opacity={0.92} /></div>
                        )
                      ) : null}
                    </div>
                    {/* The slide itself */}
                    <div style={{ position: 'absolute', top: 58 * s, bottom: 66 * s, left: 24 * s, right: 24 * s, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span
                        style={{
                          fontFamily: FONT,
                          fontSize: textSize,
                          fontWeight: 700,
                          color: '#f2fff5',
                          textAlign: 'center',
                          lineHeight: 1.18,
                          overflowWrap: 'break-word',
                          maxWidth: '100%',
                          textShadow: `0 0 ${14 * s}px ${glowP}0.4)`,
                          opacity: interpolate(sinceSlide, [1, 5], [0.2, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                          transform: `translateY(${interpolate(sinceSlide, [1, 6], [7 * s, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`,
                        }}
                      >
                        {text}
                      </span>
                    </div>
                    {/* Slide dots and counter */}
                    <div style={{ position: 'absolute', bottom: 22 * s, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 10 * s }}>
                      {slides.map((_, i) => (
                        <div key={i} style={{ width: 9 * s, height: 9 * s, background: i === current ? accent : 'rgba(205,235,216,0.28)', boxShadow: i === current ? `0 0 ${10 * s}px ${accent}` : 'none' }} />
                      ))}
                    </div>
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 16 * s,
                        right: 24 * s,
                        fontFamily: MONO,
                        fontSize: 16 * s,
                        color: accent,
                        textShadow: `0 0 ${8 * s}px ${accent}88`,
                      }}
                    >
                      {current + 1}/{slides.length}
                    </div>
                  </AbsoluteFill>
                )}
                {/* Scanlines, drifting slowly like a real tube */}
                <AbsoluteFill
                  style={{
                    background: `repeating-linear-gradient(180deg, rgba(0,0,0,0.30) 0, rgba(0,0,0,0.30) ${1.5 * s}px, transparent ${1.5 * s}px, transparent ${4 * s}px)`,
                    backgroundPositionY: `${scanDrift}px`,
                    opacity: 0.55,
                  }}
                />
                {/* Glass reflection and tube vignette */}
                <AbsoluteFill
                  style={{
                    background: 'linear-gradient(115deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 22%, transparent 40%)',
                    boxShadow: `inset 0 0 ${70 * s}px rgba(0,0,0,0.6)`,
                  }}
                />
                {/* Static bursts */}
                {burst > 0.01 && noise ? (
                  <AbsoluteFill style={{ backgroundImage: `url(${noise})`, backgroundSize: '100% 100%', opacity: burst, transform: `translateY(${(frame % 2 === 0 ? 2 : -2) * s}px)` }} />
                ) : null}
                {/* Power on flash */}
                <AbsoluteFill style={{ background: '#eafff0', opacity: flashFade * (frame >= 12 && frame <= 31 ? 1 : 0), transform: `scale(${lineX}, ${lineY})` }} />
              </AbsoluteFill>
            </div>
          </div>
          {/* Chin: label and power light */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 46 * s,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 13 * s, letterSpacing: '0.4em', color: '#7d715c', textTransform: 'uppercase' }}>Hustle Micro</span>
            <div
              style={{
                position: 'absolute',
                right: 46 * s,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 10 * s,
                height: 10 * s,
                borderRadius: 999,
                background: ledOn ? accent : '#4a453b',
                boxShadow: ledOn ? `0 0 ${12 * s}px ${accent}` : 'none',
              }}
            />
          </div>
        </div>
        {/* Keyboard unit, the classic wedge */}
        <div
          style={{
            position: 'relative',
            marginTop: 22 * s,
            marginLeft: '50%',
            transform: 'translateX(-50%)',
            width: 640 * s,
            height: 150 * s,
            borderRadius: 12 * s,
            background: 'linear-gradient(180deg, #ded4c0 0%, #cbbfa7 70%, #ab9f87 100%)',
            boxShadow: `0 ${18 * s}px ${40 * s}px rgba(0,0,0,0.45), inset 0 2px 0 rgba(255,255,255,0.5)`,
          }}
        >
          {/* Function key row, the retro colour strip */}
          <div style={{ position: 'absolute', top: 16 * s, left: 30 * s, display: 'flex', gap: 8 * s }}>
            {['#a8432c', '#c97e2c', '#7c6644', '#d9c9a8', '#a8432c', '#c97e2c', '#7c6644', '#d9c9a8', '#a8432c', '#c97e2c'].map((k, i) => (
              <div key={i} style={{ width: 30 * s, height: 17 * s, borderRadius: 3 * s, background: k, boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.3)' }} />
            ))}
          </div>
          {/* Main key grid */}
          <div
            style={{
              position: 'absolute',
              top: 46 * s,
              left: 30 * s,
              right: 30 * s,
              bottom: 14 * s,
              display: 'grid',
              gridTemplateColumns: 'repeat(14, 1fr)',
              gridTemplateRows: 'repeat(3, 1fr)',
              gap: 6 * s,
            }}
          >
            {Array.from({ length: 42 }).map((_, i) => (
              <div key={i} style={{ borderRadius: 3 * s, background: 'linear-gradient(180deg, #ece2cf, #d9cdb5)', boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.22)' }} />
            ))}
          </div>
        </div>
      </div>
      {/* Screen flash floods the frame at the end of the dive */}
      <AbsoluteFill style={{ background: '#eafff0', opacity: whiteOut, pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}

const Scene3: React.FC<PitchProps> = ({ businessName, city, phone, accent = '#f97316', logoSrc, theme }) => {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const s = height / 720

  // Entry: the white flood from the screen dive decays away. Only the machine
  // theme dives through a screen, the clean theme arrives on a wipe instead.
  const flashOut = theme === 'clean' ? 0 : interpolate(frame, [0, 9], [0.92, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const pop = spring({ frame: frame + 4, fps, config: { damping: 12, mass: 0.7 } })
  const pulse = Math.sin(frame / 9) * 0.5 + 0.5
  const logoFloat = Math.sin(frame / 26) * 5 * s

  const cta = phone ? `Call ${phone}` : city ? `Visit us in ${city}` : 'Contact us today'
  const chips: { icon: 'phone' | 'pin'; text: string }[] = []
  if (phone) chips.push({ icon: 'phone', text: phone })
  if (city) chips.push({ icon: 'pin', text: city })

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      {/* Residual light from flying through the screen */}
      <AbsoluteFill style={{ background: '#eafff0', opacity: flashOut, pointerEvents: 'none' }} />
      <div style={{ textAlign: 'center' }}>
        {logoSrc ? (
          <div style={{ opacity: interpolate(frame, [0, 16], [0, 1], { extrapolateRight: 'clamp' }), transform: `translateY(${logoFloat}px)`, display: 'flex', justifyContent: 'center', marginBottom: 26 * s }}>
            <LogoPlate src={logoSrc} size={84 * s} radius={22 * s} pad={13 * s} />
          </div>
        ) : null}
        <div
          style={{
            display: 'inline-block',
            padding: `${26 * s}px ${64 * s}px`,
            borderRadius: 20 * s,
            background: accent,
            boxShadow: `0 ${10 + pulse * 16}px ${46 + pulse * 26}px ${accent}59`,
            transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`,
            opacity: interpolate(pop, [0, 1], [0, 1]),
          }}
        >
          <span style={{ fontFamily: FONT, fontSize: 54 * s, fontWeight: 800, color: '#0b0b0f', letterSpacing: '-0.01em' }}>{cta}</span>
        </div>
        {chips.length > 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16 * s, marginTop: 34 * s }}>
            {chips.map((c, i) => {
              const o = interpolate(frame, [24 + i * 10, 40 + i * 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
              const y = interpolate(frame, [24 + i * 10, 40 + i * 10], [16 * s, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10 * s,
                    padding: `${12 * s}px ${24 * s}px`,
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    opacity: o,
                    transform: `translateY(${y}px)`,
                  }}
                >
                  {c.icon === 'phone' ? <PhoneIcon size={18 * s} color="rgba(255,255,255,0.85)" /> : <PinIcon size={18 * s} color="rgba(255,255,255,0.85)" />}
                  <span style={{ fontFamily: FONT, fontSize: 24 * s, fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>{c.text}</span>
                </div>
              )
            })}
          </div>
        ) : null}
        <p
          style={{
            fontFamily: FONT,
            fontSize: 28 * s,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.9)',
            marginTop: 30 * s,
            opacity: interpolate(frame, [44, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        >
          {businessName}
        </p>
      </div>
    </AbsoluteFill>
  )
}

/** A skewed accent bar that sweeps across the cut between scenes. */
const Wipe: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const p = interpolate(frame, [start, start + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  if (p <= 0 || p >= 1) return null
  const x = interpolate(p, [0, 1], [-0.35 * width, 1.15 * width])
  return (
    <AbsoluteFill style={{ justifyContent: 'center', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: x,
          top: -height * 0.1,
          height: height * 1.2,
          width: width * 0.16,
          transform: 'skewX(-14deg)',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.14) 30%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0.14) 70%, transparent)',
        }}
      />
    </AbsoluteFill>
  )
}

export const PitchVideo: React.FC<PitchProps> = (props) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const accent = props.accent || '#f97316'
  const machine = (props.theme || 'machine') !== 'clean'

  // Shared stage: deep gradient, two drifting accent glows, vignette, end fade.
  const glowX = interpolate(Math.sin(frame / 110), [-1, 1], [width * 0.12, width * 0.88])
  const glowY = interpolate(Math.cos(frame / 90), [-1, 1], [height * 0.18, height * 0.82])
  const glow2X = interpolate(Math.cos(frame / 130), [-1, 1], [width * 0.85, width * 0.2])
  const glow2Y = interpolate(Math.sin(frame / 100), [-1, 1], [height * 0.75, height * 0.25])
  const endFade = interpolate(frame, [434, 449], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill style={{ background: '#08080b' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(${700 * (height / 720)}px ${480 * (height / 720)}px at ${glowX}px ${glowY}px, ${accent}30, transparent 70%),
            radial-gradient(${560 * (height / 720)}px ${420 * (height / 720)}px at ${glow2X}px ${glow2Y}px, ${accent}14, transparent 70%),
            linear-gradient(160deg, #101018 0%, #0b0b0f 60%, #08080b 100%)`,
        }}
      />
      {/* Vignette keeps every scene cinematic */}
      <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,0.5) 100%)' }} />
      <Sequence from={0} durationInFrames={105}>
        <Scene1 {...props} accent={accent} />
      </Sequence>
      <Sequence from={105} durationInFrames={235}>
        {machine ? <SceneComputer {...props} accent={accent} /> : <Scene2 {...props} accent={accent} />}
      </Sequence>
      <Sequence from={340} durationInFrames={PITCH_DURATION - 340}>
        <Scene3 {...props} accent={accent} />
      </Sequence>
      <Wipe start={98} />
      {machine ? null : <Wipe start={333} />}
      <AbsoluteFill style={{ background: '#000', opacity: endFade, pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}

export const pitchComposition = {
  id: 'pitch',
  component: PitchVideo,
  durationInFrames: PITCH_DURATION,
  fps: PITCH_FPS,
  width: PITCH_WIDTH,
  height: PITCH_HEIGHT,
} as const
