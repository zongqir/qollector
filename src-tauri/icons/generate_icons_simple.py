#!/usr/bin/env python3
"""
Simplified icon generator using PIL only
Creates basic PNG icons from SVG (requires manual SVG to PNG conversion first)
"""

from PIL import Image, ImageDraw, ImageFont
import os

ICON_DIR = os.path.dirname(__file__)

def create_gradient_icon(size, output_path):
    """Create a gradient icon with clipboard design"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Scale factor
    s = size / 512

    # Background gradient (approximate with solid color)
    bg_color = (102, 126, 234)  # #667eea
    draw.rounded_rectangle([(0, 0), (size, size)], radius=int(115*s), fill=bg_color)

    # Clipboard body
    clip_x = int(140 * s)
    clip_y = int(120 * s)
    clip_w = int(232 * s)
    clip_h = int(300 * s)
    draw.rounded_rectangle(
        [(clip_x, clip_y), (clip_x + clip_w, clip_y + clip_h)],
        radius=int(20*s),
        fill=(255, 255, 255, 240)
    )

    # Clipboard clip
    clip_top_x = int(210 * s)
    clip_top_y = int(100 * s)
    clip_top_w = int(92 * s)
    clip_top_h = int(40 * s)
    draw.rounded_rectangle(
        [(clip_top_x, clip_top_y), (clip_top_x + clip_top_w, clip_top_y + clip_top_h)],
        radius=int(8*s),
        fill=(90, 103, 216)
    )

    # Inner clip
    inner_x = int(220 * s)
    inner_y = int(105 * s)
    inner_w = int(72 * s)
    inner_h = int(30 * s)
    draw.rounded_rectangle(
        [(inner_x, inner_y), (inner_x + inner_w, inner_y + inner_h)],
        radius=int(6*s),
        fill=(76, 81, 191)
    )

    # Document lines
    line_color = (102, 126, 234, 76)
    lines = [
        (int(180*s), int(180*s), int(152*s), int(12*s)),
        (int(180*s), int(210*s), int(120*s), int(12*s)),
        (int(180*s), int(240*s), int(140*s), int(12*s)),
    ]
    for x, y, w, h in lines:
        draw.rounded_rectangle([(x, y), (x + w, y + h)], radius=int(6*s), fill=line_color)

    # Box indicators
    box_color = (90, 103, 216, 102)
    boxes = [
        (int(180*s), int(300*s)),
        (int(236*s), int(300*s)),
        (int(292*s), int(300*s)),
    ]
    box_size = int(40*s)
    for x, y in boxes:
        draw.rounded_rectangle([(x, y), (x + box_size, y + box_size)], radius=int(8*s), fill=box_color)

    # Accent dot
    dot_x = int(340 * s)
    dot_y = int(160 * s)
    dot_r = int(16 * s)
    draw.ellipse([(dot_x - dot_r, dot_y - dot_r), (dot_x + dot_r, dot_y + dot_r)], fill=(245, 101, 101))

    img.save(output_path, 'PNG')
    print(f"Generated: {os.path.basename(output_path)} ({size}x{size})")

def create_ico_from_pngs(png_paths, output_path):
    """Create ICO file from multiple PNG files"""
    images = [Image.open(p) for p in png_paths]
    images[0].save(
        output_path,
        format='ICO',
        sizes=[(img.width, img.height) for img in images],
        append_images=images[1:]
    )
    print(f"Generated: {os.path.basename(output_path)} (multi-size ICO)")

def main():
    print("Generating icons...")
    print()

    # Generate PNG sizes
    sizes = [32, 64, 128, 256, 512]
    png_files = []

    for size in sizes:
        output = os.path.join(ICON_DIR, f"{size}x{size}.png")
        create_gradient_icon(size, output)
        png_files.append(output)

        if size == 128:
            output_2x = os.path.join(ICON_DIR, "128x128@2x.png")
            create_gradient_icon(256, output_2x)

    # Main icon
    create_gradient_icon(512, os.path.join(ICON_DIR, "icon.png"))

    # Create ICO
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_pngs = []
    for size in ico_sizes:
        temp_path = os.path.join(ICON_DIR, f"temp_{size}.png")
        create_gradient_icon(size, temp_path)
        ico_pngs.append(temp_path)

    create_ico_from_pngs(ico_pngs, os.path.join(ICON_DIR, "icon.ico"))

    # Clean up temp files
    for temp in ico_pngs:
        os.remove(temp)

    # Windows Store icons
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
        (50, "StoreLogo.png"),
    ]

    for size, filename in store_sizes:
        create_gradient_icon(size, os.path.join(ICON_DIR, filename))

    print()
    print("All icons generated successfully!")

if __name__ == "__main__":
    main()
