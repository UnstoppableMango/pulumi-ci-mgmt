#!/bin/bash

if [ ! -d "${PATCH_DIR:-}" ]; then
	echo "Invalid patch dir: ${PATCH_DIR:-<unspecified>}"
	exit 1
fi

if [ ! -d "${VENDOR_DIR:-}" ]; then
	echo "Invalid vendor dir: ${VENDOR_DIR:-<unspecified>}"
	exit 1
fi

find "$PATCH_DIR" -type f -name '*.patch' \
	-exec cd "$VENDOR_DIR" \; -a -exec git apply '{}' \;
