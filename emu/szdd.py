"""Expand Microsoft SZDD-compressed files (COMPRESS.EXE / EXPAND.EXE format, e.g. HIMEM.SY_).

Usage: szdd.py SRC [SRC...] DESTDIR
Each SRC is written to DESTDIR under its restored name (the trailing '_' is replaced by the
last-character byte stored in the header). Uncompressed inputs are copied unchanged.
"""
import os
import shutil
import sys

MAGIC = b"SZDD\x88\xf0\x27\x33"


def expand(data):
    if not data.startswith(MAGIC):
        return None, None
    lastch = chr(data[9]) if data[9] else ""
    size = int.from_bytes(data[10:14], "little")
    win = bytearray(b" " * 4096)
    pos = 4096 - 16
    out = bytearray()
    i = 14
    n = len(data)
    while i < n and len(out) < size:
        flags = data[i]
        i += 1
        for bit in range(8):
            if i >= n or len(out) >= size:
                break
            if flags & (1 << bit):
                c = data[i]
                i += 1
                out.append(c)
                win[pos] = c
                pos = (pos + 1) & 0xFFF
            else:
                if i + 1 >= n:
                    i = n
                    break
                lo, hi = data[i], data[i + 1]
                i += 2
                off = lo | ((hi & 0xF0) << 4)
                ln = (hi & 0x0F) + 3
                for k in range(ln):
                    c = win[(off + k) & 0xFFF]
                    out.append(c)
                    win[pos] = c
                    pos = (pos + 1) & 0xFFF
    return bytes(out[:size]), lastch


def restored_name(name, lastch):
    if name.endswith("_") and lastch:
        return name[:-1] + lastch.upper()
    return name


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    *srcs, dest = argv
    os.makedirs(dest, exist_ok=True)
    for src in srcs:
        base = os.path.basename(src)
        with open(src, "rb") as f:
            data = f.read()
        out, lastch = expand(data)
        if out is None:
            shutil.copyfile(src, os.path.join(dest, base))
        else:
            with open(os.path.join(dest, restored_name(base, lastch)), "wb") as f:
                f.write(out)


if __name__ == "__main__":
    main(sys.argv[1:])
