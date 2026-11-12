#!/usr/bin/env python3
"""Audit the Fresha customer export (upload/export_customer_list_2026-11-10.xlsx)
against the Wave 1 send (522 imported, 464 sent / 57 bounced / 1 skipped / 194 opened).
Read-only on the upload. Prints: structure, email coverage, duplicates, junk.
"""
import openpyxl
from collections import Counter

SRC = 'upload/export_customer_list_2026-11-10.xlsx'

wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
print('sheets:', wb.sheetnames)

for ws in wb.worksheets:
    rows = list(ws.iter_rows(values_only=True))
    print(f'\n=== sheet {ws.title!r}: {len(rows)} rows (incl header) ===')
    header = [str(c).strip() if c is not None else '' for c in rows[0]]
    print('header:', header)
    for r in rows[1:4]:
        print('sample:', [str(c)[:30] if c is not None else '' for c in r])

    # find the email column
    em_idx = None
    for i, h in enumerate(header):
        if 'mail' in h.lower():
            em_idx = i
            break
    name_idx = None
    for i, h in enumerate(header):
        if 'name' in h.lower():
            name_idx = i
            break
    print(f'\nemail col index: {em_idx} ({header[em_idx] if em_idx is not None else "?"})')
    print(f'name col index : {name_idx} ({header[name_idx] if name_idx is not None else "?"})')

    data = rows[1:]
    total = len(data)
    emails = []
    empty_email_rows = 0
    bad_email_rows = []
    for r in data:
        v = r[em_idx] if em_idx is not None and em_idx < len(r) else None
        v = (str(v).strip() if v is not None else '')
        if not v or v.lower() in ('none', 'null', 'nan'):
            empty_email_rows += 1
            continue
        if '@' not in v or '.' not in v.split('@')[-1]:
            bad_email_rows.append(v)
            continue
        emails.append(v.lower())

    print(f'total data rows      : {total}')
    print(f'rows with email      : {len(emails)}')
    print(f'rows no email        : {empty_email_rows}')
    print(f'rows malformed email : {len(bad_email_rows)}  {bad_email_rows[:10]}')

    c = Counter(emails)
    dupes = {k: v for k, v in c.items() if v > 1}
    print(f'unique emails        : {len(c)}')
    print(f'duplicated addresses : {len(dupes)}')
    for k, v in list(sorted(dupes.items(), key=lambda kv: -kv[1]))[:15]:
        print(f'   x{v}  {k}')

    # domain breakdown
    doms = Counter(e.split('@')[1] for e in c)
    print(f'\ntop domains ({len(doms)} distinct):')
    for d, n in doms.most_common(15):
        print(f'   {n:4d}  {d}')

    # gmail dot/plus aliasing check (gmail ignores dots)
    def gkey(e):
        loc, dom = e.split('@', 1)
        if dom in ('gmail.com', 'googlemail.com'):
            return loc.replace('.', '').split('+')[0] + '@' + dom
        return e
    gc = Counter(gkey(e) for e in emails)
    gdupes = {k: v for k, v in gc.items() if v > 1}
    print(f'\ngmail-alias duplicates (dot-insensitive): {len(gdupes)}')
    for k, v in list(sorted(gdupes.items(), key=lambda kv: -kv[1]))[:10]:
        print(f'   x{v}  {k}')
        for e in c:
            if gkey(e) == k:
                print(f'        - {e}')

wb.close()
