"""PNG → JPG for the standard mascot set (email-safe hosted rasters)."""
from PIL import Image
import os

SRC = '/home/z/my-project/scripts/std_mascots_out'
DST = '/home/z/my-project/public/email'
for mid in ['calendar', 'phone', 'video', 'thumbs', 'coins', 'search', 'lock']:
    im = Image.open(os.path.join(SRC, f'{mid}.png')).convert('RGB')
    dst = os.path.join(DST, f'mascot-{mid}-std.jpg')
    im.save(dst, 'JPEG', quality=88, optimize=True)
    print(f'{mid}: {im.size} -> {os.path.getsize(dst) // 1024} KB')
