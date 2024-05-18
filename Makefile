ROOT := $(shell git rev-parse --show-toplevel)

export PATCH_DIR  := $(ROOT)/patches
export VENDOR_DIR := $(ROOT)/vendor/github.com/pulumi/ci-mgmt

PATCHES       := $(shell find $(PATCH_DIR) -type f -name '*.patch')
MANAGED_FILES := $(patsubst $(PATCH_DIR)/%.patch,$(ROOT)/%,$(PATCHES))

all:
	@echo 'Pick a better target silly'

.PHONY: managed
managed:
	@echo '$(MANAGED_FILES)' | tr ' ' '\n'

.PHONY: reset clean
reset:
	cd ${VENDOR_DIR} && git reset --hard
clean: reset
	find ${PATCH_DIR} -type f -name '*.patch'

.PHONY: prepare patches update
prepare: reset scripts/apply_patches.sh
	@${ROOT}/scripts/apply_patches.sh
patches: scripts/patches_from_worktree.sh
	@${ROOT}/scripts/patches_from_worktree.sh
update: $(MANAGED_FILES)

$(ROOT)/%: $(VENDOR_DIR)/%
	@mkdir -p "$$(dirname $@)" && cp $< $@
