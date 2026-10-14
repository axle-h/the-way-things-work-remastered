#!/usr/bin/env python3
"""Dump NE (16-bit Windows) header info: segments, imports, entry, resources."""
import struct, sys
d = open(sys.argv[1], 'rb').read()
ne = struct.unpack_from('<H', d, 0x3c)[0]
assert d[ne:ne+2] == b'NE'
h = struct.unpack_from('<2sBBHHIHHHHHHHHHHHHHHHHHHBB', d, ne)
(sig, lver, lrev, enttab, entlen, crc, flags, autodata, heap, stack, ip, cs, sp, ss,
 nseg, nmod, nrnlen, segtab, rsrctab, resntab, modtab, imptab) = h[:22]
nrntab = struct.unpack_from('<I', d, ne+0x2c)[0]
align = struct.unpack_from('<H', d, ne+0x32)[0]
nres = struct.unpack_from('<H', d, ne+0x34)[0]
expver = struct.unpack_from('<H', d, ne+0x3e)[0]
print(f"NE at {ne:#x} linker {lver}.{lrev} flags {flags:#x} autodata seg {autodata} heap {heap:#x} stack {stack:#x}")
print(f"entry CS:IP = {cs}:{ip:#x}  SS:SP = {ss}:{sp:#x}  expected win ver {expver:#x} align shift {align}")
print(f"segments {nseg}, modules {nmod}")
for i in range(nseg):
    off, ln, fl, mn = struct.unpack_from('<HHHH', d, ne+segtab+i*8)
    print(f"  seg {i+1}: fileoff {off<<align:#08x} len {ln or 0x10000:#06x} flags {fl:#06x} {'DATA' if fl&1 else 'CODE'} minalloc {mn:#x}")
def pstr(o):
    n = d[o]; return d[o+1:o+1+n].decode('latin1')
mods = []
for i in range(nmod):
    o = struct.unpack_from('<H', d, ne+modtab+i*2)[0]
    mods.append(pstr(ne+imptab+o))
print("imported modules:", mods)
# resident name table
o = ne+resntab
print("resident names:")
while d[o]:
    s = pstr(o); o += 1+len(s); print("  ", s, struct.unpack_from('<H', d, o)[0]); o += 2
# resources
o = ne+rsrctab
shift = struct.unpack_from('<H', d, o)[0]; o += 2
RT = {1:'CURSOR',2:'BITMAP',3:'ICON',4:'MENU',5:'DIALOG',6:'STRING',7:'FONTDIR',8:'FONT',9:'ACCELERATOR',10:'RCDATA',12:'GROUP_CURSOR',14:'GROUP_ICON'}
def rname(v):
    if v & 0x8000: return str(v & 0x7fff)
    return pstr(ne+rsrctab+v)
print("resources:")
res = []
while True:
    t = struct.unpack_from('<H', d, o)[0]
    if t == 0: break
    cnt = struct.unpack_from('<H', d, o+2)[0]; o += 8
    tn = RT.get(t & 0x7fff, str(t & 0x7fff)) if t & 0x8000 else pstr(ne+rsrctab+t)
    for j in range(cnt):
        off, ln, fl, rid = struct.unpack_from('<HHHH', d, o); o += 12
        res.append((tn, rname(rid), off << shift, ln << shift))
        print(f"  {tn:14s} {rname(rid):20s} off {off<<shift:#08x} len {ln<<shift:#x}")
if len(sys.argv) > 2:
    import os
    os.makedirs(sys.argv[2], exist_ok=True)
    for tn, nm, off, ln in res:
        open(os.path.join(sys.argv[2], f"{tn}_{nm}.bin"), 'wb').write(d[off:off+ln])
