#!/usr/bin/env python3
"""Add the 640x480 / 800x600 switch to the game bundle, or check that a bundle has it.

    build_bundle.py build  [SRC] -o OUT     rebuild SRC (default: the bundle in the repo) into OUT
    build_bundle.py verify BUNDLE [--base BASE]

Standard library only, and deterministic: the same input gives the same bytes on any machine.
Read scripts/resolution/README.md before using it; the short version of why it exists:

  Windows 3.1's video mode is `screen-size=` in C:\\WINDOWS\\SYSTEM.INI, which lives inside the
  bundle's hdd.img. Every player's browser also stores its OWN copy of hdd.img (js-dos persists the
  whole changed disk, and the disk is changed by every session), and that copy shadows the
  bundle's. So an edit to hdd.img reaches new visitors only. dosbox.conf and the files under d/
  are read from the bundle at every boot, so the switch is made there instead:

    .jsdos/dosbox.conf   [autoexec]: `call d:\\setres.bat` after the drives are mounted
    d/SETRES.BAT         copies d:\\res\\s640.ini, or d:\\res\\s800.ini when d:\\res\\use800.flg
                         exists, over C:\\WINDOWS\\SYSTEM.INI, before Windows starts, and only on a
                         disk that has the drivers those files name (see SYSTEM_FILES)
    d/res/s640.ini       SYSTEM.INI with the 640x480 mode
    d/res/s800.ini       SYSTEM.INI exactly as hdd.img has it (800x600)

Nothing else in the archive is touched: every other entry is copied byte for byte, compressed data
included, and hdd.img is never rewritten. The ZIP is written by hand rather than through
`zipfile`, because `zipfile` cannot copy a compressed entry without recompressing it.
"""

import argparse
import re
import struct
import sys
import zipfile
import zlib
from pathlib import Path

# ---------------------------------------------------------------------------------------------
# What gets added
# ---------------------------------------------------------------------------------------------

REPO_BUNDLE = Path(__file__).resolve().parents[2] / "src" / "assets" / "elifoot" / "elifoot98.jsdos"

CONF = ".jsdos/dosbox.conf"
HDD = "hdd.img"
SYSTEM_INI_IN_HDD = "WINDOWS/SYSTEM.INI"

# The line added to [autoexec]. Lower case, like the rest of that section; DOS is case-blind.
SETRES_CALL = "call d:\\setres.bat"
# It goes right after the line that mounts C:, so Windows' disk is there to be written to and
# `c:` / `autoexec.bat` (which end in `win`) have not run yet.
IMGMOUNT_PREFIX = "imgmount c "

# Entries this script owns, in the order they are appended. Anything of these names already in
# the source is dropped first, which is what makes a rebuild of a built bundle a no-op.
SETRES_BAT_NAME = "d/SETRES.BAT"
S640_NAME = "d/res/s640.ini"
S800_NAME = "d/res/s800.ini"
MANAGED_NAMES = ["d/res/", S640_NAME, S800_NAME, SETRES_BAT_NAME]

# The files both SYSTEM.INI variants name that older disk images lack, found by diffing every
# hdd.img the repo ever shipped against the current one: the 256-colour image of ce6eb4a (on main
# for about a day, 2025-04-19 to 04-20) has none of the four sound ones, the VGA image of e6084fe
# none of the seven. A player's saved layer keeps the image it first got (README, "Why hdd.img is
# not touched"), so such a disk still reaches this script, and a SYSTEM.INI that names a missing
# 386 device stops Windows with "Cannot find a device file that may be needed to run Windows in
# 386 enhanced mode ... vsbd.386" and leaves the guest at the DOS prompt. That was reproduced on a
# real ce6eb4a layer with this script before it had the check. SETRES.BAT therefore leaves a disk
# alone unless every one of them is on it; `verify` checks that they are all on THIS bundle's image
# and all named in both INIs, because a marker that went missing from a future image would
# silently pin every new visitor to 800x600.
SYSTEM_FILES = [
    "s3vsnd.drv",    # display.drv
    "vdds3vsn.386",  # [386Enh] display
    "s3911grb.3gr",  # 386grabber
    "vsbd.386",      # [386Enh] device
    "vadlibd.386",   # [386Enh] device
    "sndblst2.drv",  # Wave, MIDI
    "msadlib.drv",   # MIDI1
]

