#!/usr/bin/env bash
set -euo pipefail

DIST_DIR="${1:-apps/studio-web/dist}"
RELEASE_DIR="${2:-release}"
PACKAGE_DIR="${RELEASE_DIR}/package"
ARCHIVE_NAME="AI-Animation-Studio-Web-RC.zip"
ARCHIVE_PATH="${RELEASE_DIR}/${ARCHIVE_NAME}"

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "Missing Studio Web dist: ${DIST_DIR}" >&2
  exit 1
fi

for required in \
  "${RELEASE_DIR}/studio-web-release-manifest.json" \
  "${RELEASE_DIR}/studio-web-files.sha256"; do
  if [[ ! -f "${required}" ]]; then
    echo "Missing release metadata: ${required}" >&2
    exit 1
  fi
done

if ! command -v zip >/dev/null 2>&1; then
  echo "The 'zip' command is required to package the release candidate." >&2
  exit 1
fi

rm -rf "${PACKAGE_DIR}" "${ARCHIVE_PATH}" "${ARCHIVE_PATH}.sha256"
mkdir -p "${PACKAGE_DIR}/studio-web"
cp -R "${DIST_DIR}/." "${PACKAGE_DIR}/studio-web/"
cp "${RELEASE_DIR}/studio-web-release-manifest.json" "${PACKAGE_DIR}/"
cp "${RELEASE_DIR}/studio-web-files.sha256" "${PACKAGE_DIR}/"

SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-315532800}"
if ! [[ "${SOURCE_DATE_EPOCH}" =~ ^[0-9]+$ ]]; then
  echo "SOURCE_DATE_EPOCH must be an integer Unix timestamp." >&2
  exit 1
fi

find "${PACKAGE_DIR}" -type f -exec touch -d "@${SOURCE_DATE_EPOCH}" {} +

(
  cd "${PACKAGE_DIR}"
  find . -type f -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 zip -X -q "../${ARCHIVE_NAME}"
)

unzip -tq "${ARCHIVE_PATH}" >/dev/null
sha256sum "${ARCHIVE_PATH}" > "${ARCHIVE_PATH}.sha256"
sha256sum -c "${ARCHIVE_PATH}.sha256"

echo "Release candidate packaged at ${ARCHIVE_PATH}"
