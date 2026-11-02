"""
Build utility for TransFlow (GõDịch) - In-Place Multilingual Live Translator.
1. Generates crisp multi-size RGBA PNG icons (16, 32, 48, 128) using pure Python (zero dependencies).
2. Packages `extension/` into `web/transflow-extension.zip` for easy web sharing & download.
"""

import math
import os
import shutil
import struct
import zipfile
import zlib

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.path.join(ROOT_DIR, "extension")
ICONS_DIR = os.path.join(EXT_DIR, "icons")
WEB_DIR = os.path.join(ROOT_DIR, "web")


def write_png(filepath: str, width: int, height: int, rgba_bytes: bytes) -> None:
    """Write raw RGBA bytes to a valid PNG file using stdlib zlib & struct."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack("!I", len(data))
            + tag
            + data
            + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw_rows = bytearray()
    stride = width * 4
    for y in range(height):
        raw_rows.append(0)  # Filter type 0 (None)
        raw_rows.extend(rgba_bytes[y * stride : (y + 1) * stride])

    ihdr = struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw_rows), level=9)
    png_data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )
    with open(filepath, "wb") as f:
        f.write(png_data)


def point_to_segment_dist(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy
    return math.hypot(px - proj_x, py - proj_y)


def sd_rounded_box(px: float, py: float, cx: float, cy: float, half_w: float, half_h: float, r: float) -> float:
    qx = abs(px - cx) - half_w + r
    qy = abs(py - cy) - half_h + r
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def render_icon(size: int) -> bytes:
    """Render an anti-aliased icon representing instant bi-directional language transformation."""
    buf = bytearray(size * size * 4)
    # 2x2 supersampling for crisp edges at all sizes
    samples = [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)]

    # Icon geometry in normalized [0, 1] space:
    # Rounded gradient squircle + stylized 'T' / '文' & lightning-swap arrows
    segments_white = [
        # Top exchange arrow (left -> right)
        (0.24, 0.36, 0.74, 0.36),
        (0.60, 0.23, 0.75, 0.36),
        (0.60, 0.49, 0.75, 0.36),
        # Bottom exchange arrow (right -> left)
        (0.26, 0.64, 0.76, 0.64),
        (0.40, 0.51, 0.25, 0.64),
        (0.40, 0.77, 0.25, 0.64),
    ]
    stroke_r = 0.058 if size >= 32 else 0.072

    for y in range(size):
        for x in range(size):
            r_acc = g_acc = b_acc = a_acc = 0.0
            for sx, sy in samples:
                nx = (x + sx) / size
                ny = (y + sy) / size

                # Background squircle
                d_box = sd_rounded_box(nx, ny, 0.5, 0.5, 0.45, 0.45, 0.22)
                if d_box <= 0.0:
                    # Vibrant Indigo (#4F46E5) -> Electric Cyan (#06B6D4) diagonal gradient
                    t = max(0.0, min(1.0, (nx * 0.65 + ny * 0.55)))
                    bg_r = 79 * (1 - t) + 6 * t
                    bg_g = 70 * (1 - t) + 182 * t
                    bg_b = 229 * (1 - t) + 212 * t

                    # Subtle top-left gloss highlight
                    gloss = max(0.0, 0.28 - math.hypot(nx - 0.28, ny - 0.22) * 0.45)
                    bg_r = min(255.0, bg_r + gloss * 140)
                    bg_g = min(255.0, bg_g + gloss * 140)
                    bg_b = min(255.0, bg_b + gloss * 140)

                    # Foreground swap arrows
                    min_dist = min(
                        point_to_segment_dist(nx, ny, x1, y1, x2, y2)
                        for (x1, y1, x2, y2) in segments_white
                    )
                    # Center spark dot
                    dot_dist = math.hypot(nx - 0.50, ny - 0.50)

                    if min_dist <= stroke_r:
                        px_r, px_g, px_b = 255.0, 255.0, 255.0
                    elif dot_dist <= stroke_r * 0.72:
                        # Golden/amber accent dot at center representing instant transform
                        px_r, px_g, px_b = 253.0, 224.0, 71.0
                    else:
                        px_r, px_g, px_b = bg_r, bg_g, bg_b

                    r_acc += px_r
                    g_acc += px_g
                    b_acc += px_b
                    a_acc += 255.0

            idx = (y * size + x) * 4
            if a_acc > 0:
                scale = a_acc / 255.0
                buf[idx] = int(min(255, round(r_acc / scale)))
                buf[idx + 1] = int(min(255, round(g_acc / scale)))
                buf[idx + 2] = int(min(255, round(b_acc / scale)))
                buf[idx + 3] = int(min(255, round(a_acc / 4.0)))

    return bytes(buf)


def generate_icons() -> None:
    os.makedirs(ICONS_DIR, exist_ok=True)
    for sz in (16, 32, 48, 128):
        out_path = os.path.join(ICONS_DIR, f"icon{sz}.png")
        write_png(out_path, sz, sz, render_icon(sz))
        print(f"Generated {out_path}")


def sync_web_runtime() -> None:
    os.makedirs(WEB_DIR, exist_ok=True)
    src = os.path.join(EXT_DIR, "content.js")
    dst = os.path.join(WEB_DIR, "translator-core.js")
    if os.path.exists(src):
        shutil.copyfile(src, dst)
        print(f"Synced {src} -> {dst}")


def package_extension_zip() -> None:
    os.makedirs(WEB_DIR, exist_ok=True)
    zip_path = os.path.join(WEB_DIR, "transflow-extension.zip")
    if not os.path.exists(os.path.join(EXT_DIR, "manifest.json")):
        print("Skipping zip packaging until manifest.json is created.")
        return
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for folder, _, files in os.walk(EXT_DIR):
            for fname in sorted(files):
                abs_path = os.path.join(folder, fname)
                rel_path = os.path.relpath(abs_path, EXT_DIR)
                zf.write(abs_path, os.path.join("transflow-extension", rel_path))
    print(f"Packaged extension -> {zip_path} ({os.path.getsize(zip_path)} bytes)")


def package_web_deploy_zip() -> None:
    deploy_zip = os.path.join(ROOT_DIR, "transflow-web-deploy.zip")
    with zipfile.ZipFile(deploy_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for folder, _, files in os.walk(WEB_DIR):
            for fname in sorted(files):
                abs_path = os.path.join(folder, fname)
                rel_path = os.path.relpath(abs_path, WEB_DIR)
                zf.write(abs_path, rel_path)
    print(f"Packaged web deploy bundle -> {deploy_zip} ({os.path.getsize(deploy_zip)} bytes)")


if __name__ == "__main__":
    generate_icons()
    sync_web_runtime()
    package_extension_zip()
    package_web_deploy_zip()
