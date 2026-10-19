#!/bin/sh
# Starts KARS on this computer. Keep this window open while you work; close it (or press Ctrl+C) to stop KARS.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Get it from https://nodejs.org and run this again."; exit 1; }
node kars-server.mjs
