#!/usr/bin/env python3
"""
Generate all required icon formats from icon.svg
Requires: pip install cairosvg pillow
"""

import os
from pathlib import Path

try:
    import cairosvg
    from PIL import Image
    import io
except ImportError:
    print("Error: Required packages not installed")
    print("Please run: pip install cairosvg pillow")
    exit(1)

ICON_DIR = Path(__file__).parent
SVG_FILE = ICON_DIR / "icon.svg"

# Icon sizes needed
PNG_SIZES = [32, 64, 128, 256, 512]
ICO_SIZES = [16, 32, 48, 64, 128, 256]

def svg_to_png(svg_path, output_path, size):
    """Convert SVG to PNG at specified size"""
    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(output_path),
        output_width=size,
        output_height=size
    )
    print(f"Generated: {output_path.name} ({size}x{size})")

def create_ico(sizes, output_path):
    """Create ICO file with multiple sizes"""
    images = []
    for size in sizes:
        png_bytes = cairosvg.svg2png(
            url=str(SVG_FILE),
            output_width=size,
            output_height=size
        )
        img = Image.open(io.BytesIO(png_bytes))
        images.append(img)

    # Save as ICO with all sizes
    images[0].save(
        output_path,
        format='ICO',
        sizes=[(img.width, img.height) for img in images],
        append_images=images[1:]
    )
    print(f"Generated: {output_path.name} (multi-size ICO)")

def create_icns(output_path):
    """Create ICNS file for macOS"""
    # Generate temporary PNGs for iconutil
    iconset_dir = ICON_DIR / "icon.iconset"
    iconset_dir.mkdir(exist_ok=True)

    # macOS icon sizes
    icns_sizes = [
        (16, "16x16"),
        (32, "16x16@2x"),
        (32, "32x32"),
        (64, "32x32@2x"),
        (128, "128x128"),
        (256, "128x128@2x"),
        (256, "256x256"),
        (512, "256x256@2x"),
        (512, "512x512"),
        (1024, "512x512@2x"),
    ]

    for size, name in icns_sizes:
        png_path = iconset_dir / f"icon_{name}.png"
        svg_to_png(SVG_FILE, png_path, size)

    # Use iconutil to create ICNS (macOS only)
    import subprocess
    try:
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(output_path)],
            check=True
        )
        print(f"Generated: {output_path.name} (ICNS)")
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Warning: iconutil not available (macOS only), skipping ICNS generation")

    # Clean up iconset directory
    import shutil
    shutil.rmtree(iconset_dir)

def main():
    print("Generating icons from icon.svg...")
    print()

    # Generate standard PNG sizes
    for size in PNG_SIZES:
        output = ICON_DIR / f"{size}x{size}.png"
        svg_to_png(SVG_FILE, output, size)

        # Also generate @2x version for 128x128
        if size == 128:
            output_2x = ICON_DIR / "128x128@2x.png"
            svg_to_png(SVG_FILE, output_2x, 256)

    # Generate icon.png (main icon, 512x512)
    svg_to_png(SVG_FILE, ICON_DIR / "icon.png", 512)

    # Generate ICO file for Windows
    create_ico(ICO_SIZES, ICON_DIR / "icon.ico")

    # Generate ICNS file for macOS
    create_icns(ICON_DIR / "icon.icns")

    # Generate Windows Store icons
    store_sizes = [
        (30, "Square30x30Logo.png"),
        (44, "Square44x44Logo.png"),
        (71, "Square71x71Logo.png"),
        (89, "Square89x89Logo.png"),
        (107, "Square107x107Logo.png"),
        (142, "Square142x142Logo.png"),
        (150, "Square150x150Logo.png"),
        (284, "Square284x284Logo.png"),
        (310, "Square310x310Logo.png"),
    ]

    for size, filename in store_sizes:
        svg_to_png(SVG_FILE, ICON_DIR / filename, size)

    # Generate StoreLogo
    svg_to_png(SVG_FILE, ICON_DIR / "StoreLogo.png", 50)

    print()
    print("All icons generated successfully!")

if __name__ == "__main__":
    main()
