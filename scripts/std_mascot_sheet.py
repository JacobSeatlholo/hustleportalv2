"""Contact sheet of the 7 generated standard mascots — one image to eyeball them all."""
from PIL import Image
import os

OUT = '/home/z/my-project/scripts/std_mascots_out'
ids = ['calendar', 'phone', 'video', 'thumbs', 'coins', 'search', 'lock']
cell_w, cell_h = 448, 256
cols, rows = 2, 4
sheet = Image.new('RGB', (cols * cell_w, rows * cell_h), '#dddddd')
for i, mid in enumerate(ids):
    p = os.path.join(OUT, f'{mid}.png')
    im = Image.open(p).convert('RGB')
    im.thumbnail((cell_w - 8, cell_h - 8))
    x = (i % cols) * cell_w + (cell_w - im.width) // 2
    y = (i // cols) * cell_h + (cell_h - im.height) // 2
    sheet.paste(im, (x, y))
sheet.save('/home/z/my-project/scripts/std_mascots_out/_sheet.jpg', quality=82)
print('sheet saved', sheet.size)
