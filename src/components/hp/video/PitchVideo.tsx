import React from 'react'
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion'

/**
 * PitchVideo — the first HustlePortal marketing video template.
 * 12 seconds, 1280x720, 30fps: name and tagline slam in, three services
 * stack up, then the call to action holds the last four seconds.
 *
 * Everything is deterministic (spring and interpolate only, no Date or Math
 * random) so the browser render and the Player preview are frame identical.
 * System font stack only — the web renderer draws inside the member's own
 * browser, so no webfont loading can fail mid render.
 */

export interface PitchProps {
  businessName: string
  tagline: string
  services: string[]
  city?: string
  phone?: string
  accent?: string
}

export const PITCH_FPS = 30
export const PITCH_DURATION = 360 // 12 seconds
export const PITCH_WIDTH = 1280
export const PITCH_HEIGHT = 720

export const ACCENT_PRESETS: { key: string; label: string; color: string }[] = [
  { key: 'ember', label: 'Ember', color: '#f97316' },
  { key: 'ocean', label: 'Ocean', color: '#0ea5e9' },
  { key: 'forest', label: 'Forest', color: '#22c55e' },
  { key: 'grape', label: 'Grape', color: '#a855f7' },
  { key: 'crimson', label: 'Crimson', color: '#ef4444' },
  { key: 'gold', label: 'Gold', color: '#eab308' },
]

const Scene1: React.FC<PitchProps> = ({ businessName, tagline, accent = '#f97316' }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const nameRise = spring({ frame, fps, config: { damping: 200, mass: 0.9 } })
  const nameY = interpolate(nameRise, [0, 1], [70, 0])
  const nameOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' })

  const lineGrow = spring({ frame: frame - 14, fps, config: { damping: 200 } })
  const lineWidth = interpolate(lineGrow, [0, 1], [0, 320])

  const tagOpacity = interpolate(frame, [34, 54], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const tagY = interpolate(frame, [34, 54], [24, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', padding: '0 90px' }}>
        <h1
          style={{
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
            fontSize: 92,
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            margin: 0,
            opacity: nameOpacity,
            transform: `translateY(${nameY}px)`,
            textShadow: '0 8px 40px rgba(0,0,0,0.45)',
            lineHeight: 1.05,
            overflowWrap: 'break-word',
          }}
        >
          {businessName}
        </h1>
        <div
          style={{
            width: lineWidth,
            height: 8,
            borderRadius: 4,
            background: accent,
            margin: '34px auto 0',
          }}
        />
        <p
          style={{
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
            fontSize: 34,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.86)',
            marginTop: 30,
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

const Scene2: React.FC<PitchProps> = ({ services, accent = '#f97316' }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rows = services.filter((s) => s && s.trim()).slice(0, 3)

  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 120px' }}>
      <p
        style={{
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: accent,
          marginBottom: 44,
        }}
      >
        What we do
      </p>
      {rows.map((s, i) => {
        const enter = spring({ frame: frame - i * 16, fps, config: { damping: 200, mass: 0.8 } })
        const x = interpolate(enter, [0, 1], [120, 0])
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 26,
              marginBottom: 30,
              opacity: interpolate(enter, [0, 1], [0, 1]),
              transform: `translateX(${x}px)`,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: accent,
                boxShadow: `0 0 24px ${accent}66`,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
                fontSize: 46,
                fontWeight: 600,
                color: '#ffffff',
                lineHeight: 1.2,
              }}
            >
              {s.trim()}
            </span>
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

const Scene3: React.FC<PitchProps> = ({ businessName, city, phone, accent = '#f97316' }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.7 } })
  const pulse = Math.sin(frame / 9) * 0.5 + 0.5
  const cta = phone ? `Call ${phone}` : city ? `Visit us in ${city}` : 'Contact us today'
  const where = city && phone ? city : ''

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-block',
            padding: '26px 64px',
            borderRadius: 18,
            background: accent,
            boxShadow: `0 ${10 + pulse * 14}px ${44 + pulse * 22}px ${accent}59`,
            transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`,
            opacity: interpolate(pop, [0, 1], [0, 1]),
          }}
        >
          <span
            style={{
              fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
              fontSize: 56,
              fontWeight: 800,
              color: '#0b0b0f',
              letterSpacing: '-0.01em',
            }}
          >
            {cta}
          </span>
        </div>
        {where ? (
          <p
            style={{
              fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
              fontSize: 28,
              color: 'rgba(255,255,255,0.75)',
              marginTop: 34,
              opacity: interpolate(frame, [26, 44], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            }}
          >
            {where}
          </p>
        ) : null}
        <p
          style={{
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
            fontSize: 30,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.92)',
            marginTop: 26,
            opacity: interpolate(frame, [44, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        >
          {businessName}
        </p>
      </div>
    </AbsoluteFill>
  )
}

export const PitchVideo: React.FC<PitchProps> = (props) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const accent = props.accent || '#f97316'

  // Shared animated background: deep gradient + a slow drifting accent glow.
  const glowX = interpolate(Math.sin(frame / 110), [-1, 1], [width * 0.15, width * 0.85])
  const glowY = interpolate(Math.cos(frame / 90), [-1, 1], [height * 0.2, height * 0.8])
  const fadeOut = interpolate(frame, [PITCH_DURATION - 18, PITCH_DURATION - 1], [1, 0.9], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ background: '#0b0b0f', opacity: fadeOut }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 600px at ${glowX}px ${glowY}px, ${accent}2e, transparent 70%), linear-gradient(160deg, #101018 0%, #0b0b0f 60%, #08080b 100%)`,
        }}
      />
      <Sequence from={0} durationInFrames={105}>
        <Scene1 {...props} accent={accent} />
      </Sequence>
      <Sequence from={105} durationInFrames={150}>
        <Scene2 {...props} accent={accent} />
      </Sequence>
      <Sequence from={255} durationInFrames={PITCH_DURATION - 255}>
        <Scene3 {...props} accent={accent} />
      </Sequence>
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
