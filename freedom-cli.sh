#!/bin/bash
# Resize terminal window to 120x34
printf '\033[8;34;120t'
# Give terminal time to resize
sleep 0.1
# Run the CLI
cd "$(dirname "$0")"
npm start
