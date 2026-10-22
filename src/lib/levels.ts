/**
 * levels.ts, the pure hustle ladder, safe to import from client components
 * (no database here). gamification.ts builds on it server-side.
 */
export const LEVELS = [
  { level: 1, name: 'Seedling', min: 0, icon: '🌱', rewardCents: 0, reward: 'Starter credits on signup' },
  { level: 2, name: 'Builder', min: 100, icon: '🔧', rewardCents: 500, reward: 'R5 wallet credit' },
  { level: 3, name: 'Operator', min: 300, icon: '⚡', rewardCents: 1000, reward: 'R10 wallet credit' },
  { level: 4, name: 'Closer', min: 700, icon: '🎯', rewardCents: 1500, reward: 'R15 wallet credit' },
  { level: 5, name: 'Boss', min: 1200, icon: '👑', rewardCents: 2500, reward: 'R25 wallet credit' },
  { level: 6, name: 'Tycoon', min: 2500, icon: '🏆', rewardCents: 5000, reward: 'R50 wallet credit' },
]

export function levelFor(xp: number) {
  let current = LEVELS[0]
  for (const l of LEVELS) if (xp >= l.min) current = l
  const next = LEVELS.find((l) => l.min > current.min) || null
  const span = next ? next.min - current.min : 1
  const progress = next ? Math.min(100, Math.round(((xp - current.min) / span) * 100)) : 100
  return { ...current, next, progress }
}
