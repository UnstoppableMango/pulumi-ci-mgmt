#!/bin/bash

# Loosely based on https://github.com/pulumi/scripts/blob/master/ci/publish-tfgen-package

set -o errexit
set -o pipefail

if [ "$#" -ne 1 ]; then
    >&2 echo "usage: $0 <path-to-repository-root>"
    exit 1
fi

SOURCE_ROOT="$1"
VENDOR_DIR="$SOURCE_ROOT/vendor/github.com/pulumi/scripts"
SCRIPT_ROOT="$VENDOR_DIR/ci"

# Publish the NPM package.
echo "Publishing NPM package to NPMjs.com:"

# First, add an install script to our package.json
mkdir -p "${SOURCE_ROOT}/sdk/nodejs/bin/scripts"
cp "${SCRIPT_ROOT}/install-pulumi-plugin.js" \
	"${SOURCE_ROOT}/sdk/nodejs/bin/scripts"
node "${SCRIPT_ROOT}/add-plugin-installer-script.js" < \
	"${SOURCE_ROOT}/sdk/nodejs/bin/package.json" > \
	"${SOURCE_ROOT}/sdk/nodejs/bin/package.json.publish"
pushd "${SOURCE_ROOT}/sdk/nodejs/bin"
mv package.json package.json.dev
mv package.json.publish package.json

NPM_TAG="dev"

## We need split the GITHUB_REF into the correct parts
## so that we can test for NPM Tags
IFS='/' read -ra my_array <<< "${GITHUB_REF:-}"
BRANCH_NAME="${my_array[2]}"

if [[ "${BRANCH_NAME}" == features/* ]]; then
	NPM_TAG="${BRANCH_NAME//features\//feature-}"
fi

if [[ "${BRANCH_NAME}" == feature-* ]]; then
	NPM_TAG="${BRANCH_NAME}"
fi

# If the package doesn't have a pre-release tag, use the tag of latest instead of
# dev. NPM uses this tag as the default version to add, so we want it to mean
# the newest released version.
PKG_NAME=$(jq -r .name < package.json)
PKG_VERSION=$(jq -r .version < package.json)
if [[ "${PKG_VERSION}" != *-dev* ]] && [[ "${PKG_VERSION}" != *-alpha* ]]; then
	NPM_TAG="latest"
fi

# we need to set explicit beta and rc tags to ensure that we don't mutate to use the latest tag
if [[ "${PKG_VERSION}" == *-beta* ]]; then
	NPM_TAG="beta"
fi

if [[ "${PKG_VERSION}" == *-rc* ]]; then
	NPM_TAG="rc"
fi

# Now, perform the publish. The logic here is a little goofy because npm provides
# no way to say "if the package already exists, don't fail" but we want these
# semantics (so, for example, we can restart builds which may have failed after
# publishing, or so two builds can run concurrently, which is the case for when we
# tag master right after pushing a new commit and the push and tag travis jobs both
# get the same version.
#
# We exploit the fact that `npm info <package-name>@<package-version>` has no output
# when the package does not exist.
if [ "$(npm info "${PKG_NAME}@${PKG_VERSION}")" == "" ]; then
	if ! npm publish -tag "${NPM_TAG}"; then
	# if we get here, we have a TOCTOU issue, so check again
	# to see if it published. If it didn't bail out.
	if [ "$(npm info "${PKG_NAME}@${PKG_VERSION}")" == "" ]; then
	echo "NPM publishing failed, aborting"
	exit 1
	fi

fi
fi
npm info 2>/dev/null

# And finally restore the original package.json.
mv package.json package.json.publish
mv package.json.dev package.json
popd

# Next, publish the PyPI package, if we didn't opt out.
#
# The precondition is that ${SOURCE_ROOT}/sdk/python/bin/dist/ contains one or more prebuilt files:
#
#     - source distribution, such as pulumi_kubernetes-4.2.0.tar.gz
#     - wheel distribution, such as pulumi_kubernetes-4.2.0-py3-none-any.whl
#
# There are various ways to produce these distirbutions from source. One of the simplest one is:
#
#     python -m build .
#
# See also:
#
#     - https://twine.readthedocs.io/en/stable/ for details on how `twine upload` works.
#     - https://pypa-build.readthedocs.io/en/latest/ docs on the build module
if [ -n "${NO_TFGEN_PYTHON_PACKAGE}" ] ; then
	echo "Skipping publishing pip package because of NO_TFGEN_PYTHON_PACKAGE"
# Projects that set PYPI_PUBLISH_ARTIFACTS=all will publish both source and wheel distirbutions
# (dist/*) if built; this is currently preferred for Pulumi as we want the users to get wheel
# distributions by default but still support users that perform source-only installs as in:
#
#     pip install --no-binary :all: pulumi-kubernetes==4.1.0
#
# This behavior is gated by a flag until all Pulumi repositories get compatible.
elif [[ "${PYPI_PUBLISH_ARTIFACTS:-}" == "all" ]]; then
	echo "Publishing Pip package to pypi as ${PYPI_USERNAME}:"
	echo "Distributions:"
	ls ${SOURCE_ROOT}/sdk/python/bin/dist/*
	twine upload \
		-u "${PYPI_USERNAME}" -p "${PYPI_PASSWORD}" \
		"${SOURCE_ROOT}/sdk/python/bin/dist/*" \
		--skip-existing \
		--verbose
# Projects that set PYPI_PUBLISH_ARTIFACTS=wheel will only publish the wheel distribution. This
# is currently not recommended.
elif [[ "${PYPI_PUBLISH_ARTIFACTS:-}" == "wheel" ]]; then
	echo "Publishing Pip wheel package to pypi as ${PYPI_USERNAME}:"
	twine upload \
		-u "${PYPI_USERNAME}" -p "${PYPI_PASSWORD}" \
		"${SOURCE_ROOT}/sdk/python/bin/dist/*.whl" \
		--skip-existing \
		--verbose
# By default projects will only publish the source distribution. This maintains legacy behavior.
# Once all projects migrate to PYPI_PUBLISH_ARTIFACTS=all this may be made irrelevant.
else
	echo "Publishing Pip package to pypi as ${PYPI_USERNAME}:"
	twine upload \
		-u "${PYPI_USERNAME}" -p "${PYPI_PASSWORD}" \
		"${SOURCE_ROOT}/sdk/python/bin/dist/*.tar.gz" \
		--skip-existing \
		--verbose
fi

# Finally, publish the NuGet package if any exists.
if [ -n "${NUGET_PUBLISH_KEY}" ]; then
	find "${SOURCE_ROOT}/sdk/dotnet/bin/Debug/" -name 'UnMango.*.nupkg' \
		-exec dotnet nuget push -k "${NUGET_PUBLISH_KEY}" -s https://api.nuget.org/v3/index.json {} ';'
fi
