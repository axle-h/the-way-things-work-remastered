"""Minimal XTEST driver for an emulator window on a nested X server.

Usage (DISPLAY must point at the nested server, e.g. :6):
  xdrive.py shot out.png            screenshot of the whole X screen
  xdrive.py key Return [Alt_L+f]... press keys / chords (keysym names, '+' joins modifiers)
  xdrive.py type 'C:\\WINDOWS'      type literal text (handles shift for upper case / symbols)
  xdrive.py click X Y [button]      absolute click
  xdrive.py move X Y
  xdrive.py rel DX DY               relative motion (for emulators that grab the pointer)
"""
import os
import subprocess
import sys
import time

from Xlib import X, XK, display
from Xlib.ext import xtest

d = display.Display(os.environ.get("DISPLAY", ":6"))
DELAY = float(os.environ.get("XDRIVE_DELAY", "0.06"))

SHIFTED = {
    '~': 'grave', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7',
    '*': '8', '(': '9', ')': '0', '_': 'minus', '+': 'equal', '{': 'bracketleft',
    '}': 'bracketright', '|': 'backslash', ':': 'semicolon', '"': 'apostrophe',
    '<': 'comma', '>': 'period', '?': 'slash',
}
PLAIN = {
    ' ': 'space', '.': 'period', '\\': 'backslash', '/': 'slash', '-': 'minus', '=': 'equal',
    ',': 'comma', ';': 'semicolon', "'": 'apostrophe', '[': 'bracketleft', ']': 'bracketright',
    '`': 'grave', '\n': 'Return', '\t': 'Tab',
}


def kc(name):
    ks = XK.string_to_keysym(name)
    if ks == 0:
        raise SystemExit(f"unknown keysym {name}")
    return d.keysym_to_keycode(ks)


def press(codes):
    for c in codes:
        xtest.fake_input(d, X.KeyPress, c)
        d.sync()
        time.sleep(DELAY / 2)
    time.sleep(DELAY)
    for c in reversed(codes):
        xtest.fake_input(d, X.KeyRelease, c)
        d.sync()
        time.sleep(DELAY / 2)
    time.sleep(DELAY)


def key(chord):
    press([kc(m) for m in chord.split('+')])


def type_text(text):
    for ch in text:
        if ch in SHIFTED:
            press([kc('Shift_L'), kc(SHIFTED[ch])])
        elif ch.isalpha() and ch.isupper():
            press([kc('Shift_L'), kc(ch.lower())])
        elif ch in PLAIN:
            press([kc(PLAIN[ch])])
        else:
            press([kc(ch)])


def move(x, y):
    xtest.fake_input(d, X.MotionNotify, x=int(x), y=int(y))
    d.sync()


def rel(dx, dy):
    xtest.fake_input(d, X.MotionNotify, detail=1, x=int(dx), y=int(dy))
    d.sync()


def click(x, y, b=1):
    move(x, y)
    time.sleep(0.15)
    xtest.fake_input(d, X.ButtonPress, int(b))
    d.sync()
    time.sleep(0.1)
    xtest.fake_input(d, X.ButtonRelease, int(b))
    d.sync()


def shot(path):
    g = d.screen().root.get_geometry()
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size",
                    f"{g.width}x{g.height}", "-i", os.environ.get("DISPLAY", ":6"),
                    "-frames:v", "1", path], check=True)


def main(argv):
    cmd, *a = argv
    if cmd == "shot":
        shot(a[0])
    elif cmd == "key":
        for k in a:
            key(k)
    elif cmd == "type":
        type_text(" ".join(a))
    elif cmd == "click":
        click(*a)
    elif cmd == "dclick":
        click(*a[:2]); time.sleep(0.12); click(*a[:2])
    elif cmd == "move":
        move(*a)
    elif cmd == "rel":
        rel(*a)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