# DOS 6 `copy /y` overwrites without asking; DOSBox's own COPY accepts and ignores the switch.
# CRLF, as a batch file wants. `use800.flg` is created by the app (PatchService.setDisplayMode),
# never by this script: a bundle can only carry the default.
SETRES_BAT = "\r\n".join([
    "@echo off",
    "rem Picks the Windows 3.1 video mode. Run from dosbox.conf [autoexec] before Windows starts.",
    "rem Default 640x480; the app drops d:\\res\\use800.flg into the saved disk to ask for 800x600.",
    "rem A saved disk keeps the image it first got; leave it alone if it lacks a driver the INI names.",
] + [
    "if not exist c:\\windows\\system\\%s goto done" % name for name in SYSTEM_FILES
] + [
    "if exist d:\\res\\use800.flg goto r800",
    "copy /y d:\\res\\s640.ini c:\\windows\\system.ini",
    "goto done",
    ":r800",
    "copy /y d:\\res\\s800.ini c:\\windows\\system.ini",
    ":done",
    "",
])

# What the 640x480 SYSTEM.INI changes, and nothing else. The driver (S3VSND.DRV) is the one already
# on the disk; the description string is the one its own OEMSETUP.INF uses for 640x480 64K.
MODE_640 = {
    ("DISPLAY", "screen-size"): ("800", "640"),
    ("boot.description", "display.drv"): (
        "S3 864 1.41B5  800x600   64K colors SF",
        "S3 864 1.41B5  640x480   64K colors",
    ),
}

# New entries all carry this time (1980-based DOS date; the day this was written) so that the output
# does not depend on the clock. Permissions are those of the neighbouring files in the bundle.
NEW_ENTRY_DATE = (2026, 10, 28)
FILE_ATTR = 0o100644 << 16
DIR_ATTR = (0o040755 << 16) | 0x10


def fail(message):
    sys.exit("build_bundle.py: " + message)


# ---------------------------------------------------------------------------------------------
# Reading a FAT16 disk image, just enough to fetch one file (hdd.img: MBR, one FAT16 partition)
# ---------------------------------------------------------------------------------------------

