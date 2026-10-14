"""Tiny Windows 3.x INI editor that preserves order, comments and duplicate keys.

Usage: inied.py FILE OP [OP...]
  set:SECTION:KEY=VALUE   replace first KEY in SECTION (or append; creates section)
  add:SECTION:KEY=VALUE   append line unless an identical line already exists
  del:SECTION:KEY=VALUE   remove that exact line (or del:SECTION:KEY to drop every KEY=)
Files are read/written as CP437 with CRLF line endings.
"""
import sys


def load(path):
    with open(path, "rb") as f:
        return f.read().decode("cp437").replace("\r\n", "\n").split("\n")


def save(path, lines):
    while lines and lines[-1] == "":
        lines.pop()
    with open(path, "wb") as f:
        f.write(("\r\n".join(lines) + "\r\n").encode("cp437"))


def section_bounds(lines, sec):
    start = None
    for i, l in enumerate(lines):
        s = l.strip()
        if s.startswith("[") and s.endswith("]"):
            if start is not None:
                return start, i
            if s[1:-1].strip().lower() == sec.lower():
                start = i
    if start is not None:
        end = len(lines)
        while end > start + 1 and lines[end - 1].strip() == "":
            end -= 1
        return start, end
    return None


def ensure_section(lines, sec):
    b = section_bounds(lines, sec)
    if b is None:
        while lines and lines[-1].strip() == "":
            lines.pop()
        lines += ["", f"[{sec}]"]
        b = section_bounds(lines, sec)
    return b


def key_of(line):
    return line.split("=", 1)[0].strip().lower() if "=" in line else None


def apply(lines, op):
    kind, sec, kv = op.split(":", 2)
    key = kv.split("=", 1)[0].strip()
    if kind == "set":
        s, e = ensure_section(lines, sec)
        for i in range(s + 1, e):
            if key_of(lines[i]) == key.lower():
                lines[i] = kv
                return
        end = e
        while end > s + 1 and lines[end - 1].strip() == "":
            end -= 1
        lines.insert(end, kv)
    elif kind == "add":
        s, e = ensure_section(lines, sec)
        if any(lines[i].strip().lower() == kv.lower() for i in range(s + 1, e)):
            return
        end = e
        while end > s + 1 and lines[end - 1].strip() == "":
            end -= 1
        lines.insert(end, kv)
    elif kind == "del":
        b = section_bounds(lines, sec)
        if b is None:
            return
        s, e = b
        keep = []
        for i in range(s + 1, e):
            l = lines[i]
            if "=" in kv and l.strip().lower() == kv.lower():
                continue
            if "=" not in kv and key_of(l) == key.lower():
                continue
            keep.append(l)
        lines[s + 1:e] = keep
    else:
        raise SystemExit(f"bad op {op}")


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    path, *ops = argv
    lines = load(path)
    for op in ops:
        apply(lines, op)
    save(path, lines)


if __name__ == "__main__":
    main(sys.argv[1:])
