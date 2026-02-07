#!/bin/bash

# Define the source file
SOURCE="icon.png"

# Check if source exists
if [ ! -f "$SOURCE" ]; then
    echo "Error: $SOURCE not found."
    exit 1
fi

# Array of base sizes (standard resolution)
SIZES=(16 32 128 256 512)

echo "Generating icons..."

for SIZE in "${SIZES[@]}"; do
    # 1. Generate standard resolution (1x)
    # Example: icon_128x128.png
    magick "$SOURCE" -resize "${SIZE}x${SIZE}" "icon_${SIZE}x${SIZE}.png"
    
    # 2. Generate high resolution (2x)
    # Example: icon_128x128@2x.png (which is actually 256x256)
    DOUBLE_SIZE=$((SIZE * 2))
    magick "$SOURCE" -resize "${DOUBLE_SIZE}x${DOUBLE_SIZE}" "icon_${SIZE}x${SIZE}@2x.png"
    
    echo "Created ${SIZE}x${SIZE} and ${SIZE}x${SIZE}@2x"
done

echo "Done! All assets generated."