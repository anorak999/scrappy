#!/bin/bash
# Icon generation script for Scrappy
# Requires Inkscape or similar SVG to PNG converter

# If you have Inkscape installed:
# inkscape icon.svg -w 16 -h 16 -o icon16.png
# inkscape icon.svg -w 32 -h 32 -o icon32.png
# inkscape icon.svg -w 48 -h 48 -o icon48.png
# inkscape icon.svg -w 128 -h 128 -o icon128.png

# Alternative: Use ImageMagick
# convert -background none icon.svg -resize 16x16 icon16.png
# convert -background none icon.svg -resize 32x32 icon32.png
# convert -background none icon.svg -resize 48x48 icon48.png
# convert -background none icon.svg -resize 128x128 icon128.png

echo "Please generate PNG icons from icon.svg"
echo "Sizes needed: 16x16, 32x32, 48x48, 128x128"
