#!/usr/bin/env python3
"""Post-process a docx for WPS/Word page-number compatibility:
1. strip empty <w:pgNumType/> from document.xml
2. patch footer PAGE fields with explicit format switches.
Footer files are matched to sections by order of appearance in document.xml
section properties; we patch ALL footers containing a bare PAGE field:
Roman for the front-matter footer, arabic for the body footer. Because both
sections share footer builders, we distinguish by the footer's pgNumType in
document.xml: the section referencing each footer id carries its fmt.
Simpler robust rule used here: the FIRST footer containing PAGE -> ROMAN,
every later footer containing PAGE -> arabic (matches cover/front/body order).
"""
import re
import shutil
import sys
import zipfile

path = sys.argv[1]
tmp = path + ".tmp.docx"

with zipfile.ZipFile(path, "r") as zin:
    names = zin.namelist()
    data = {n: zin.read(n) for n in names}

doc = data["word/document.xml"].decode("utf-8")
doc = doc.replace("<w:pgNumType/>", "")

# footer order in the zip is not section order; derive it from document.xml:
# find sectPr blocks in order, grab their footerReference ids, map via rels.
rels = data["word/_rels/document.xml.rels"].decode("utf-8")
rel_map = dict(re.findall(r'<Relationship Id="([^"]+)"[^>]*Target="(footer\d+\.xml)"', rels))
sect_footer_ids = re.findall(r'<w:footerReference[^>]*r:id="([^"]+)"', doc)
ordered_footers = []
for rid in sect_footer_ids:
    tgt = rel_map.get(rid)
    if tgt and f"word/{tgt}" not in ordered_footers:
        ordered_footers.append(f"word/{tgt}")

fmt_for = {}
for i, f in enumerate(ordered_footers):
    fmt_for[f] = "ROMAN" if i == 0 else "arabic"

for fname, fmt in fmt_for.items():
    if fname not in data:
        continue
    xml = data[fname].decode("utf-8")
    xml = re.sub(
        r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
        rf"\1 PAGE \\* {fmt} \\* MERGEFORMAT \2",
        xml,
    )
    data[fname] = xml.encode("utf-8")

data["word/document.xml"] = doc.encode("utf-8")

with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for n in names:
        zout.writestr(n, data[n])
shutil.move(tmp, path)
print("post-processed:", path, "| footers:", fmt_for)
