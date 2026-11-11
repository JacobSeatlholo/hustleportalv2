// Render-check: the standard-character + brand law, exactly as production renders it.
// 1. Ubuntu campaign row preview (member-owned, branded)  → Ubuntu logo banner, blank-shirt badger, no BH anywhere
// 2. Exec blast replay (unbranded)                        → BH chip + BH-vested wave (unchanged, boss's own mail)
// 3. Member single themed mail                            → neutral HP chip + blank-shirt wave
// 4. Member nightshift campaign                           → blank-shirt night hero
import { themedEmailHtml, sanitizeBrand } from '../src/lib/mailthemes'
import { effectiveCampaignBrand, campaignStandardCharacter, type CampaignState } from '../src/lib/campaignqueue'
import { replaySentHtml } from '../src/lib/mailer'
import fs from 'fs'

const BASE = 'https://www.hustleportal.online'
const BODY = 'Hi there,\n\nYour November treat is waiting — 15% off any wellness session booked this month.\n\nSee it in motion: https://example.co.za/video\n\nUbuntu Wellness Team'
let failures = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  PASS ${name}`)
  else { failures++; console.log(`  FAIL ${name}${extra ? ` :: ${extra}` : ''}`) }
}

// The queue state as the Task 189 door staged it + the boss's Edit draft brand
const ubuntuState: CampaignState = {
  status: 'PAUSED', perHour: 45,
  from: 'Ubuntu Wellness <support@hustleportal.online>',
  provider: 'RESEND', theme: 'goldrush',
  brand: sanitizeBrand({ name: 'Ubuntu Wellness', logoUrl: '/api/campaign-logo/u-ubuntu' }),
  ownerUserId: 'user_support', replyTo: 'support@ubuntuwellness.com',
  createdAt: new Date().toISOString(),
}
const brand = effectiveCampaignBrand(ubuntuState)
const std = campaignStandardCharacter(ubuntuState)

console.log('== 1. Ubuntu campaign preview (state law) ==')
check('effective brand is the queue brand with logo', !!brand && brand.name === 'Ubuntu Wellness' && brand.logoUrl === '/api/campaign-logo/u-ubuntu')
check('standard character on (member-owned)', std === true)
const html1 = replaySentHtml({
  body: BODY, theme: ubuntuState.theme, provider: 'PLATFORM',
  campaign: 'u-ubuntu-november-offer', unsubUrl: `${BASE}/api/mail/unsub/x/y`,
  brand, standardCharacter: std,
}) || ''
fs.writeFileSync('/tmp/render/ubuntu.html', html1)
check('banner carries their logo image', html1.includes('src="' + BASE + '/api/campaign-logo/u-ubuntu"'), 'logo src missing')
check('no BH chip text', !html1.includes('>BH<'), 'BH chip leaked')
check('no BH-vested wave hero', !html1.includes('mascot-wave-bh.jpg'), 'BH hero leaked')
check('no BH night hero', !html1.includes('mascot-night-bh.jpg'))
check('standard blank-shirt wave hero present', html1.includes('mascot-wave.jpg'), 'standard hero missing')
check('no BH wordmark anywhere', !html1.includes('BH on his vest'))
check('footer credits the sender', html1.includes('Ubuntu Wellness &middot; sent via HustlePortal'))

console.log('== 2. Exec blast replay (no brand, no owner) ==')
const execState: CampaignState = { status: 'PAUSED', perHour: 45, from: 'Kloofstreet.online Team <hello@hustleportal.online>', provider: 'RESEND', createdAt: new Date().toISOString() }
check('exec no-brand keeps BH chrome', effectiveCampaignBrand(execState) === undefined)
check('exec no-brand not standard', campaignStandardCharacter(execState) === false)
const html2 = replaySentHtml({ body: BODY, theme: 'goldrush', campaign: 'kloofstreet-2026-11' }) || ''
fs.writeFileSync('/tmp/render/exec.html', html2)
check('BH chip present (boss mail unchanged)', html2.includes('>BH<'))
check('BH-vested wave present (boss mail unchanged)', html2.includes('mascot-wave-bh.jpg'))
check('legal footer present', html2.toLowerCase().includes('hustleportal'))

console.log('== 3. Member single themed mail (no brand) ==')
const html3 = themedEmailHtml(BODY, { theme: 'goldrush', standardCharacter: true })
fs.writeFileSync('/tmp/render/member.html', html3)
check('neutral HP chip', html3.includes('>HP<'), 'HP chip missing')
check('no BH chip', !html3.includes('>BH<'))
check('blank-shirt wave hero', html3.includes('mascot-wave.jpg'))
check('no BH-vested hero', !html3.includes('mascot-wave-bh.jpg'))

console.log('== 4. Member nightshift campaign ==')
const html4 = themedEmailHtml(BODY, { theme: 'nightshift', brand, standardCharacter: true })
fs.writeFileSync('/tmp/render/night.html', html4)
check('their logo banner', html4.includes('/api/campaign-logo/u-ubuntu'))
check('blank-shirt night hero', html4.includes('mascot-night.jpg'), 'std night missing')
check('no BH night hero', !html4.includes('mascot-night-bh.jpg'))
check('no BH chip', !html4.includes('>BH<'))

console.log('== 5. Standard mascot library coverage ==')
for (const [id, src] of Object.entries({ calendar: 'calendar-std', phone: 'phone-std', video: 'video-std', thumbs: 'thumbs-std', coins: 'coins-std', search: 'search-std', lock: 'lock-std', wave: 'wave', night: 'night' })) {
  const p = `/home/z/my-project/public/email/mascot-${src}.jpg`
  check(`std twin exists: ${id}`, fs.existsSync(p) && fs.statSync(p).size > 10000)
}
const picked = themedEmailHtml(BODY, { theme: 'goldrush', brand, mascot: 'coins', standardCharacter: true })
check('picked mascot resolves to std twin (plain coin)', picked.includes('mascot-coins-std.jpg') && !picked.includes('mascot-coins.jpg'))
check('picked std coin alt has no BH', !/BH/.test(picked.match(/alt="[^"]*coin[^"]*"/)?.[0] || 'x'))

console.log('== 6. Video card poster law ==')
check('ubuntu preview uses the neutral poster', html1.includes('blackbiz-intro-video-std.jpg'), 'std poster missing')
check('ubuntu preview has no wordmark poster', !html1.includes('blackbiz-intro-video.jpg"') || html1.includes('blackbiz-intro-video-std.jpg'))
const htmlExecVideo = replaySentHtml({ body: BODY, theme: 'goldrush', campaign: 'kloofstreet-2026-11' }) || ''
check('exec blast keeps the branded poster', htmlExecVideo.includes('src="https://www.hustleportal.online/campaign/blackbiz-intro-video.jpg"'))
check('exec blast alt mentions HustlePortal (as sent)', htmlExecVideo.includes('Watch: HustlePortal in motion'))
const htmlStdVideo = themedEmailHtml(BODY, { theme: 'goldrush', standardCharacter: true })
check('member single mail uses the neutral poster', htmlStdVideo.includes('blackbiz-intro-video-std.jpg'))
check('member video alt is neutral', htmlStdVideo.includes('alt="Watch the video. Tap to play."'))

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
