from cairosvg import svg2png
import os

# Define the sizes we need
sizes = [16, 48, 128]

# Read the SVG file
with open('icon.svg', 'rb') as svg_file:
    svg_content = svg_file.read()

# Generate PNG files for each size
for size in sizes:
    svg2png(bytestring=svg_content,
            write_to=f'icon{size}.png',
            output_width=size,
            output_height=size) 