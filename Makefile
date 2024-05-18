ROOT := $(shell git rev-parse --show-toplevel)

export PATCH_DIR  := $(ROOT)/patches
export VENDOR_DIR := $(ROOT)/vendor/github.com/pulumi/ci-mgmt

all:
	@echo 'Pick a better target silly'

.PHONY: reset clean
reset:
	cd ${VENDOR_DIR} && git reset --hard
clean: reset
	find ${PATCH_DIR} -type f -name '*.patch'

.PHONY: prepare patches
prepare: reset scripts/apply_patches.sh
	@${ROOT}/scripts/apply_patches.sh
patches: scripts/patches_from_worktree.sh
	@${ROOT}/scripts/patches_from_worktree.sh

$(ROOT)/%: $(VENDOR_DIR)/%
	@mkdir -p "$$(dirname $@)" && cp $< $@
