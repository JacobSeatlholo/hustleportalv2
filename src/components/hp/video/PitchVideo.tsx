import React from 'react'
import { AbsoluteFill, Img, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion'

/**
 * PitchVideo, the HustlePortal marketing video template, v2.
 * 12 seconds, 30fps, resolution independent (scales from the 720 design grid
 * to 1080 and beyond). The member can attach their own logo: it pops in the
 * opener, rides as a watermark in the service scene and crowns the closing
 * call to action.
 *
 * Everything is deterministic (spring, interpolate and Math.sin only, no Date
 * or Math random) so the browser render and the Player preview are frame
 * identical. System font stack only, the web renderer draws inside the
 * member's own browser, so no webfont loading can fail mid render.
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
}

export const PITCH_FPS = 30
export const PITCH_DURATION = 360 // 12 seconds

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
 * to the next one, so an export always lands at some quality.
 */
export const QUALITY_PRESETS: QualityPreset[] = [
  { key: 'max', label: 'Maximum', width: 1920, height: 1080, bitrate: 5_500_000, note: 'Full HD' },
  { key: 'sharp', label: 'Sharp', width: 1280, height: 720, bitrate: 5_000_000, note: 'HD, smallest file' },
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

const Scene2: React.FC<PitchProps> = ({ services, accent = '#f97316', logoSrc, logoHasAlpha }) => {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const s = height / 720
  const rows = services.filter((x) => x && x.trim()).slice(0, 3)
  const textSize = (rows.some((r) => r.length > 26) ? 34 : 44) * s

  const kick = spring({ frame: frame - 2, fps, config: { damping: 200 } })
  const exit = interpolate(frame, [140, 149], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
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

const Scene3: React.FC<PitchProps> = ({ businessName, city, phone, accent = '#f97316', logoSrc }) => {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const s = height / 720

  const pop = spring({ frame: frame + 4, fps, config: { damping: 12, mass: 0.7 } })
  const pulse = Math.sin(frame / 9) * 0.5 + 0.5
  const logoFloat = Math.sin(frame / 26) * 5 * s

  const cta = phone ? `Call ${phone}` : city ? `Visit us in ${city}` : 'Contact us today'
  const chips: { icon: 'phone' | 'pin'; text: string }[] = []
  if (phone) chips.push({ icon: 'phone', text: phone })
  if (city) chips.push({ icon: 'pin', text: city })

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
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

  // Shared stage: deep gradient, two drifting accent glows, vignette, end fade.
  const glowX = interpolate(Math.sin(frame / 110), [-1, 1], [width * 0.12, width * 0.88])
  const glowY = interpolate(Math.cos(frame / 90), [-1, 1], [height * 0.18, height * 0.82])
  const glow2X = interpolate(Math.cos(frame / 130), [-1, 1], [width * 0.85, width * 0.2])
  const glow2Y = interpolate(Math.sin(frame / 100), [-1, 1], [height * 0.75, height * 0.25])
  const endFade = interpolate(frame, [344, 359], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

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
      <Sequence from={105} durationInFrames={150}>
        <Scene2 {...props} accent={accent} />
      </Sequence>
      <Sequence from={255} durationInFrames={PITCH_DURATION - 255}>
        <Scene3 {...props} accent={accent} />
      </Sequence>
      <Wipe start={98} />
      <Wipe start={248} />
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
