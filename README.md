# Pulumi CI Management

CI automation for Pulumi providers based on <https://github.com/pulumi/ci-mgmt>.

This repo is basically a very convoluted fork.
The pulumi/ci-mgmt repo is included as a submodule under `vendor/github.com/pulumi/ci-mgmt`.

The pulumi/ci-mgmt README with actual details about what's going on can be accessed [here](/vendor/github.com/pulumi/ci-mgmt/README.md).

Modifications can be made by editing files inside the submodule to "manage" them.
I've defined a "managed" file to mean any patched or explicitly copied file from the submodule.
Managed files are then copied to this repository.

The general workflow is:

- `make prepare` to apply patches for editing
- Edit files inside the submodule
- `make patches_from_worktree` to update the patch files
- `make update` to created patched versions of all modified files

## Make Targets

`make prepare` will apply all patches from `patches` to the submodule.
This must be run before making any modifications.

`make apply_patches` will apply all patches under `patches` to the submodule.

`make patches_from_worktree` will update all patches under `patches` with the diff from the submodule.

`make update` will copy all "managed" files from the submodule to the repo.

`make reset` will reset the submodule.

`make list` will list all "managed" files.

`make clean` will remove every "managed" file and reset the submodule.
