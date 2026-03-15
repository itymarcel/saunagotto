#!/usr/bin/env bash
# Extracts JPEG frames from ocean.mp4 for the scrubbing sequence.
# Run once from the project root, then deploy the ocean/ directory.
#
# Requirements: ffmpeg (brew install ffmpeg)
# Output:       ocean/f0001.jpg … ocean/fNNNN.jpg
# After running: update TOTAL_FRAMES in ocean.js to the printed count.

set -e

mkdir -p ocean

echo "Extracting frames at 24 fps, 1280×720 …"
ffmpeg -i ocean.mp4 \
  -vf "fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
  -q:v 2 \
  ocean/f%04d.jpg

COUNT=$(ls ocean/f*.jpg | wc -l | tr -d ' ')
echo ""
echo "Done — $COUNT frames written to ocean/"
echo "→ Open ocean.js and set:  const TOTAL_FRAMES = $COUNT;"
