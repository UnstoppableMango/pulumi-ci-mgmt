ROOT       := $(shell git rev-parse --show-toplevel)
PATCH_DIR  := $(ROOT)/patches
VENDOR_DIR := $(ROOT)/vendor/github.com/pulumi/ci-mgmt

all:
	@echo 'Pick a better target silly'

.PHONY: clean
clean:
	rm ${ROOT}/.github/workflows/pull-request.yml

.PHONY: patches
patches: patches_from_worktree
patches_from_worktree:
	cd ${VENDOR_DIR} && git --no-pager diff --name-only

.github:
	@mkdir .github
.github/workflows: .github
	@mkdir .github/workflows
.github/workflows/pull-request.yml: .github/workflows $(VENDOR_DIR)/.github/workflows/pull-request.yml
	cp $(VENDOR_DIR)/.github/workflows/pull-request.yml ${ROOT}/$@
