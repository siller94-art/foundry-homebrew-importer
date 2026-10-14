#!/bin/sh
# Rebuild the zip Foundry downloads (module files at the root of the zip). Run after any change, then commit the zip.
cd "$(dirname "$0")" && rm -f homebrew-importer.zip && zip -rq homebrew-importer.zip module.json README.md LICENSE scripts styles examples && echo "built homebrew-importer.zip"
