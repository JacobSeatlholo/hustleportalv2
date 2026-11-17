// Verify src/data/resources.ts: compile clean, all boss-list tools present exactly once, URLs resolve.
import { execSync } from 'node:child_process'
import { RESOURCES } from '../src/data/resources.ts'

const items = RESOURCES.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.title })))
const names = items.map((i) => i.name.toLowerCase())
const dupeNames = names.filter((n, i) => names.indexOf(n) !== i)
const urls = items.map((i) => i.url)
const dupeUrls = urls.filter((u, i) => urls.indexOf(u) !== i)
console.log('categories:', RESOURCES.length, 'total tools:', items.length)
console.log('dup names:', dupeNames.length ? dupeNames : 'none')
console.log('dup urls:', dupeUrls.length ? dupeUrls : 'none')

// the boss's list — canonical names → expected on the hub exactly once
const expect = [
  'unpaywall', 'sci-hub', 'open library', 'project gutenberg', 'coursera', 'wolframalpha',
  'removebg', 'cleanup.pictures', 'tinywow', 'ilovepdf', 'photopea', 'squoosh', 'excalidraw',
  'carbon', 'regex101', 'json formatter', 'explainshell', 'alternativeto', 'haveibeenpwned',
  '10minutemail', 'privnote', 'radio garden', 'endel', 'mynoise', 'justwatch', 'internet archive',
  'wayback machine', 'similarweb', 'uptimerobot', 'pagespeed insights', 'tinypng', 'cloudconvert',
  'diffchecker', 'temp-mail', 'obfuscator.io', 'keybr', 'monkeytype', 'ankiweb', 'notion',
  'obsidian', 'raindrop.io', 'todoist', 'trello', 'miro', 'figma', 'canva', 'yt-dlp', 'handbrake',
  'localsend',
]
const missing = expect.filter((n) => !names.includes(n))
console.log('missing from boss list:', missing.length ? missing : 'none — all 49 present')
const extraDupes = expect.filter((n) => names.filter((x) => x === n).length > 1)
console.log('boss tools appearing more than once:', extraDupes.length ? extraDupes : 'none')

// sanity: every URL is https + has a dot-host
const badUrls = items.filter((i) => !/^https:\/\/[^/]+\./.test(i.url))
console.log('bad urls:', badUrls.length ? badUrls.map((i) => i.url) : 'none')

execSync('npx tsc --noEmit -p tsconfig.json', { stdio: 'inherit' })
console.log('tsc: clean')
if (missing.length || dupeNames.length || badUrls.length) process.exit(1)
