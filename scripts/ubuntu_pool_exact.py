#!/usr/bin/env python3
"""Exact remaining-pool math: consented pool minus the REAL prod Wave 1 ledger."""
import json
import openpyxl
from collections import Counter

SRC = 'upload/export_customer_list_2026-11-10.xlsx'
exec_rows = json.load(open('/tmp/exec_campaign_rows.json'))['rows']
uw = [r for r in exec_rows if str(r.get('campaign', '')).includes('ubuntu')] if False else [r for r in exec_rows if 'ubuntu' in str(r.get('campaign', ''))]
mailed = set(r['toEmail'].lower() for r in uw)
bounced = set(r['toEmail'].lower() for r in uw if str(r.get('status')).upper() == 'BOUNCED')
opened = set(r['toEmail'].lower() for r in uw if r.get('openedAt'))
print(f'prod ledger: mailed={len(mailed)} bounced={len(bounced)} opened={len(opened)}')

wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
ws = wb['Client List Report']
rows = list(ws.iter_rows(values_only=True))
header = [str(c).strip() if c is not None else '' for c in rows[0]]
ix = {h: i for i, h in enumerate(header)}

def cell(r, col):
    v = r[ix[col]] if ix.get(col) is not None and ix[col] < len(r) else None
    return str(v).strip() if v is not None else ''

pool = {}   # email -> newest added date
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

mailed_in_pool = mailed & set(pool)
print(f'\nunique consented pool          : {len(pool)}')
print(f'prod Wave 1 mailed             : {len(mailed)}')
print(f'  of them in consented pool    : {len(mailed_in_pool)}')
print(f'  mailed but NOT in pool       : {len(mailed - set(pool))} -> {sorted(mailed - set(pool))[:6]}')
remaining = {e: a for e, a in pool.items() if e not in mailed}
print(f'REMAINING consented, never mailed: {len(remaining)}')

split = Counter('Dec-2023 bulk' if a.startswith('2023-12') else ('2024+' if a >= '2024' else 'older organic') for a in remaining.values())
print('  split:', dict(split))
# bounce share of Wave 1 = deliverability warning for the bulk block
print(f'\nWave 1 bounce rate on its 522  : {len(bounced)}/522 = {len(bounced)/522*100:.1f}%')
wb.close()
