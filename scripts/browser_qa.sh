#!/usr/bin/env bash
# Browser QA for inbound capture + task-from-meeting. Boots the local dev
# server, logs in, dismisses onboarding, drives both flows with agent-browser.
# Payloads are IIFE-wrapped (each eval gets a fresh scope) and results are
# read back from a file — no nested command substitution. Run: bash scripts/browser_qa.sh
set -u
cd /home/z/my-project
pkill -f "next dev" 2>/dev/null; sleep 1
DATABASE_URL="postgresql://postgres@127.0.0.1:54329/hustleportal" SES_INBOUND_SECRET="local-test-secret" SES_INBOUND_SKIP_SIG=1 nohup bun run dev >/dev/null 2>&1 &
for i in $(seq 1 45); do curl -s -m 3 -o /dev/null http://localhost:3000/api/health 2>/dev/null && break; sleep 1; done
echo "health: $(curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/api/health)"

TOKEN=$(curl -s -D - -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' -d '{"action":"login","email":"ceo@businesshustle.co.za","password":"hustle123"}' | grep -io 'set-cookie: hp_session=[^;]*' | head -1 | sed 's/.*hp_session=//')
echo "token chars: ${#TOKEN}"

ev() { agent-browser eval "$1" > /tmp/ev.txt 2>&1; cat /tmp/ev.txt; }

agent-browser open http://localhost:3000 >/dev/null 2>&1
agent-browser cookies set hp_session "$TOKEN" >/dev/null 2>&1
agent-browser open "http://localhost:3000/?view=mail" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2

# dismiss onboarding overlays (persona dialog + tour tooltips + tour bar)
for i in 1 2 3 4 5 6; do
  ev "(()=>{for (const t of ['Got it, close','Maybe later','Skip for now','Skip','Skip tour','Show me around']){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===t);if(b){b.click();break}}return 'ok'})()" >/dev/null
  sleep 0.5
done
echo "tour gone: $(ev "(()=>{return !document.body.textContent.includes('Skip tour')?'yes':'no'})()" | tail -1)"

# ---- flow 1: Log an external email ----
echo "open dialog: $(ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Log external'));if(b){b.click();return 'clicked'}return 'missing'})()" | tail -1)"
sleep 0.8
echo "dialog open: $(ev "(()=>{return !!document.getElementById('le-to')?'yes':'no'})()" | tail -1)"
ev "(()=>{const si=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;const el=document.getElementById('le-to');si.call(el,'procurement@bongofinance.co.za');el.dispatchEvent(new Event('input',{bubbles:true}));return 'to='+el.value})()" >/dev/null
ev "(()=>{const si=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;const el=document.getElementById('le-subject');si.call(el,'Strategic partnership - Bongo Credit x Business Hustle');el.dispatchEvent(new Event('input',{bubbles:true}));return 'subj='+el.value})()" >/dev/null
ev "(()=>{const st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;const el=document.getElementById('le-body');si2=el;st.call(el,'Good day. I noticed Bongo Credit is actively scaling its Cape Town footprint. 15-minute coffee next week?');el.dispatchEvent(new Event('input',{bubbles:true}));return 'body='+el.value.slice(0,25)})()" >/dev/null
echo "fill stuck: $(ev "(()=>{return document.getElementById('le-to').value+' | '+document.getElementById('le-subject').value.slice(0,20)})()" | tail -1)"
ev "(()=>{if(window.__qaPatched)return 'already';window.__qaPatched=true;window.__qa={s:null};const of=window.fetch;window.fetch=(u,o)=>of(u,o).then(r=>{if(String(u).includes('log-external'))window.__qa.s=r.status;return r});return 'patched'})()" >/dev/null
echo "submit enabled: $(ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Add to my log'));return b&&!b.disabled?'yes':'no'})()" | tail -1)"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Add to my log'));if(b){b.click();return 'clicked'}return 'missing'})()" >/dev/null
agent-browser wait 2500 >/dev/null 2>&1
echo "log-external HTTP: $(ev "(()=>{return String(window.__qa&&window.__qa.s)})()" | tail -1)"
echo "toast success: $(ev "(()=>{return document.body.textContent.includes('Email logged')?'yes':'no'})()" | tail -1)"
echo "toast error: $(ev "(()=>{return document.body.textContent.includes('Could not log')?'yes':'no'})()" | tail -1)"
echo "dialog closed: $(ev "(()=>{return !document.getElementById('le-to')?'yes':'no'})()" | tail -1)"
echo "LOGGED badge: $(ev "(()=>{return document.body.textContent.includes('LOGGED')?'yes':'no'})()" | tail -1)"
echo "unmatched card: $(ev "(()=>{return document.body.textContent.includes('Unmatched CC mail')?'yes':'no'})()" | tail -1)"
echo "alias section: $(ev "(()=>{return document.body.textContent.includes('Connected sending addresses')?'yes':'no'})()" | tail -1)"
agent-browser screenshot /tmp/qa-mail.png >/dev/null 2>&1
echo "mail screenshot saved"

# ---- flow 2: Task chip on a calendar meeting ----
agent-browser open "http://localhost:3000/?view=calendar" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
echo "meeting visible: $(ev "(()=>{return document.body.textContent.includes('Coffee - Bongo Credit')?'yes':'no'})()" | tail -1)"
echo "task chip: $(ev "(()=>{return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Task')?'yes':'no'})()" | tail -1)"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Task');if(b){b.click();return 'chip'}return 'missing'})()" >/dev/null
sleep 0.8
echo "task dialog open: $(ev "(()=>{return !!document.getElementById('mt-title')?'yes':'no'})()" | tail -1)"
echo "prefill title: $(ev "(()=>{return document.getElementById('mt-title')?.value||'?'})()" | tail -1)"
echo "prefill date: $(ev "(()=>{return document.getElementById('mt-date')?.value||'?'})()" | tail -1)"
echo "prefill time: $(ev "(()=>{return document.getElementById('mt-time')?.value||'?'})()" | tail -1)"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Add task');if(b){b.click();return 'saving'}return 'missing'})()" >/dev/null
agent-browser wait --text "Task added" 2>&1 | tail -1
sleep 1
agent-browser screenshot /tmp/qa-cal.png >/dev/null 2>&1
echo "calendar screenshot saved"

# ---- flow 3: the task lands in Tasks ----
agent-browser open "http://localhost:3000/?view=tasks" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
echo "task in Tasks view: $(ev "(()=>{return document.body.textContent.includes('Follow up: Coffee - Bongo Credit')?'yes':'no'})()" | tail -1)"
agent-browser screenshot /tmp/qa-tasks.png >/dev/null 2>&1

echo "--- page errors ---"
agent-browser errors 2>&1 | tail -5
agent-browser close >/dev/null 2>&1
pkill -f "next dev" 2>/dev/null
echo "== browser QA done =="
