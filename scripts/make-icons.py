#!/usr/bin/env python3
"""Icono del tubo: anillo cian sobre fondo oscuro."""

import struct
import zlib
from pathlib import Path


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def pixel(x: int, y: int, size: int) -> bytes:
    cx = (size - 1) / 2
    cy = (size - 1) / 2
    nx = (x - cx) / (size / 2)
    ny = (y - cy) / (size / 2)
    r = (nx * nx + ny * ny) ** 0.5
    if 0.46 <= r <= 0.72:
        return bytes((94, 231, 231, 255))
    if r < 0.16:
        return bytes((232, 255, 255, 255))
    return bytes((16, 33, 38, 255))


def write_png(path: Path, size: int) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y, size))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "extension" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        write_png(out / f"icon{size}.png", size)


if __name__ == "__main__":
    main()
