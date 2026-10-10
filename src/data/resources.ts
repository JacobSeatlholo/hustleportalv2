// Resource Hub — free tools, guides & learning materials (curated by Business Hustle)

export interface ResourceTool {
  name: string
  url: string
  desc: string
}

export interface ResourceCategory {
  icon: string
  color: string
  title: string
  items: ResourceTool[]
}

export const RESOURCES: ResourceCategory[] = [
  {
    icon: '🎨',
    color: '#f472b6',
    title: 'Design & UI',
    items: [
      { name: 'Canva', url: 'https://canva.com', desc: '8,000+ free templates' },
      { name: 'Figma', url: 'https://figma.com', desc: 'Design & publish websites' },
      { name: 'Photopea', url: 'https://photopea.com', desc: 'Free image editor' },
      { name: 'RemoveBG', url: 'https://remove.bg', desc: 'Remove image backgrounds' },
      { name: 'Undraw', url: 'https://undraw.co', desc: 'MIT licensed illustrations' },
    ],
  },
  {
    icon: '🌐',
    color: '#60a5fa',
    title: 'Website Hosting',
    items: [
      { name: 'Netlify', url: 'https://netlify.com', desc: 'Git-based serverless platform' },
      { name: 'Vercel', url: 'https://vercel.com', desc: 'Deploy frontend projects' },
      { name: 'GitHub Pages', url: 'https://pages.github.com', desc: 'Free static site hosting' },
    ],
  },
  {
    icon: '📈',
    color: '#34d399',
    title: 'SEO & Marketing',
    items: [
      { name: 'Moz', url: 'https://moz.com', desc: 'Leading SEO software' },
      { name: 'Search Engine Journal', url: 'https://searchenginejournal.com', desc: 'Expert SEO guides' },
      { name: 'Learning SEO', url: 'https://learningseo.io', desc: 'Free SEO mastery roadmap' },
    ],
  },
  {
    icon: '🏗️',
    color: '#F5C518',
    title: 'System Design Notes',
    items: [
      { name: '01 — Scaling', url: 'https://github.com/liquidslr/system-design-notes/tree/main/01.%20Scaling', desc: 'Horizontal & vertical scaling, load balancers, CDN' },
      { name: '02 — Back-of-Envelope Estimation', url: 'https://github.com/liquidslr/system-design-notes/tree/main/02.%20Back%20Of%20the%20Envelope%20Estimation', desc: 'Latency numbers, storage & throughput estimation' },
      { name: '03 — System Design Framework', url: 'https://github.com/liquidslr/system-design-notes/tree/main/03.%20System%20Design%20Framework', desc: 'Step-by-step interview framework' },
      { name: '04 — Rate Limiter', url: 'https://github.com/liquidslr/system-design-notes/tree/main/04.%20Rate%20Limiter', desc: 'Token bucket, leaky bucket, sliding window' },
      { name: '05 — Consistent Hashing', url: 'https://github.com/liquidslr/system-design-notes/tree/main/05.%20Consistent%20Hashing', desc: 'Distributed data partitioning' },
      { name: '06 — Key-Value Store', url: 'https://github.com/liquidslr/system-design-notes/tree/main/06.%20Key-Value%20Store', desc: 'CAP theorem, replication, consistency' },
      { name: '07 — Unique ID Generator', url: 'https://github.com/liquidslr/system-design-notes/tree/main/07.%20Unique%20ID%20Generator', desc: 'Snowflake IDs, UUID, distributed IDs' },
      { name: '08 — URL Shortener', url: 'https://github.com/liquidslr/system-design-notes/tree/main/08.%20URL%20Shortener', desc: 'Hash functions, redirects, analytics' },
      { name: '09 — Web Crawler', url: 'https://github.com/liquidslr/system-design-notes/tree/main/09.%20Web%20Crawler', desc: 'Politeness, BFS, distributed crawling' },
      { name: '10 — Notification System', url: 'https://github.com/liquidslr/system-design-notes/tree/main/10.%20Notification%20System', desc: 'Push, SMS, email at scale' },
      { name: '11 — News Feed System', url: 'https://github.com/liquidslr/system-design-notes/tree/main/11.%20News%20Feed%20System', desc: 'Fan-out on write vs read, ranking' },
      { name: '12 — Chat System', url: 'https://github.com/liquidslr/system-design-notes/tree/main/12.%20Chat%20System', desc: 'WebSockets, message delivery, group chat' },
      { name: '13 — Search Autocomplete', url: 'https://github.com/liquidslr/system-design-notes/tree/main/13.%20Search%20Autocomplete', desc: 'Trie, top-k, real-time suggestions' },
      { name: '14 — YouTube / Video CDN', url: 'https://github.com/liquidslr/system-design-notes/tree/main/14.%20YouTube', desc: 'Encoding pipeline, CDN, metadata storage' },
      { name: '15 — Google Drive', url: 'https://github.com/liquidslr/system-design-notes/tree/main/15.%20Google%20Drive', desc: 'Block storage, sync, conflict resolution' },
      { name: 'Full Repo — All Notes ⭐1.2k', url: 'https://github.com/liquidslr/system-design-notes', desc: "System Design Interview: An Insider's Guide — community notes" },
    ],
  },
  {
    icon: '💻',
    color: '#a78bfa',
    title: 'Software Development',
    items: [
      { name: 'Developer Roadmaps', url: 'https://roadmap.sh', desc: 'Step-by-step learning paths' },
      { name: 'MDN Web Docs', url: 'https://developer.mozilla.org', desc: 'Web standards reference' },
      { name: 'FreeCodeCamp', url: 'https://freecodecamp.com', desc: 'Learn to code for free' },
      { name: 'DevDocs', url: 'https://devdocs.io', desc: 'All API documentation' },
      { name: 'GitHub', url: 'https://github.com', desc: 'Source control & collaboration' },
    ],
  },
  {
    icon: '📋',
    color: '#F5C518',
    title: 'Project Management',
    items: [
      { name: 'Miro', url: 'https://miro.com', desc: 'Collaborative whiteboard' },
      { name: 'Diagrams.net', url: 'https://diagrams.net', desc: 'Free flowchart maker' },
      { name: 'Whereby', url: 'https://whereby.com', desc: 'Browser video meetings' },
      { name: 'Notion', url: 'https://notion.so', desc: 'All-in-one workspace' },
    ],
  },
  {
    icon: '🤖',
    color: '#67e8f9',
    title: 'Learn AI',
    items: [
      { name: 'Fast.ai', url: 'https://course.fast.ai', desc: 'Free practical deep learning' },
      { name: 'TensorFlow', url: 'https://tensorflow.org', desc: 'Open-source machine intelligence' },
      { name: 'Kaggle', url: 'https://kaggle.com', desc: 'ML & data science community' },
      { name: 'Anthropic Claude Docs', url: 'https://docs.anthropic.com', desc: 'Build with Claude AI' },
    ],
  },
  {
    icon: '💳',
    color: '#34d399',
    title: 'Payment Tools',
    items: [
      { name: 'Yoco', url: 'https://yoco.com', desc: 'SA payment gateway (used by BH)' },
      { name: 'PayFast', url: 'https://payfast.co.za', desc: 'SA online payment gateway' },
      { name: 'RevenueCat', url: 'https://revenuecat.com', desc: 'In-app subscriptions' },
    ],
  },
  {
    icon: '🎓',
    color: '#a78bfa',
    title: 'Education & Training',
    items: [
      { name: 'edX', url: 'https://edx.org', desc: 'Harvard, MIT & more — free' },
      { name: 'FreeCodeCamp', url: 'https://freecodecamp.com', desc: 'Full coding curriculum' },
      { name: 'Coursera', url: 'https://coursera.org', desc: 'World-class online courses' },
    ],
  },
]
