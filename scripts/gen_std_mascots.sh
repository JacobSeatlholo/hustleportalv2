#!/bin/bash
# Standard character set — blank-shirt variants of the BH mascot occasions.
# The BH-vested originals stay untouched (internal HustlePortal mail keeps them,
# and sent emails keep referencing them); these -std twins carry NOTHING written
# on the shirts/objects so user campaign mail never wears our mark.
set -u
SRC=/home/z/my-project/public/email
OUT=/home/z/my-project/scripts/std_mascots_out
mkdir -p "$OUT"

PROMPT="Remove the letters 'BH' from the cartoon honey badger character's clothing and from any object it holds (vest, hoodie, badge, coin, shirt). The fabric and metal become plain and unprinted, same underlying color, no letters, no monogram, no logo anywhere. Keep the character's pose, face, colors, background and flat cartoon style exactly identical to the input image. Do not add any new text."

for id in calendar phone video thumbs coins search lock; do
  if [ -s "$OUT/$id.png" ]; then
    echo "skip $id (already done)"
    continue
  fi
  echo "=== $id ==="
  z-ai image-edit -p "$PROMPT" -i "$SRC/mascot-$id.jpg" -o "$OUT/$id.png" -s 1344x768 || echo "FAILED $id"
done
echo "done"
