#!/usr/bin/env python3
"""Print far-pointer vtable entries: vt.py SEL:OFF [n]"""
import struct, sys, os
MEM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'analysis', 'decompiled', 'mem')
def rd(sel, off, n):
    return open(os.path.join(MEM, f"{sel:04x}_0000.bin"), 'rb').read()[off:off+n]
def vt(addr, n=12):
    sel, off = (int(x, 16) for x in addr.split(':'))
    b = rd(sel, off, 4*n)
    return [f"{s:04x}:{o:04x}" for o, s in struct.iter_unpack('<HH', b)]
if __name__ == '__main__':
    for a in sys.argv[1:]:
        n = 12
        if '/' in a: a, n = a.split('/'); n = int(n)
        print(a, ' '.join(f"+{i*4:02x}={x}" for i, x in enumerate(vt(a, n))))
