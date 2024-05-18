#!/bin/bash

if [ ! -d "${PATCH_DIR:-}" ]; then
	echo "Invalid patch dir: ${PATCH_DIR:-<unspecified>}"
	exit 1
fi

if [ ! -d "${VENDOR_DIR:-}" ]; then
	echo "Invalid vendor dir: ${VENDOR_DIR:-<unspecified>}"
	exit 1
fi

(
	pushd "$VENDOR_DIR" >/dev/null || exit
	trap 'popd >/dev/null' EXIT

	while IFS= read -r file; do
		outfile=$"$PATCH_DIR/$file.patch"
		mkdir -p "$(dirname "$outfile")"
		git --no-pager diff --submodule=diff -- "$file" > "$outfile"
	done <<< "$(git --no-pager diff --name-only)"
)