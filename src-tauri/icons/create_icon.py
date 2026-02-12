import struct

# Create a minimal 16x16 ICO file
width, height = 16, 16
pixels = bytearray([0, 0, 255, 255] * (width * height))  # Blue pixels (BGRA)

# ICO header
ico_header = struct.pack('<HHH', 0, 1, 1)  # Reserved, Type (1=ICO), Count

# Image directory entry
bpp = 32
size = 40 + len(pixels)  # BITMAPINFOHEADER + pixel data
offset = 6 + 16  # After header and directory
dir_entry = struct.pack('<BBBBHHII', width, height, 0, 0, 1, bpp, size, offset)

# BITMAPINFOHEADER
bmp_header = struct.pack('<IIIHHIIIIII', 
    40,  # Header size
    width, height * 2,  # Width, Height (doubled for ICO)
    1, bpp,  # Planes, Bits per pixel
    0, len(pixels),  # Compression, Image size
    0, 0, 0, 0  # X/Y pixels per meter, Colors used, Important colors
)

with open('icon.ico', 'wb') as f:
    f.write(ico_header)
    f.write(dir_entry)
    f.write(bmp_header)
    f.write(pixels)

print("Icon created successfully")
