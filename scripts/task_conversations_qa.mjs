#!/usr/bin/env node
// ============ TASK CONVERSATIONS: PROD MACHINE TEST (Task 215 round 4) ============
// The team discussion the boss asked for, end to end on prod:
//   two QA accounts → team → task → upload → urgent message with copied-in
//   addresses → teammate reply with @mention → attachment in a message →
//   send-for-signing card in the thread → validation negatives → cleanup.
// Emails ride the real engine (best effort) — the assertions are on the data
// the thread stores and serves back.
// Run: node scripts/task_conversations_qa.mjs [baseUrl]
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const { PDFDocument, StandardFonts } = await import('pdf-lib')

let pass = 0, fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${extra ? ` — ${extra}` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`) }
}

const ts = Date.now().toString(36).slice(-6)
const PASS = `ConvQA!${ts}`
const emailA = `qa-conv-a-${ts}@bhqa.co.za`
const emailB = `qa-conv-b-${ts}@bhqa.co.za`

// ---- tiny cookie-jar auth (hp_session is httpOnly, rides Set-Cookie) ----
function jar() {
  let cookie = ''
  return {
    headers() { return cookie ? { Cookie: cookie } : {} },
    async call(url, options = {}) {
      const res = await fetch(`${BASE}${url}`, {
        ...options,
        headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...this.headers(), ...(options.headers || {}) },
      })
      const setCookie = res.headers.get('set-cookie')
      if (setCookie) {
        const m = /hp_session=[^;]+/.exec(setCookie)
        if (m) cookie = m[0]
      }
      const json = await res.json().catch(() => null)
      return { res, json }
    },
  }
}

async function register(email, name) {
  const j = jar()
  const { res } = await j.call('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'register', email, password: PASS, name, businessName: 'QA Conversations', industry: 'QA', city: 'Johannesburg' }),
  })
  if (!res.ok) {
    // register auto-logins; if it did not, log in explicitly
    const { res: lres } = await j.call('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'login', email, password: PASS }) })
    if (!lres.ok) throw new Error(`could not register/login ${email}: ${res.status}`)
  }
  return j
}

// 1. Two teammates.
const A = await register(emailA, 'QA Conv A')
const B = await register(emailB, 'QA Conv B')
check('two QA teammates registered and logged in', true)

// 2. A team, B invited onto it.
const { json: teamJ } = await A.call('/api/teams', { method: 'POST', body: JSON.stringify({ name: `QA Conv Team ${ts}` }) })
const teamId = teamJ?.team?.id
check('team created by A', !!teamId)
const { res: invRes } = await A.call('/api/teams', { method: 'POST', body: JSON.stringify({ action: 'invite', teamId, email: emailB }) })
check('B invited onto the team', invRes.ok, `status ${invRes.status}`)

// 3. The task the conversation lives on.
const { json: taskJ } = await A.call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: `QA conversation ${ts}`, teamId }) })
const taskId = taskJ?.task?.id || taskJ?.id
check('task created on the team', !!taskId)

// 4. B can read the conversation (visibility rule: team member).
const { res: visRes, json: visJ } = await B.call(`/api/tasks/${taskId}/comments`)
check('B sees the conversation on the team task', visRes.ok && Array.isArray(visJ?.comments), `status ${visRes.status}`)

// 5. A uploads the terms document to the task.
const scratch = await PDFDocument.create()
const font = await scratch.embedFont(StandardFonts.Helvetica)
scratch.addPage([595.28, 841.89]).drawText(`Conversation QA payload ${ts}`, { x: 57, y: 780, size: 12, font })
const pdfBytes = Buffer.from(await scratch.save())
const fd = new FormData()
fd.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), `QA_Terms_${ts}.pdf`)
fd.append('taskId', taskId)
const upRes = await fetch(`${BASE}/api/docs`, { method: 'POST', body: fd, headers: A.headers() })
const upJ = await upRes.json().catch(() => null)
const docId = upJ?.doc?.id
check('document uploaded to the task', upRes.ok && !!docId, upRes.ok ? `${(pdfBytes.length / 1024).toFixed(1)} KB` : JSON.stringify(upJ))

// 6. The URGENT message with copied-in addresses.
const copiedList = `watcher-${ts}@example.com, second-${ts}@example.com`
const { res: urgRes, json: urgJ } = await A.call(`/api/tasks/${taskId}/comments`, {
  method: 'POST',
  body: JSON.stringify({ body: 'URGENT: the deal terms changed, everyone review today.', urgent: true, copiedEmails: copiedList }),
})
check('urgent message sent with copied-in addresses', urgRes.ok && urgJ?.comment?.urgent === true && (urgJ?.comment?.copiedEmails || '').includes(`watcher-${ts}@example.com`), urgRes.ok ? '' : JSON.stringify(urgJ))

// 7. B replies and tags A (the mention mails A).
const { res: repRes, json: repJ } = await B.call(`/api/tasks/${taskId}/comments`, {
  method: 'POST',
  body: JSON.stringify({ body: `On it — @${emailA} reviewing the terms now.` }),
})
check('teammate reply lands in the thread', repRes.ok && !!repJ?.comment?.id, repRes.ok ? '' : JSON.stringify(repJ))

// 8. A posts the document as an attachment.
const { res: attRes, json: attJ } = await A.call(`/api/tasks/${taskId}/comments`, {
  method: 'POST',
  body: JSON.stringify({ body: 'The revised terms are attached.', docIds: [docId] }),
})
check('message carries the attachment', attRes.ok && attJ?.comment?.docs?.[0]?.id === docId, attRes.ok ? attJ.comment.docs[0].filename : JSON.stringify(attJ))

// 9. Send the document for signature from the conversation → live signing card.
const { json: esJ } = await A.call(`/api/docs/${docId}/esign`, {
  method: 'POST',
  body: JSON.stringify({ signerName: `QA Signer ${ts}`, signerEmail: `qa-sign-${ts}@bhqa.co.za` }),
})
check('esign session created from the task document', !!esJ?.session?.id)
const { res: cardRes, json: cardJ } = await A.call(`/api/tasks/${taskId}/comments`, {
  method: 'POST',
  body: JSON.stringify({ body: `Sent "${esJ.session.docTitle}" for signature to ${esJ.session.signerName}.`, sessionId: esJ.session.id }),
})
check('signing card posted into the conversation', cardRes.ok && cardJ?.comment?.session?.token === esJ.session.token, cardRes.ok ? `status ${cardJ.comment.session.status}` : JSON.stringify(cardJ))
const { json: afterJ } = await A.call(`/api/tasks/${taskId}/comments`)
const cardMsg = (afterJ?.comments || []).find((c) => c.session)
check('signing card serves token + status + signer', !!cardMsg?.session?.token && cardMsg.session.status === 'SENT' && cardMsg.session.signerEmail === `qa-sign-${ts}@bhqa.co.za`)
check('signing page reachable from the card token', (await fetch(`${BASE}/sign/${cardMsg.session.token}`)).ok)

// 10. Validation negatives.
const bad1 = await A.call(`/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body: 'x', docIds: ['bogus-doc-id'] }) })
check('foreign/bogus attachment rejected', bad1.res.status === 400, `status ${bad1.res.status}`)
const bad2 = await A.call(`/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body: 'x', sessionId: 'bogus-session-id' }) })
check('bogus signing session rejected', bad2.res.status === 400, `status ${bad2.res.status}`)
const bad3 = await A.call(`/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body: 'x', urgent: true, copiedEmails: 'not-an-email' }) })
check('malformed copied address rejected', bad3.res.status === 400, `status ${bad3.res.status}`)
const bad4 = await A.call(`/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body: 'x', urgent: true, copiedEmails: Array.from({ length: 11 }, (_, i) => `w${i}-${ts}@example.com`).join(', ') }) })
check('more than 10 copied addresses rejected', bad4.res.status === 400, `status ${bad4.res.status}`)
const { res: privRes, json: privJ2 } = await A.call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: `QA private ${ts}`, isPrivate: true }) })
const privId = privJ2?.task?.id || privJ2?.id
const { res: sneaky } = await B.call(`/api/tasks/${privId}/comments`)
check('personal task stays private to outsiders', sneaky.status === 403, `status ${sneaky.status}`)

// 11. Cleanup: the task row cascades the thread, attachments live on the task.
const { res: delRes } = await A.call(`/api/tasks/${taskId}`, { method: 'DELETE' })
check('QA task removed (thread cascades with it)', delRes.ok || delRes.status === 200, `status ${delRes.status}`)

console.log(`\n==== CONVERSATIONS: ${pass} PASS / ${fail} FAIL ====`)
process.exit(fail === 0 ? 0 : 1)
