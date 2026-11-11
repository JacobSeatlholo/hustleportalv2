// Standard character set — blank-shirt variants of the BH mascot occasions.
// SDK path: local file → base64 data URL → images.generations.edit.
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const SRC = '/home/z/my-project/public/email'
const OUT = '/home/z/my-project/scripts/std_mascots_out'
fs.mkdirSync(OUT, { recursive: true })

const PROMPT = "Remove the letters 'BH' from the cartoon honey badger character's clothing and from any object it holds (vest, hoodie, badge, coin, shirt). The fabric and metal become plain and unprinted, same underlying color, no letters, no monogram, no logo anywhere. Keep the character's pose, face, colors, background and flat cartoon style exactly identical to the input image. Do not add any new text."

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['calendar', 'phone', 'video', 'thumbs', 'coins', 'search', 'lock']

const zai = await ZAI.create()
let ok = 0, failed = 0
for (const id of ids) {
  const out = `${OUT}/${id}.png`
  if (fs.existsSync(out) && fs.statSync(out).size > 10000) { console.log(`skip ${id}`); ok++; continue }
  try {
    const b64 = fs.readFileSync(`${SRC}/mascot-${id}.jpg`).toString('base64')
    const res = await zai.images.generations.edit({
      prompt: PROMPT,
      images: [{ url: `data:image/jpeg;base64,${b64}` }],
      size: '1344x768',
    })
    const data = res?.data?.[0]?.base64
    if (!data) throw new Error('empty response')
    fs.writeFileSync(out, Buffer.from(data, 'base64'))
    console.log(`OK ${id} (${Math.round(fs.statSync(out).size / 1024)} KB)`)
    ok++
  } catch (e) {
    console.log(`FAILED ${id}: ${e.message?.slice(0, 160)}`)
    failed++
  }
}
console.log(`done: ${ok} ok, ${failed} failed`)
