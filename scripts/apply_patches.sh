#!/bin/bash

if [ ! -d "${PATCH_DIR:-}" ]; then
	echo "Invalid patch dir: ${PATCH_DIR:-<unspecified>}"
	exit 1
fi

if [ ! -d "${VENDOR_DIR:-}" ]; then
	echo "Invalid vendor dir: ${VENDOR_DIR:-<unspecified>}"
	exit 1
fi

pushd "$VENDOR_DIR" >/dev/null || exit 1
trap 'popd >/dev/null' EXIT

if [ -n "$(git status -s)" ]; then
	echo 'Submodule is not clean'
	exit 1
fi

find "$PATCH_DIR" -type f -name '*.patch' \
	-exec git apply '{}' \; \
	-print
