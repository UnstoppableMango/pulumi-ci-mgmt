ROOT := $(shell git rev-parse --show-toplevel)

export PATCH_DIR  := $(ROOT)/patches
export VENDOR_DIR := $(ROOT)/vendor/github.com/pulumi/ci-mgmt

all:
	@echo 'Pick a better target silly'

.PHONY: clean
clean:
	rm ${ROOT}/.github/workflows/pull-request.yml

.PHONY: prepare patches
prepare: scripts/apply_patches.sh
	@${ROOT}/scripts/apply_patches.sh
patches: scripts/patches_from_worktree.sh
	@${ROOT}/scripts/patches_from_worktree.sh

.github/workflows/pull-request.yml: $(VENDOR_DIR)/.github/workflows/pull-request.yml
	cp $(VENDOR_DIR)/.github/workflows/pull-request.yml ${ROOT}/$@
