/**
 * tutorials.ts, the per-section guided walkthroughs.
 *
 * Every view gets a "How this works" tutorial so a user NEVER gets lost:
 *  - a floating Tutorial button (SectionTutorial.tsx) is always in reach
 *  - the core sections auto-open their tutorial once, on first visit
 * Steps are short, outcome-first, and written in the brand voice:
 * you tell us what you do → AI finds verified leads → they land in your pipeline.
 */
import type { ViewKey } from './store'

export interface TutorialStep {
  icon: string // lucide icon name, resolved in SectionTutorial to keep this file server-safe
  title: string
  body: string
}

export interface SectionTutorialDef {
  title: string
  kicker: string
  steps: TutorialStep[]
  /** Auto-open the first time the user lands on this view (once per browser). */
  auto?: boolean
}

export const SECTION_TUTORIALS: Partial<Record<ViewKey, SectionTutorialDef>> = {
  dashboard: {
    title: 'Your dashboard',
    kicker: 'Mission control',
    auto: false,
    steps: [
      { icon: 'LayoutDashboard', title: 'One glance, whole business', body: 'Leads moving, money in and out, today\u2019s tasks, the dashboard is your morning coffee check. Everything is one tap away from here.' },
      { icon: 'Zap', title: 'Do the daily challenges', body: 'Small actions every day, follow up, add a lead, send an invoice, earn XP and level up your plan perks.' },
      { icon: 'Target', title: 'Start with one lead', body: 'Open the Lead Finder, describe who you want to sell to, and let the AI load real businesses into your pipeline. That\u2019s the whole trick.' },
    ],
  },
  leads: {
    title: 'Lead Finder & pipeline',
    kicker: 'Find customers',
    auto: true,
    steps: [
      { icon: 'Target', title: 'Tell us who you want to sell to', body: 'One line is enough: "taverns in Soweto that need card machines". Or tap Tag location and we search within 5 km of where you stand.' },
      { icon: 'Sparkles', title: 'The AI scouts the real web', body: 'HustlePortal AI searches live web results and the map directory, only businesses that actually exist, with websites, phones and emails when they\u2019re public. No made-up leads, ever.' },
      { icon: 'Users', title: 'Results land in your pipeline', body: 'Pick the good fits and they become pipeline cards: Contacted → Qualified → Quote Sent → Won. Use the stage filter up top to focus on what\u2019s hot.' },
      { icon: 'Unlock', title: 'Reveal contact details', body: 'Some leads hide their email/phone until revealed, reveals use your plan credits and are always real, checked details.' },
      { icon: 'ThumbsUp', title: 'Rate your leads, teach the machine', body: 'Honest talk: this finder is young, and it gets sharper every single day. Every search teaches it, and so do you: one tap on any lead, Good fit or Not a fit. A not-a-fit goes back to the pool to find a better-suited seller and never wastes your time again. Reveals stay what they always were, real checked contacts or your credits stay put. The more you rate, the better your leads get.' },
    ],
  },
  clients: {
    title: 'Clients & CRM',
    kicker: 'Keep customers',
    auto: true,
    steps: [
      { icon: 'Users', title: 'Everyone you do business with', body: 'Clients are your saved relationships, leads that said yes, repeat buyers, suppliers. Add them once, use them everywhere.' },
      { icon: 'MessageSquare', title: 'Log every touchpoint', body: 'After each call or WhatsApp, add a note on the client. Next time you open them, the whole story is there, you never walk in cold.' },
      { icon: 'Mail', title: 'Reach out without leaving', body: 'Draft AI emails straight from a client card, grounded in your business profile, sent by the HustlePortal engine.' },
    ],
  },
  tasks: {
    title: 'Tasks',
    kicker: 'Run the day',
    auto: true,
    steps: [
      { icon: 'Plus', title: 'Capture it in 3 seconds', body: 'Type the task, pick where it belongs, Personal, Business, or a team, set a date, hit Add. Done.' },
      { icon: 'Building2', title: 'Personal vs Business vs Team', body: 'Personal is just for you. Business is shared with your whole workspace. Team tasks can be assigned to a specific teammate.' },
      { icon: 'MessageSquare', title: 'Talk about it right there', body: 'Tap the speech bubble on any task to start a comment thread, your team discusses, decides, and marks it done without a single WhatsApp group.' },
      { icon: 'Camera', title: 'Scan your diary', body: 'Snap a page of your notebook and the AI turns it into real tasks. Old-school hustlers, this one\u2019s for you.' },
    ],
  },
  inventory: {
    title: 'Inventory',
    kicker: 'Know your stock',
    auto: true,
    steps: [
      { icon: 'Package', title: 'Every item you sell or use', body: 'Add items with cost price, selling price and quantity. The KPIs up top show your stock value and potential retail, you always know what\u2019s on the shelf.' },
      { icon: 'Plus', title: 'Count in, count out', body: 'Stock arrives? Tap +. You sold some? Tap −. One tap each, the count stays true without a spreadsheet.' },
      { icon: 'AlertTriangle', title: 'Low stock warns you first', body: 'Items that run low get a badge so you restock before you lose a sale.' },
    ],
  },
  invoices: {
    title: 'Invoices',
    kicker: 'Get paid',
    auto: true,
    steps: [
      { icon: 'FileText', title: 'Professional in 60 seconds', body: 'Pick a client, add line items, send. The invoice carries your business name, VAT-ready totals and your bank details, it looks like a company twice your size.' },
      { icon: 'Wallet', title: 'Payment link built in', body: 'Clients can pay by card from the invoice itself when your Yoco card is linked in the Wallet, money lands, invoice marks itself paid.' },
      { icon: 'Bell', title: 'Chase without the awkwardness', body: 'Overdue? Send the polite AI-written reminder in one tap. Consistent follow-up is how small businesses stay cashed-up.' },
    ],
  },
  finance: {
    title: 'Finance',
    kicker: 'Know your numbers',
    auto: true,
    steps: [
      { icon: 'TrendingUp', title: 'Money in, money out', body: 'Log income and expenses as they happen, 10 seconds each. The summaries and charts build themselves from these entries.' },
      { icon: 'PieChart', title: 'See where it really goes', body: 'Category breakdowns show what eats your profit, data you can act on at month-end, not guesses.' },
      { icon: 'FileDown', title: 'Tax season? Already done', body: 'Export your entries any time. Your accountant gets a clean sheet instead of a shoebox of slips.' },
    ],
  },
  mail: {
    title: 'Mail',
    kicker: 'Close on autopilot',
    auto: true,
    steps: [
      { icon: 'Sparkles', title: 'Gemini writes, you approve', body: 'Pick a goal, or write your own, like "Welcome email for my team", and the AI drafts it grounded in your business profile. Edit anything, then send.' },
      { icon: 'Send', title: 'Sending just works', body: 'The HustlePortal engine delivers and replies route back to your inbox. Want your own address on the label? Connect Gmail under Integrations.' },
      { icon: 'Repeat', title: 'Follow-ups win deals', body: 'The fortune is in the follow-up, after any quote or meeting, send the next email the same day. The log on the right remembers every send.' },
    ],
  },
  ai: {
    title: 'AI Co-Founder',
    kicker: 'Your unfair advantage',
    auto: true,
    steps: [
      { icon: 'Bot', title: 'Ask like a business partner', body: '"What should I do this week to get more clients?", it reads your real pipeline, profile and numbers, then answers with a plan, not fluff.' },
      { icon: 'FileText', title: 'One-tap business plans', body: 'Need a plan for funding or focus? The Co-Founder writes a full plan from your profile, edit and export it.' },
      { icon: 'ShieldCheck', title: 'It never invents your facts', body: 'Everything is grounded in what you saved. Fill your profile well and the AI represents you well.' },
    ],
  },
  calendar: {
    title: 'Calendar',
    kicker: 'Never double-book',
    auto: false,
    steps: [
      { icon: 'CalendarDays', title: 'Every booking in one place', body: 'Appointments created by you, by the AI from your diary scans, or by clients via your Services page, all on one calendar.' },
      { icon: 'Video', title: 'Meetings get a link automatically', body: 'Each appointment can carry a one-tap meeting link, so "where do we meet?" is never a lost WhatsApp message.' },
      { icon: 'Bell', title: 'Add to Google Calendar', body: 'One tap exports the booking to your phone\u2019s calendar so reminders find you where you already live.' },
    ],
  },
  integrations: {
    title: 'Integrations',
    kicker: 'Plug & play',
    auto: false,
    steps: [
      { icon: 'Plug', title: 'Everything already works', body: 'AI, email, invoices, running out of the box. Everything on this page is an optional upgrade, never a requirement.' },
      { icon: 'Sparkles', title: 'Bring your own Gemini key (optional)', body: 'Paste a free key from aistudio.google.com/apikey and AI runs on your quota. It\u2019s verified the moment you save, and if Google ever blocks it, HustlePortal AI quietly takes over so nothing breaks.' },
      { icon: 'Stethoscope', title: 'Something failing? Diagnose it', body: 'The AI diagnostics card reproduces the exact call chain and tells you the fix in plain language. No guesswork.' },
    ],
  },
  profile: {
    title: 'Profile & Team',
    kicker: 'Set your base',
    auto: false,
    steps: [
      { icon: 'Globe', title: 'Your website teaches the AI', body: 'Paste your web address and the AI reads it, audience, brand voice, pitches, and drafts your profile. Check, save, and every AI draft gets sharper.' },
      { icon: 'Users', title: 'Build your team here', body: 'Create a team, invite by email, teammates join even without an account yet, and land straight in your space when they sign up.' },
      { icon: 'RotateCcw', title: 'Lost? Replay the tour', body: 'The welcome tour and every section tutorial live here, replay them any time.' },
    ],
  },
  store: {
    title: 'Store',
    kicker: 'Tools that sell',
    auto: false,
    steps: [
      { icon: 'ShoppingCart', title: 'Services and toolkits for your hustle', body: 'Everything here is picked for South African small business, from website builds to branding kits. Order in-app, we deliver and follow up.' },
      { icon: 'Sparkles', title: 'AI drafts the request for you', body: 'Not sure what to ask for? Describe the outcome and the AI turns it into a proper service request.' },
    ],
  },
  services: {
    title: 'Services',
    kicker: 'Your public menu',
    auto: false,
    steps: [
      { icon: 'Store', title: 'What you offer, beautifully listed', body: 'Add your services with prices, this page powers your public booking page, so customers can order while you sleep.' },
      { icon: 'Share2', title: 'Share one link everywhere', body: 'Your services link works on WhatsApp status, flyers and bios. One link, whole menu.' },
    ],
  },
  wallet: {
    title: 'Wallet',
    kicker: 'Fuel the machine',
    auto: false,
    steps: [
      { icon: 'Wallet', title: 'Credits power reveals and sends', body: 'Lead reveals and AI-heavy actions use credits. Your balance is always up top, top up with card in two taps.' },
      { icon: 'CreditCard', title: 'Link Yoco once', body: 'Linking your card enables instant top-ups AND card payments on your invoices. One link, double win.' },
    ],
  },
  grow: {
    title: 'Grow & Earn',
    kicker: 'Level up',
    auto: false,
    steps: [
      { icon: 'Rocket', title: 'Plans that pay for themselves', body: 'Operator or Boss, pick monthly or annual (two months free). Upgrades apply instantly and grant your reveal credits right away.' },
      { icon: 'Gift', title: 'Invite owners, earn R50', body: 'Share your link, when a business you invited subscribes, you earn R50 credit and they start with a welcome bonus.' },
      { icon: 'Pause', title: 'Quiet month? Pause, don\u2019t cancel', body: 'You can pause for up to 30 days from here, your setup, history and credits freeze safely until you\u2019re back.' },
    ],
  },
  reports: {
    title: 'Reports',
    kicker: 'See the patterns',
    auto: false,
    steps: [
      { icon: 'BarChart3', title: 'Your business in charts', body: 'Pipeline velocity, revenue, best-selling services, the reports build themselves from what you already do in the app.' },
      { icon: 'Target', title: 'Use them weekly', body: 'Five minutes every Friday: what moved, what stalled, what to push next week. That habit compounds fast.' },
    ],
  },
  resources: {
    title: 'Resources',
    kicker: 'Learn & level up',
    auto: false,
    steps: [
      { icon: 'BookOpen', title: 'Playbooks for SA small business', body: 'Pricing, quoting, marketing, practical guides written for how business actually works here.' },
      { icon: 'GraduationCap', title: 'Come back when stuck', body: 'Every section also has its own tutorial, tap the Tutorial button anywhere, any time.' },
    ],
  },
}

/** Views whose tutorial auto-opens on first visit (once per browser, per view). */
export const AUTO_TUTORIAL_VIEWS = new Set<ViewKey>(
  (Object.entries(SECTION_TUTORIALS) as [ViewKey, SectionTutorialDef][])
    .filter(([, d]) => d.auto)
    .map(([k]) => k)
)
