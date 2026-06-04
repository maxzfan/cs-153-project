#!/bin/bash

# Script to prepare icon for electron-builder
# electron-builder can convert PNG to .icns automatically, but this script
# ensures the icon is in the right location and format
# Usage: ./scripts/create-icon.sh

set -e

ICON_SOURCE="0studio_mac_icon.png"
ICON_OUTPUT="assets/icon.png"

# Check if source icon exists
if [ ! -f "$ICON_SOURCE" ]; then
    echo "Error: $ICON_SOURCE not found!"
    exit 1
fi

# Create assets directory if it doesn't exist
mkdir -p assets

# Verify source icon is 1024x1024
WIDTH=$(sips -g pixelWidth "$ICON_SOURCE" | tail -1 | awk '{print $2}')
HEIGHT=$(sips -g pixelHeight "$ICON_SOURCE" | tail -1 | awk '{print $2}')

if [ "$WIDTH" != "1024" ] || [ "$HEIGHT" != "1024" ]; then
    echo "Warning: Icon is ${WIDTH}x${HEIGHT}, recommended size is 1024x1024"
    echo "Resizing to 1024x1024..."
    sips -z 1024 1024 "$ICON_SOURCE" --out "$ICON_OUTPUT"
else
    echo "Icon is already 1024x1024, copying to assets..."
    cp "$ICON_SOURCE" "$ICON_OUTPUT"
fi

echo "✅ Icon prepared: $ICON_OUTPUT"
echo ""
echo "Note: electron-builder will automatically convert PNG to .icns during build."
echo "The icon is configured in package.json and will be used when you run:"
echo "  npm run electron:dist"