ROOT := $(shell git rev-parse --show-toplevel)

export PATCH_DIR  := $(ROOT)/patches
export VENDOR_DIR := $(ROOT)/vendor/github.com/pulumi/ci-mgmt

PATCHES       := $(shell find $(PATCH_DIR) -type f -name '*.patch')
MANAGED_FILES := $(patsubst $(PATCH_DIR)/%.patch,$(ROOT)/%,$(PATCHES))

.PHONY: all list
all:
	@echo 'Pick a better target silly'
list:
	@echo '$(MANAGED_FILES)' | tr ' ' '\n'

.PHONY: prepare copy update
prepare: apply_patches
copy: prepare $(MANAGED_FILES)
update: copy reset

.PHONY: reset clean
reset:
	cd ${VENDOR_DIR} && git reset --hard
clean: reset
	find ${PATCH_DIR} -type f -name '*.patch'

.PHONY: apply_patches patches_from_worktree
apply_patches: reset scripts/apply_patches.sh
	@${ROOT}/scripts/apply_patches.sh
patches_from_worktree: scripts/patches_from_worktree.sh
	@${ROOT}/scripts/patches_from_worktree.sh

$(ROOT)/%: $(VENDOR_DIR)/%
	@mkdir -p "$$(dirname $@)" && cp $< $@
