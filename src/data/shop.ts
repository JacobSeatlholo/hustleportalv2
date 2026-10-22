// Store catalogue, real Business Hustle products (from app.businesshustle.co.za/shop)
// Purchases happen via Yoco-secured product pages or WhatsApp ordering, exactly like the legacy site.

export interface ShopItem {
  title: string
  price: string
  tag: string
  color: string
  img: string
  cat: string
  desc: string
  fullDesc: string
  url: string
  waMsg: string
}

export const SHOP_CATEGORIES = [
  'All',
  'Starter Kits',
  'Consulting & Strategy',
  'Project Management',
  'Digital Products',
  'Web Development',
] as const

export const SHOP_ITEMS: ShopItem[] = [
  {
    title: 'Hustle Basics eBook',
    price: 'R270',
    tag: '🔥 Sale',
    color: '#F5C518',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2023/09/Hustle-Basics-2023-cover-450x450.png',
    cat: 'Starter Kits',
    desc: 'Essential entrepreneur toolkit, on sale from R399',
    fullDesc:
      'The essential guide for entrepreneurs, freelancers and small business owners. Frameworks, planning tools and strategy to get you started.',
    url: 'https://app.businesshustle.co.za/product/hustle-basics-ebook/',
    waMsg: "Hi HustlePortal team! I'd like the Hustle Basics eBook (R270). Please assist.",
  },
  {
    title: 'Hustle Guru Subscription',
    price: 'R249',
    tag: 'Subscription',
    color: '#F5C518',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/01/Hustle-Guru-Product-Image-450x450.png',
    cat: 'Project Management',
    desc: 'Monthly business growth subscription',
    fullDesc:
      'Ongoing access to tools, resources and business growth support, billed monthly. Cancel anytime.',
    url: 'https://app.businesshustle.co.za/product/hustle-guru-subscription/',
    waMsg: "Hi HustlePortal team! I'd like the Hustle Guru Subscription (R249/mo). Please assist.",
  },
  {
    title: 'Brand Strategist Starter Kit',
    price: 'R650',
    tag: 'Starter Kit',
    color: '#fb923c',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2023/09/Hustle-Basics-2023-450x450.png',
    cat: 'Starter Kits',
    desc: 'Brand strategy templates & frameworks',
    fullDesc:
      'Everything you need to build a brand strategy, positioning templates, messaging frameworks, and brand identity tools.',
    url: 'https://app.businesshustle.co.za/product/brand-strategist-starter-kit/',
    waMsg: "Hi HustlePortal team! I'd like the Brand Strategist Starter Kit (R650). Please assist.",
  },
  {
    title: 'Brand Consulting',
    price: 'From R650',
    tag: 'Consulting',
    color: '#F5C518',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/02/18-450x450.png',
    cat: 'Consulting & Strategy',
    desc: 'Expert brand strategy consultation',
    fullDesc:
      'Work directly with a professional brand expert to position your business for growth. Multiple tiers available.',
    url: 'https://app.businesshustle.co.za/product/brand-consulting/',
    waMsg: 'Hi HustlePortal team! I\'m interested in Brand Consulting. Please tell me about your options.',
  },
  {
    title: 'Content Creation',
    price: 'R1,550',
    tag: 'Marketing',
    color: '#f472b6',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/02/www.businesshustle.co_.za-Content-Creation-Artwork-450x450.jpg',
    cat: 'Consulting & Strategy',
    desc: 'Professional content for your brand',
    fullDesc:
      'Photo, video, copywriting and social content tailored for South African audiences, content that drives engagement and sales.',
    url: 'https://app.businesshustle.co.za/product/content-creation/',
    waMsg: "Hi HustlePortal team! I'm interested in Content Creation (R1,550). Please assist.",
  },
  {
    title: 'Kloof Street Starter Feature Package',
    price: 'R960',
    tag: 'BH Local',
    color: '#fb923c',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/12/Screenshot-2025-12-04-at-15.19.25.png',
    cat: 'Starter Kits',
    desc: 'Get your business on KloofStreet.online',
    fullDesc:
      "Starter listing and brand feature on KloofStreet.online, your business in SA's premier hyperlocal digital guide.",
    url: 'https://app.businesshustle.co.za/product/kloof-street-starter-feature-package/',
    waMsg: "Hi HustlePortal team! I'm interested in the Kloof Street Starter Feature Package (R960). Please assist.",
  },
  {
    title: 'Kloof Street Growth Package',
    price: 'R1,360',
    tag: 'BH Local',
    color: '#fb923c',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/12/Screenshot-2025-12-04-at-15.29.40.png',
    cat: 'Starter Kits',
    desc: 'Enhanced KloofStreet.online presence',
    fullDesc:
      'Full brand feature, priority placement and growth tools on KloofStreet.online, the hyperlocal business platform.',
    url: 'https://app.businesshustle.co.za/product/kloof-street-growth-package/',
    waMsg: "Hi HustlePortal team! I'm interested in the Kloof Street Growth Package (R1,360). Please assist.",
  },
  {
    title: 'Graphic Design',
    price: 'R2,999',
    tag: 'Design',
    color: '#a78bfa',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/02/www.businesshustle.co_.za-Graphic-Design-450x450.jpg',
    cat: 'Consulting & Strategy',
    desc: 'Professional graphic design for your brand',
    fullDesc:
      'Professional graphic design, logo, brand identity, marketing materials and visual assets built for your business.',
    url: 'https://app.businesshustle.co.za/product/graphic-design/',
    waMsg: "Hi HustlePortal team! I'm interested in Graphic Design (R2,999). Please assist.",
  },
  {
    title: 'Business Case Planning',
    price: 'R4,999',
    tag: 'Strategy',
    color: '#F5C518',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/02/www.businesshustle.co_.za-Business-Case-Planning-450x450.jpg',
    cat: 'Consulting & Strategy',
    desc: 'Full business case & financial model',
    fullDesc:
      'A comprehensive business case, market analysis, financial projections, risk assessment and strategic roadmap for your venture.',
    url: 'https://app.businesshustle.co.za/product/business-case-planning/',
    waMsg: "Hi HustlePortal team! I'm interested in Business Case Planning (R4,999). Please assist.",
  },
  {
    title: 'Influencer Campaign',
    price: 'R4,999',
    tag: 'Marketing',
    color: '#f472b6',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/02/www.businesshustle.co_.za-Influencer-marketing-450x450.png',
    cat: 'Digital Products',
    desc: 'Influencer marketing campaign management',
    fullDesc:
      'End-to-end influencer campaign, strategy, influencer matching, content briefs, execution and performance reporting.',
    url: 'https://app.businesshustle.co.za/product/influencer-campaign/',
    waMsg: "Hi HustlePortal team! I'm interested in an Influencer Campaign (R4,999). Please assist.",
  },
  {
    title: '3D Design',
    price: 'R4,500',
    tag: 'Creative',
    color: '#a78bfa',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/02/www.businesshustle.co_.za-3D-Design-2.gif',
    cat: 'Consulting & Strategy',
    desc: '3D product & brand visualisation',
    fullDesc:
      'High-quality 3D design and visualisation for products, spaces and brand assets. Bring your vision to life in three dimensions.',
    url: 'https://app.businesshustle.co.za/product/3d-design/',
    waMsg: "Hi HustlePortal team! I'm interested in 3D Design (R4,500). Please assist.",
  },
  {
    title: 'Brand Scale Up Bundle',
    price: 'R7,999',
    tag: 'Best Value',
    color: '#34d399',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/02/www.businesshustle.co_.za-scale-up-bundle.gif',
    cat: 'Digital Products',
    desc: 'Full brand + web + marketing bundle',
    fullDesc:
      'The complete growth package, brand identity, web presence, content strategy and marketing setup all in one bundle.',
    url: 'https://app.businesshustle.co.za/product/brand-scale-up-bundle/',
    waMsg: "Hi HustlePortal team! I'm interested in the Brand Scale Up Bundle (R7,999). Please assist.",
  },
  {
    title: 'Risk & Compliance Strategy',
    price: 'R8,500',
    tag: 'Enterprise',
    color: '#f87171',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/02/www.businesshustle.co_.za-Risk-Compliance-Strategy.gif',
    cat: 'Consulting & Strategy',
    desc: 'Business risk & regulatory compliance plan',
    fullDesc:
      'Comprehensive risk assessment and compliance strategy, governance frameworks, regulatory alignment and risk mitigation for your business.',
    url: 'https://app.businesshustle.co.za/product/risk-compliance-strategy/',
    waMsg: "Hi HustlePortal team! I'm interested in Risk & Compliance Strategy (R8,500). Please assist.",
  },
  {
    title: 'Brand Launch Package',
    price: 'R21,000',
    tag: 'Premium',
    color: '#F5C518',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/02/www.businesshustle.co_.za-Brand-starter-package-1-450x450.png',
    cat: 'Web Development',
    desc: 'Full brand launch, identity, web & marketing',
    fullDesc:
      'Our most comprehensive launch offer, complete brand identity, web development, content creation and marketing strategy. Built to launch fast.',
    url: 'https://app.businesshustle.co.za/product/brand-launch-package/',
    waMsg: "Hi HustlePortal team! I'm interested in the Brand Launch Package (R21,000). Please assist.",
  },
  {
    title: 'Essential Kloof Street Brand Feature Package',
    price: 'View options',
    tag: 'BH Local',
    color: '#fb923c',
    img: 'https://app.businesshustle.co.za/wp-content/uploads/2025/12/Screenshot-2025-12-04-at-15.07.47.png',
    cat: 'Starter Kits',
    desc: 'KloofStreet.online brand feature options',
    fullDesc:
      'Multiple brand feature tiers for KloofStreet.online, get your business visible to thousands of local shoppers.',
    url: 'https://app.businesshustle.co.za/product/essential-kloof-street-brand-feature-package/',
    waMsg: "Hi HustlePortal team! I'm interested in the Kloof Street Brand Feature Package. Please show me the options.",
  },
]

export function waLink(msg: string) {
  return `https://wa.me/27744815163?text=${encodeURIComponent(msg)}`
}
