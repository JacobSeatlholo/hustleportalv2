#!/usr/bin/env python3
"""Wave 1 segment law replay: how many emails does the Fresha export legally hold
vs the 522 that went out? Segment law per the Task 189 door: real clients (not
blocked), Accepts Marketing = Yes, email present, deduped. Read-only."""
import openpyxl
from collections import Counter

SRC = 'upload/export_customer_list_2026-11-10.xlsx'
wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
ws = wb['Client List Report']
rows = list(ws.iter_rows(values_only=True))
header = [str(c).strip() if c is not None else '' for c in rows[0]]
ix = {h: i for i, h in enumerate(header)}
data = rows[1:]

def cell(r, col):
    v = r[ix[col]] if ix.get(col) is not None and ix[col] < len(r) else None
    return str(v).strip() if v is not None else ''

total = len(data)
blocked = Counter()
mkt = Counter()
pool = []          # email present, not blocked, accepts marketing
pool_any_mkt = []  # email present, not blocked, marketing NO
novo_email = 0
blocked_with_email = 0
mkt_yes_novo = 0

for r in data:
    em = cell(r, 'Email').lower()
    blk = cell(r, 'Blocked')
    reason = cell(r, 'Block Reason')
    am = cell(r, 'Accepts Marketing')
    blocked[(blk, reason if blk.lower() == 'yes' else '')] += 1
    mkt[am] += 1
    has_mail = '@' in em and '.' in em.split('@')[-1]
    if blk.lower() == 'yes' and has_mail:
        blocked_with_email += 1
    if not has_mail:
        novo_email += 1
        continue
    if blk.lower() == 'yes':
        continue
    if am.lower() in ('yes', 'true', '1'):
        pool.append(em)
        if am.lower() == 'yes':
            mkt_yes_novo += 0  # placeholder, counts below
    else:
        pool_any_mkt.append(em)

up = Counter(pool)
uniq_pool = list(up.keys())
print(f'total rows                    : {total}')
print(f'email present                 : {total - novo_email}')
print(f'no email                      : {novo_email}')
print(f'blocked (with email)          : {blocked_with_email}')
print()
print('Accepts Marketing values      :', dict(mkt))
print('Blocked values                :', dict((k[0], v) for k, v in blocked.items()))
print('block reasons                 :', dict((k[1], v) for k, v in blocked.items() if k[1]))
print()
print(f'POOL law (not blocked, marketing YES, email): rows={len(pool)} unique={len(uniq_pool)}')
print(f'  marketing NO but not blocked (email ok)   : rows={len(pool_any_mkt)} unique={len(set(pool_any_mkt))}')

# dupes inside pool
d = {k: v for k, v in up.items() if v > 1}
print(f'pool duplicate addresses      : {len(d)}')

# added-date spread of the pool vs the rest
from datetime import datetime
added_pool, added_all = [], []
for r in data:
    em = cell(r, 'Email').lower()
    am = cell(r, 'Accepts Marketing')
    blk = cell(r, 'Blocked')
    a = cell(r, 'Added')[:10]
    if a:
        added_all.append(a)
        if em and blk.lower() != 'yes' and am.lower() == 'yes':
            added_pool.append(a)
def spread(dates, label):
    dates = sorted(dates)
    if not dates:
        return
    per_month = Counter(x[:7] for x in dates)
    print(label, dates[0], '->', dates[-1], dict(sorted(per_month.items())))
print()
spread(added_pool, 'pool added spread  :')
spread(added_all,  'all   added spread :')
wb.close()
