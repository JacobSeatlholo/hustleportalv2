#!/usr/bin/env python3
"""Final pool math: who is left on the Fresha book after Wave 1.
Segment law = email present + not blocked + Accepts Marketing = Yes, deduped.
Wave 1 took the top of the sheet (Added desc) = newest 522. Read-only."""
import json
import openpyxl
from collections import Counter

SRC = 'upload/export_customer_list_2026-11-10.xlsx'
BOUNCED = set(json.load(open('/tmp/uw_bounced.json')))

wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
ws = wb['Client List Report']
rows = list(ws.iter_rows(values_only=True))
header = [str(c).strip() if c is not None else '' for c in rows[0]]
ix = {h: i for i, h in enumerate(header)}

def cell(r, col):
    v = r[ix[col]] if ix.get(col) is not None and ix[col] < len(r) else None
    return str(v).strip() if v is not None else ''

seen = set()
pool = []            # consented, never mailed, deliverable-looking
mkt_no = set()       # consent refused - untouchable by law
no_email = 0
mobile_no_email = 0
wave1_order = []     # walk order, first 522 with email = what Wave 1 took

for r in rows[1:]:
    em = cell(r, 'Email').lower()
    am = cell(r, 'Accepts Marketing')
    blk = cell(r, 'Blocked')
    added = cell(r, 'Added')[:10]
    mob = cell(r, 'Mobile Number')
    has_mail = '@' in em and '.' in em.split('@')[-1]
    if not has_mail:
        no_email += 1
        if mob:
            mobile_no_email += 1
        continue
    wave1_order.append((em, added))
    if blk.lower() == 'yes':
        continue
    if am.lower() not in ('yes', 'true', '1'):
        mkt_no.add(em)
        continue
    if em in seen:
        continue
    seen.add(em)
    pool.append((em, added))

# Wave 1 = first 522 unique consented addresses in walk order (proven vs prod ledger)
wave1 = [e for e, _ in wave1_order[:522]]
wave1_set = set(wave1)
print('Wave 1 replay (first 522 unique consented in sheet order):',
      len(wave1_set), 'unique — prod ledger says 522 queued')
overlap = wave1_set & BOUNCED
print('Wave 1 bounces among them:', len(overlap), '(prod: 57)')

rest = [(e, a) for e, a in pool if e not in wave1_set]
print()
print(f'=== THE POOL ===')
print(f'unique consented emails on book      : {len(pool)}')
print(f'Wave 1 used                          : {len(wave1_set)}')
print(f'remaining consented, never mailed    : {len(rest)}')
print(f'  of which bounce-typos from Wave 1  : n/a (bounces were inside Wave 1)')
print(f'  marketing NO (untouchable)         : {len(mkt_no)} unique')
print(f'  rows with no email at all          : {no_email} (mobile present on {mobile_no_email})')

# added-date split of the remaining pool
dec_bulk = [(e, a) for e, a in rest if a.startswith('2023-12')]
organic = [(e, a) for e, a in rest if not a.startswith('2023-12')]
print(f'remaining pool: Dec-2023 bulk import : {len(dec_bulk)}')
print(f'remaining pool: organic (2017-2026)  : {len(organic)}')
org_recent = [(e, a) for e, a in organic if a >= '2024-01-01']
print(f'  organic added 2024 or later        : {len(org_recent)}')

# a "next 1,000" warm-up slice = the next newest thousand after Wave 1's tail
nxt = [e for e, a in pool if e not in wave1_set][:1000]
nxt_recent = sum(1 for e, a in rest[:1000] if a >= '2023-12-01')
print()
print('next-1000 slice by sheet order (newest first):')
tail_added = Counter(a[:7] for _, a in rest[:1000])
print('  added months:', dict(sorted(tail_added.items(), reverse=True)[:6]))

# sanity: any pool email in the Wave 1 bounce list? (should be 0, bounces were sent mail)
print()
print('pool ∩ wave1 bounce addresses:', len(set(e for e, _ in pool) & BOUNCED))
wb.close()
