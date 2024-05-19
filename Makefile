ROOT := $(shell git rev-parse --show-toplevel)

export PATCH_DIR  := $(ROOT)/patches
export VENDOR_DIR := $(ROOT)/vendor/github.com/pulumi/ci-mgmt

PATCHES       := $(shell find $(PATCH_DIR) -type f -name '*.patch')
VENDORED      := $(shell ls -d -- $$(cat managed.txt | sed 's,^,${VENDOR_DIR}/,'))
MANAGED_FILES := $(patsubst $(PATCH_DIR)/%.patch,$(ROOT)/%,$(PATCHES))
MANAGED_FILES += $(patsubst $(VENDOR_DIR)/%,$(ROOT)/%,$(VENDORED))

.PHONY: prepare update
update: prepare $(MANAGED_FILES)
	@echo 'Resetting submodule'
	@cd ${VENDOR_DIR} && git reset --hard
prepare: apply_patches

.PHONY: list
list:
	@echo '$(MANAGED_FILES)' | tr ' ' '\n'

.PHONY: reset clean
reset:
	@cd ${VENDOR_DIR} && git reset --hard
clean: reset list
	@rm -f ${MANAGED_FILES}

.PHONY: apply_patches patches_from_worktree
apply_patches: reset scripts/apply_patches.sh
	@${ROOT}/scripts/apply_patches.sh
patches_from_worktree: scripts/patches_from_worktree.sh
	@find ${PATCH_DIR} -type f -name '*.patch' \
		-exec echo 'Removing {}' \; \
		-exec rm '{}' +
	@${ROOT}/scripts/patches_from_worktree.sh

$(ROOT)/%: $(VENDOR_DIR)/%
	@mkdir -p "$$(dirname $@)" && cp $< $@