def read_fat16_file(image, path, missing_ok=False):
    """The bytes of `path` ('WINDOWS/SYSTEM.INI', 8.3 names) from the first partition of `image`.

    A missing path is fatal, or None with `missing_ok`."""
    if image[510:512] != b"\x55\xaa":
        fail("hdd.img has no MBR signature")
    # First partition table entry: type at +4, first sector at +8.
    ptype = image[0x1BE + 4]
    first_lba = struct.unpack_from("<I", image, 0x1BE + 8)[0]
    if ptype not in (0x04, 0x06, 0x0E):
        fail("hdd.img partition type 0x%02x is not FAT16" % ptype)
    base = first_lba * 512
    bps, spc, reserved, nfats, nroot = struct.unpack_from("<HBHBH", image, base + 11)
    sectors_per_fat = struct.unpack_from("<H", image, base + 22)[0]
    fat = base + reserved * bps
    root = fat + nfats * sectors_per_fat * bps
    data = root + ((nroot * 32 + bps - 1) // bps) * bps
    cluster_bytes = spc * bps

    def chain(cluster):
        while 2 <= cluster < 0xFFF8:
            yield cluster
            cluster = struct.unpack_from("<H", image, fat + cluster * 2)[0]

    def read_chain(cluster, size=None):
        out = b"".join(image[data + (c - 2) * cluster_bytes:data + (c - 1) * cluster_bytes]
                       for c in chain(cluster))
        return out if size is None else out[:size]

    def entries(raw):
        for i in range(0, len(raw), 32):
            e = raw[i:i + 32]
            if e[0] == 0:
                return
            if e[0] == 0xE5 or e[11] == 0x0F or e[11] & 0x08:
                continue  # deleted, long-name part, volume label
            name = e[0:8].decode("cp437").rstrip()
            ext = e[8:11].decode("cp437").rstrip()
            yield (name + ("." + ext if ext else ""),
                   bool(e[11] & 0x10),
                   struct.unpack_from("<H", e, 26)[0],
                   struct.unpack_from("<I", e, 28)[0])

    listing = list(entries(image[root:root + nroot * 32]))
    parts = path.split("/")
    for depth, part in enumerate(parts):
        match = [e for e in listing if e[0].upper() == part.upper()]
        if not match:
            if missing_ok:
                return None
            fail("%s not found in hdd.img" % path)
        name, is_dir, cluster, size = match[0]
        if depth == len(parts) - 1:
            if is_dir:
                fail("%s is a directory" % path)
            return read_chain(cluster, size)
        if not is_dir:
            fail("%s is not a directory" % name)
        listing = list(entries(read_chain(cluster)))
    fail("empty path")


# ---------------------------------------------------------------------------------------------
# SYSTEM.INI
# ---------------------------------------------------------------------------------------------

def edit_ini(text, edits):
    """Apply {(section, key): (old, new)} to an INI, keeping line endings. Each must match once."""
    lines = text.split("\r\n")
    section = None
    seen = set()
    for i, line in enumerate(lines):
        header = re.match(r"^\[(.+)\]\s*$", line)
        if header:
            section = header.group(1)
            continue
        key, sep, value = line.partition("=")
        if sep and (section, key) in edits:
            old, new = edits[(section, key)]
            if value != old:
                fail("SYSTEM.INI [%s] %s is %r, expected %r: is hdd.img still the original?"
                     % (section, key, value, old))
            lines[i] = "%s=%s" % (key, new)
            seen.add((section, key))
    missing = set(edits) - seen
    if missing:
        fail("SYSTEM.INI has no %s" % ", ".join("[%s] %s" % m for m in sorted(missing)))
    return "\r\n".join(lines)


def system_ini_variants(hdd_image):
    """(800x600, 640x480) SYSTEM.INI bytes. The 800x600 one is the file in hdd.img, unchanged."""
    s800 = read_fat16_file(hdd_image, SYSTEM_INI_IN_HDD)
    text = s800.decode("cp437")
    if "\r\nscreen-size=800\r\n" not in text or "\r\ncolor-format=16\r\n" not in text:
        fail("SYSTEM.INI in hdd.img is not the 800x600 / 64K one this script was written for")
    return s800, edit_ini(text, MODE_640).encode("cp437")


def set_setres_call(conf_text):
    """dosbox.conf with exactly one SETRES_CALL, straight after the `imgmount c` line."""
    lines = [l for l in conf_text.split("\n") if l.strip().lower() != SETRES_CALL]
    mounts = [i for i, l in enumerate(lines) if l.lower().startswith(IMGMOUNT_PREFIX)]
    if len(mounts) != 1:
        fail("dosbox.conf must have exactly one 'imgmount c' line, found %d" % len(mounts))
    # The file is LF today; if it ever turns CRLF the new line should not be the odd one out.
    eol = "\r" if lines[mounts[0]].endswith("\r") else ""
    lines.insert(mounts[0] + 1, SETRES_CALL + eol)
    return "\n".join(lines)


# ---------------------------------------------------------------------------------------------
# The ZIP container
# ---------------------------------------------------------------------------------------------

LOCAL_SIG = b"PK\x03\x04"
CENTRAL_SIG = b"PK\x01\x02"
END_SIG = b"PK\x05\x06"


class Entry:
    """One archive member: its central directory record, and its local header + data as stored."""

    def __init__(self, name, central, local):
        self.name = name
        self.central = bytearray(central)  # fixed 46 bytes + name + extra + comment
        self.local = bytes(local)          # fixed 30 bytes + name + extra + data

    @property
    def data(self):
        """The stored bytes (compressed, if the entry is)."""
        name_len, extra_len = struct.unpack_from("<HH", self.local, 26)
        return self.local[30 + name_len + extra_len:]

    def content(self):
        """The bytes the entry holds once extracted."""
        method = struct.unpack_from("<H", self.central, 10)[0]
        if method == 0:
            return self.data
        if method == 8:
            return zlib.decompress(self.data, -15)
        fail("%s uses compression method %d" % (self.name, method))


def read_archive(raw):
    eocd = raw.rfind(END_SIG)
    if eocd < 0 or len(raw) - eocd != 22:
        fail("not a plain ZIP (no end record, or it has a comment)")
    count, cd_size, cd_offset = struct.unpack_from("<HII", raw, eocd + 10)
    if count == 0xFFFF or 0xFFFFFFFF in (cd_size, cd_offset):
        fail("ZIP64 archives are not supported")
    records = []
    pos = cd_offset
    for _ in range(count):
        if raw[pos:pos + 4] != CENTRAL_SIG:
            fail("corrupt central directory")
        flags = struct.unpack_from("<H", raw, pos + 8)[0]
        csize, usize = struct.unpack_from("<II", raw, pos + 20)
        name_len, extra_len, comment_len = struct.unpack_from("<HHH", raw, pos + 28)
        offset = struct.unpack_from("<I", raw, pos + 42)[0]
        length = 46 + name_len + extra_len + comment_len
        if flags & 0x8:
            fail("entries with a data descriptor are not supported")
        if 0xFFFFFFFF in (csize, usize, offset):
            fail("ZIP64 entries are not supported")
        name = raw[pos + 46:pos + 46 + name_len].decode("utf-8")
        records.append((name, raw[pos:pos + length], offset, csize))
        pos += length
    entries = []
    for name, central, offset, csize in records:
        if raw[offset:offset + 4] != LOCAL_SIG:
            fail("corrupt local header for " + name)
        local_name_len, local_extra_len = struct.unpack_from("<HH", raw, offset + 26)
        end = offset + 30 + local_name_len + local_extra_len + csize
        entries.append(Entry(name, central, raw[offset:end]))
    return entries


def dos_time_date(date):
    year, month, day = date
    return 0, ((year - 1980) << 9) | (month << 5) | day


def new_entry(name, content, is_dir=False):
    """A STORED entry. Stored on purpose: a compressed stream varies between zlib builds."""
    raw_name = name.encode("utf-8")
    crc = zlib.crc32(content) & 0xFFFFFFFF
    dos_time, dos_date = dos_time_date(NEW_ENTRY_DATE)
    version_needed = 10
    local = struct.pack("<4sHHHHHIIIHH", LOCAL_SIG, version_needed, 0, 0, dos_time, dos_date,
                        crc, len(content), len(content), len(raw_name), 0) + raw_name + content
    # made by Unix 3.0; flags, method; time, date; crc, sizes; name, extra, comment lengths;
    # disk number, internal attributes; external attributes; local header offset (set on write)
    central = struct.pack("<4sHHHHHHIIIHHHHHII", CENTRAL_SIG, (3 << 8) | 30, version_needed, 0, 0,
                          dos_time, dos_date, crc, len(content), len(content),
                          len(raw_name), 0, 0, 0, 0,
                          DIR_ATTR if is_dir else FILE_ATTR, 0) + raw_name
    return Entry(name, central, local)


def with_content(entry, content):
    """`entry` with its data replaced, STORED; name, times, attributes and extra fields kept."""
    crc = zlib.crc32(content) & 0xFFFFFFFF
    local = bytearray(entry.local[:len(entry.local) - len(entry.data)])
    struct.pack_into("<H", local, 8, 0)                                  # method: stored
    struct.pack_into("<III", local, 14, crc, len(content), len(content))
    central = bytearray(entry.central)
    struct.pack_into("<H", central, 10, 0)
    struct.pack_into("<III", central, 16, crc, len(content), len(content))
    # 'version needed' for stored is 1.0; the neighbouring entries that are stored say 10.
    struct.pack_into("<H", local, 4, 10)
    struct.pack_into("<H", central, 6, 10)
    return Entry(entry.name, central, bytes(local) + content)


def write_archive(entries):
    out = bytearray()
    for entry in entries:
        struct.pack_into("<I", entry.central, 42, len(out))
        out += entry.local
    cd_offset = len(out)
    for entry in entries:
        out += entry.central
    out += struct.pack("<4sHHHHIIH", END_SIG, 0, 0, len(entries), len(entries),
                       len(out) - cd_offset, cd_offset, 0)
    return bytes(out)


# ---------------------------------------------------------------------------------------------
# build / verify
# ---------------------------------------------------------------------------------------------

def build(raw):
    entries = read_archive(raw)
    by_name = {e.name: e for e in entries}
    for needed in (CONF, HDD):
        if needed not in by_name:
            fail("the source bundle has no " + needed)

    s800, s640 = system_ini_variants(by_name[HDD].content())
    new_conf = set_setres_call(by_name[CONF].content().decode("utf-8")).encode("utf-8")

    kept = []
    for entry in entries:
        if entry.name in MANAGED_NAMES:
            continue
        kept.append(with_content(entry, new_conf) if entry.name == CONF else entry)
    kept += [
        new_entry("d/res/", b"", is_dir=True),
        new_entry(S640_NAME, s640),
        new_entry(S800_NAME, s800),
        new_entry(SETRES_BAT_NAME, SETRES_BAT.encode("ascii")),
    ]
    return write_archive(kept)


def verify(path, base_path=None):
    raw = path.read_bytes()
    problems = []

    def check(ok, message):
        if not ok:
            problems.append(message)

    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        check(bad is None, "CRC mismatch in " + str(bad))
        names = z.namelist()
        check(len(names) == len(set(names)), "duplicate entry names")
        for name in MANAGED_NAMES:
            check(name in names, "missing " + name)
        if not problems:
            s800, s640 = system_ini_variants(z.read(HDD))
            check(z.read(S800_NAME) == s800, "d/res/s800.ini is not the SYSTEM.INI of hdd.img")
            check(z.read(S640_NAME) == s640, "d/res/s640.ini is not the expected 640x480 SYSTEM.INI")
            check(z.read(SETRES_BAT_NAME) == SETRES_BAT.encode("ascii"), "d/SETRES.BAT differs")
            image = z.read(HDD)
            for name in SYSTEM_FILES:
                check(read_fat16_file(image, "WINDOWS/SYSTEM/" + name.upper(), missing_ok=True) is not None,
                      "hdd.img has no WINDOWS/SYSTEM/%s, so SETRES.BAT would never switch anyone" % name)
                for ini_name, ini in ((S640_NAME, s640), (S800_NAME, s800)):
                    check(name in ini.decode("cp437").lower(), "%s does not name %s" % (ini_name, name))
            conf = z.read(CONF).decode("utf-8")
            autoexec = conf.split("[autoexec]", 1)[-1].split("\n")
            calls = [i for i, l in enumerate(autoexec) if l.strip().lower() == SETRES_CALL]
            mount = [i for i, l in enumerate(autoexec) if l.lower().startswith(IMGMOUNT_PREFIX)]
            check(len(calls) == 1 and len(mount) == 1 and calls[0] == mount[0] + 1,
                  "[autoexec] must have the call straight after 'imgmount c'")
            check(raw == build(raw), "rebuilding this bundle does not reproduce it byte for byte")

    if base_path is not None and not problems:
        mine = {e.name: e for e in read_archive(raw)}
        base = {e.name: e for e in read_archive(base_path.read_bytes())}
        for name in sorted(set(mine) | set(base)):
            if name in MANAGED_NAMES or name == CONF:
                continue
            same = (name in mine and name in base
                    and mine[name].local == base[name].local
                    and bytes(mine[name].central[:42]) == bytes(base[name].central[:42])
                    and bytes(mine[name].central[46:]) == bytes(base[name].central[46:]))
            check(same, "%s is not byte-identical to the base" % name)
        with zipfile.ZipFile(base_path) as base_zip, zipfile.ZipFile(path) as built_zip:
            check(set_setres_call(base_zip.read(CONF).decode("utf-8")) == built_zip.read(CONF).decode("utf-8"),
                  "dosbox.conf differs from the base by more than the one added line")
            check(built_zip.read(HDD) == base_zip.read(HDD), "hdd.img changed")

    if problems:
        for p in problems:
            print("FAIL  " + p)
        return 1
    print("ok    %s: %d entries%s" % (path, len(names),
                                      ", every other entry identical to " + str(base_path) if base_path else ""))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="rebuild a bundle with the resolution switch")
    b.add_argument("src", nargs="?", type=Path, default=REPO_BUNDLE, help="default: the repo's bundle")
    b.add_argument("-o", "--out", type=Path, required=True)
    v = sub.add_parser("verify", help="check a bundle; with --base, check that nothing else changed")
    v.add_argument("bundle", type=Path)
    v.add_argument("--base", type=Path, help="the bundle it was built from")
    args = parser.parse_args()

    if args.command == "build":
        result = build(args.src.read_bytes())
        tmp = args.out.with_name(args.out.name + ".tmp")
        tmp.write_bytes(result)
        tmp.replace(args.out)
        print("wrote %s (%d bytes)" % (args.out, len(result)))
        return 0
    return verify(args.bundle, args.base)


if __name__ == "__main__":
    sys.exit(main())
