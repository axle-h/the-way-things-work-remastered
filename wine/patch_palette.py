"""Copy TWTW.EXE with its PALETTE resource made Wine-friendly.

The PALETTE resource (id 200) marks entries 0-9 and 246-255 as PC_EXPLICIT
(system palette slot N). Wine resolves those wrongly in true-colour mode, so
page backgrounds (index 255) draw red. Replace them with the standard Windows
static colours as plain RGB entries.

usage: patch_palette.py SRC_EXE DST_EXE
"""
import sys

PC_EXPLICIT = 0x02
STATIC = {
    0: 0x000000, 1: 0x800000, 2: 0x008000, 3: 0x808000, 4: 0x000080,
    5: 0x800080, 6: 0x008080, 7: 0xC0C0C0, 8: 0xC0DCC0, 9: 0xA6CAF0,
    246: 0xFFFBF0, 247: 0xA0A0A4, 248: 0x808080, 249: 0xFF0000, 250: 0x00FF00,
    251: 0xFFFF00, 252: 0x0000FF, 253: 0xFF00FF, 254: 0x00FFFF, 255: 0xFFFFFF,
}

src, dst = sys.argv[1:3]
exe = bytearray(open(src, "rb").read())

# LOGPALETTE header (palVersion=0x300, palNumEntries=256) followed by
# entry 0 = PC_EXPLICIT index 0 and entry 1 = PC_EXPLICIT index 1.
sig = bytes.fromhex("00030001" "00000002" "01000002")
off = exe.find(sig)
if off < 0 or exe.find(sig, off + 1) >= 0:
    sys.exit("PALETTE resource not found exactly once")

for i, rgb in STATIC.items():
    o = off + 4 + i * 4
    assert exe[o + 3] == PC_EXPLICIT, f"entry {i} is not PC_EXPLICIT"
    exe[o:o + 4] = bytes([rgb >> 16, (rgb >> 8) & 0xFF, rgb & 0xFF, 0])

open(dst, "wb").write(exe)
print(f"patched PALETTE at {off:#x} -> {dst}")
