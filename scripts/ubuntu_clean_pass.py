#!/usr/bin/env python3
"""Ubuntu remaining pool: rebuild + FREE hygiene pass (syntax / domain liveness / typo flags).
Read-only vs prod inputs (/tmp jsons pulled by node). Outputs download/ubuntu_remaining_pool.csv.
No mail, no writes to prod, no paid calls."""
import json
import csv
import re
import socket
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from datetime import datetime

import openpyxl

SRC = 'upload/export_customer_list_2026-11-10.xlsx'
OUT = 'download/ubuntu_remaining_pool.csv'
VERIFY_USD = 0.00178          # millionverifier via treg (src/lib/tregverify.ts)
TREG_BALANCE = 7.4891         # prod balance at pull time (GET /api/admin/exec/pool/verify)

exec_rows = json.load(open('/tmp/exec_campaign_rows.json'))['rows']
uw = [r for r in exec_rows if 'ubuntu' in str(r.get('campaign', ''))]
mailed = set(str(r['toEmail']).lower() for r in uw)
bounced = set(str(r['toEmail']).lower() for r in uw if str(r.get('status')).upper() == 'BOUNCED')
opened = set(str(r['toEmail']).lower() for r in uw if r.get('openedAt'))
print(f'prod ledger: ubuntu rows={len(uw)} mailed={len(mailed)} bounced={len(bounced)} opened={len(opened)}')

wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
ws = wb['Client List Report']
rows = list(ws.iter_rows(values_only=True))
header = [str(c).strip() if c is not None else '' for c in rows[0]]
ix = {h: i for i, h in enumerate(header)}

def cell(r, col):
    v = r[ix[col]] if ix.get(col) is not None and ix[col] < len(r) else None
    return str(v).strip() if v is not None else ''

pool = {}      # email -> newest added date (consented, unique)
mkt_no = set()
for r in rows[1:]:
    em = cell(r, 'Email').lower()
    if not ('@' in em and '.' in em.split('@')[-1]):
        continue
    if cell(r, 'Blocked').lower() == 'yes':
        continue
    if cell(r, 'Accepts Marketing').lower() not in ('yes', 'true', '1'):
        mkt_no.add(em)
        continue
    a = cell(r, 'Added')[:10]
    if em not in pool or a > pool[em]:
        pool[em] = a
wb.close()

remaining = {e: a for e, a in pool.items() if e not in mailed}
print(f'consented pool={len(pool)}  wave1 mailed(in pool)={len(mailed & set(pool))}  REMAINING={len(remaining)}')

# --- layer 1: syntax ---
SYNTAX = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$')
def dom(e): return e.split('@', 1)[1]
bad_syntax = {e for e in remaining if not SYNTAX.match(e)}
print(f'syntax-invalid: {len(bad_syntax)}  e.g. {sorted(bad_syntax)[:5]}')

# --- layer 2: domain liveness (DNS) ---
doms = Counter(dom(e) for e in remaining if e not in bad_syntax)
print(f'unique live-check domains: {len(doms)}')
socket.setdefaulttimeout(4)
def alive(d):
    try:
        socket.getaddrinfo(d, None)
        return d, True
    except Exception:
        return d, False
with ThreadPoolExecutor(max_workers=48) as ex:
    res = dict(ex.map(alive, doms))
dead = {d for d, ok in res.items() if not ok}
print(f'dead domains (no DNS): {len(dead)}  -> {sorted(dead)[:10]}')

# --- layer 3: typo suggestions against common providers ---
KNOWN = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'webmail.co.za', 'icloud.com',
         'gmail.co.za', 'yahoo.co.za', 'live.co.za', 'mweb.co.za', 'telkomsa.net']
def ed(a, b):
    if abs(len(a) - len(b)) > 3: return 9
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]
suspicious = {}
for e in remaining:
    if e in bad_syntax: continue
    d = dom(e)
    if res.get(d): continue          # live domain: not a typo case
    best = min(KNOWN, key=lambda k: ed(d, k))
    if ed(d, best) <= 2:
        suspicious[e] = f'{d} -> {best}'
print(f'recoverable typo candidates: {len(suspicious)}  e.g. {list(suspicious.items())[:5]}')

sendable = {e: a for e, a in remaining.items() if e not in bad_syntax and res.get(dom(e))}
verifiable = {e: a for e, a in sendable.items() if not dom(e) in dead}
cost_all = len(sendable) * VERIFY_USD
print(f'\nFUNNEL: remaining={len(remaining)}  syntax-bad={len(bad_syntax)}  dead-domain={len(set(dom(e) for e in remaining) & dead & set(dom(e) for e in remaining if e not in bad_syntax))}  SENDABLE-NOW(free pass)={len(sendable)}')
print(f'treg verify cost on sendable: {len(sendable)} x ${VERIFY_USD} = ${cost_all:.2f}  (balance ${TREG_BALANCE:.4f} covers {int(TREG_BALANCE/VERIFY_USD)})')

added = Counter(a[:7] for a in sendable.values())
print('sendable by month added (top 8):', dict(sorted(added.items(), key=lambda x: -x[1])[:8]))

import os
os.makedirs('download', exist_ok=True)
with open(OUT, 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['email', 'added', 'syntax_ok', 'domain_live', 'typo_fix', 'status'])
    for e, a in sorted(remaining.items(), key=lambda x: x[1], reverse=True):
        live = res.get(dom(e), False) if e not in bad_syntax else False
        st = 'SENDABLE_PENDING_VERIFY' if (e not in bad_syntax and live) else ('TYPO_RECOVER' if e in suspicious else ('SYNTAX_BAD' if e in bad_syntax else 'DEAD_DOMAIN'))
        w.writerow([e, a, 'no' if e in bad_syntax else 'yes', 'yes' if live else 'no', suspicious.get(e, ''), st])
print('wrote', OUT, f'({len(remaining)} rows)')

# wave-1 benchmark for the plan
print(f'\nWave 1 benchmark: bounce {len(bounced)}/522={len(bounced)/522*100:.1f}%  open {len(opened)}/464={len(opened)/464*100:.1f}%')
