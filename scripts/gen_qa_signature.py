#!/usr/bin/env python3
# Regenerates the QA signature PNG the e-sign machine test draws with.
# A deterministic scribble: a signature-shaped wavy line over a baseline.
from PIL import Image, ImageDraw

img = Image.new('RGB', (400, 140), 'white')
d = ImageDraw.Draw(img)
points = []
import math
for x in range(20, 380):
    t = (x - 20) / 360 * math.pi * 4
    y = 70 + math.sin(t) * (25 - (x - 20) / 360 * 12) + math.sin(t * 2.7) * 6
    points.append((x, y))
d.line(points, fill=(15, 23, 42), width=3)
d.line([(30, 108), (250, 104)], fill=(15, 23, 42), width=2)  # the underline flourish
img.save('/home/z/my-project/scripts/qa_signature.png')
print('qa_signature.png written')
