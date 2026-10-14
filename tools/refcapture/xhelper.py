"""X helper for tools/refcapture: window lookup and XTEST input on the nested X server.

It reads one JSON request per line on stdin and answers one JSON line on stdout, so the
TypeScript harness can keep a single process (and X connection) open. Run it with
`python3 -I` from the harness's own venv (vendor/venv, python-xlib); DISPLAY selects the server.

Requests ({"cmd": ...}):
  windows                 mapped top-level windows: [{id, name, x, y, width, height}]
  move    x y             move the pointer (root coordinates)
  click   x y [button]    move, then press and release a button (XTEST)
  key     chord           press a chord such as "Alt_L+F4" (XTEST)
  resize  id width height configure a window's size (Wine follows it for its managed windows)
  close   id              send WM_DELETE_WINDOW, as a window manager's close button would
  focus   id              give a window the input focus, as a window manager would on a click
  screen                  the root window size: {width, height}
"""
import json
import os
import sys
import time

from Xlib import X, XK, display
from Xlib.error import XError
from Xlib.ext import xtest
from Xlib.protocol import event

d = display.Display(os.environ.get("DISPLAY", ":5"))
root = d.screen().root
WM_PROTOCOLS = d.intern_atom("WM_PROTOCOLS")
WM_DELETE_WINDOW = d.intern_atom("WM_DELETE_WINDOW")
NET_WM_NAME = d.intern_atom("_NET_WM_NAME")
UTF8_STRING = d.intern_atom("UTF8_STRING")


def window_name(w):
    try:
        prop = w.get_full_property(NET_WM_NAME, UTF8_STRING)
        if prop is not None:
            value = prop.value
            return value.decode("utf-8", "replace") if isinstance(value, bytes) else str(value)
        name = w.get_wm_name()
        if isinstance(name, bytes):
            return name.decode("latin-1")
        return name or ""
    except XError:
        return ""


def windows():
    found = []
    for w in root.query_tree().children:
        try:
            if w.get_attributes().map_state != X.IsViewable:
                continue
            g = w.get_geometry()
        except XError:
            continue
        found.append({"id": w.id, "name": window_name(w), "x": g.x + g.border_width,
                      "y": g.y + g.border_width, "width": g.width, "height": g.height})
    return found


def keycode(name):
    sym = XK.string_to_keysym(name)
    if sym == 0:
        raise ValueError(f"unknown keysym {name}")
    return d.keysym_to_keycode(sym)


def move(x, y):
    xtest.fake_input(d, X.MotionNotify, x=int(x), y=int(y))
    d.sync()


def click(x, y, button=1):
    move(x, y)
    time.sleep(0.15)
    xtest.fake_input(d, X.ButtonPress, int(button))
    d.sync()
    time.sleep(0.1)
    xtest.fake_input(d, X.ButtonRelease, int(button))
    d.sync()


def key(chord):
    codes = [keycode(name) for name in chord.split("+")]
    for code in codes:
        xtest.fake_input(d, X.KeyPress, code)
        d.sync()
        time.sleep(0.03)
    time.sleep(0.06)
    for code in reversed(codes):
        xtest.fake_input(d, X.KeyRelease, code)
        d.sync()
        time.sleep(0.03)


def resize(wid, width, height):
    w = d.create_resource_object("window", int(wid))
    w.configure(width=int(width), height=int(height))
    d.sync()


def close(wid):
    w = d.create_resource_object("window", int(wid))
    message = event.ClientMessage(window=w, client_type=WM_PROTOCOLS,
                                  data=(32, [WM_DELETE_WINDOW, X.CurrentTime, 0, 0, 0]))
    w.send_event(message, event_mask=X.NoEventMask)
    d.sync()


def focus(wid):
    w = d.create_resource_object("window", int(wid))
    w.set_input_focus(X.RevertToParent, X.CurrentTime)
    d.sync()


def handle(request):
    cmd = request.get("cmd")
    if cmd == "windows":
        return {"windows": windows()}
    if cmd == "move":
        move(request["x"], request["y"])
    elif cmd == "click":
        click(request["x"], request["y"], request.get("button", 1))
    elif cmd == "key":
        key(request["chord"])
    elif cmd == "resize":
        resize(request["id"], request["width"], request["height"])
    elif cmd == "close":
        close(request["id"])
    elif cmd == "focus":
        focus(request["id"])
    elif cmd == "screen":
        g = root.get_geometry()
        return {"width": g.width, "height": g.height}
    else:
        raise ValueError(f"unknown command {cmd!r}")
    return {}


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            reply = {"ok": True, **handle(json.loads(line))}
        except Exception as error:  # report every failure to the caller instead of dying
            reply = {"ok": False, "error": f"{type(error).__name__}: {error}"}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
