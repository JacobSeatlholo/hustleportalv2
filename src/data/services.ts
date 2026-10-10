export interface BhService {
  id: string
  icon: string // lucide icon key
  title: string
  desc: string
  color: string
  detail: string
  waMsg: string
}

/** Business Hustle client services — carried over from hustleportal.online (Services page). */
export const BH_SERVICES: BhService[] = [
  {
    id: 'brand-strategy',
    icon: 'target',
    title: 'Brand Strategy',
    desc: 'Position yourself to win',
    color: '#F5C518',
    detail:
      'We craft positioning strategies for SA businesses — from logo to market narrative. Clear brand strategy, messaging that resonates.',
    waMsg: "Hi Business Hustle! I'm interested in Brand Strategy. Please tell me more.",
  },
  {
    id: 'web-design',
    icon: 'laptop',
    title: 'Web Design South Africa',
    desc: 'Sites that convert',
    color: '#a78bfa',
    detail:
      'Custom websites and landing pages from R499. Fast, mobile-friendly, and SEO-ready for South African audiences.',
    waMsg: 'Hi Business Hustle! I need a website. Please tell me about your packages.',
  },
  {
    id: 'digital-marketing',
    icon: 'trending-up',
    title: 'Digital Marketing',
    desc: 'Grow your business online',
    color: '#34d399',
    detail:
      'Google Ads, Meta campaigns, SEO and social media management — data-driven campaigns that turn traffic into customers.',
    waMsg: "Hi Business Hustle! I'm interested in Digital Marketing. Please tell me more.",
  },
  {
    id: 'content-creation',
    icon: 'camera',
    title: 'Content Creation',
    desc: 'Stories that build your brand',
    color: '#f87171',
    detail:
      'Photo, video, copywriting and social content for SA audiences — content that drives engagement and sales.',
    waMsg: "Hi Business Hustle! I'm interested in Content Creation. Please tell me more.",
  },
  {
    id: 'hire-expert',
    icon: 'handshake',
    title: 'Hire an Expert',
    desc: "SA's vetted creative & tech talent",
    color: '#60a5fa',
    detail:
      'Access vetted South African designers, developers and marketers on demand. Matched within 24 hours.',
    waMsg: "Hi Business Hustle! I'd like to hire an expert. How does this work?",
  },
  {
    id: 'business-coaching',
    icon: 'brain',
    title: 'Business Coaching',
    desc: 'A roadmap to your next revenue level',
    color: '#fb923c',
    detail:
      '1-on-1 coaching and growth strategy packages for SA entrepreneurs. Get a clear plan to grow revenue and scale.',
    waMsg: "Hi Business Hustle! I'm interested in Business Coaching. Please tell me more.",
  },
]

export function waLink(msg: string) {
  return `https://wa.me/27744815163?text=${encodeURIComponent(msg)}`
}
