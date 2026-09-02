#!/usr/bin/env bash
set -euo pipefail

if [[ "${AISTUDIO_ALLOW_LEGACY_WEB_PACKAGE:-0}" != "1" ]]; then
  echo "Studio Web packaging is historical compatibility only; production release is native Android." >&2
  echo "Set AISTUDIO_ALLOW_LEGACY_WEB_PACKAGE=1 only for explicit legacy reproduction." >&2
  exit 2
fi

DIST_DIR="${1:-apps/studio-web/dist}"
RELEASE_DIR="${2:-release}"
PACKAGE_DIR="${RELEASE_DIR}/legacy-web-package"
ARCHIVE_NAME="AI-Animation-Studio-Legacy-Web-Compatibility.zip"
ARCHIVE_PATH="${RELEASE_DIR}/${ARCHIVE_NAME}"

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "Missing legacy Studio Web dist: ${DIST_DIR}" >&2
  exit 1
fi

for required in \
  "${RELEASE_DIR}/legacy-studio-web-manifest.json" \
  "${RELEASE_DIR}/legacy-studio-web-files.sha256"; do
  if [[ ! -f "${required}" ]]; then
    echo "Missing legacy compatibility metadata: ${required}" >&2
    exit 1
  fi
done

for command in zip unzip sha256sum; do
  command -v "${command}" >/dev/null 2>&1 || { echo "The '${command}' command is required." >&2; exit 1; }
done

rm -rf "${PACKAGE_DIR}" "${ARCHIVE_PATH}" "${ARCHIVE_PATH}.sha256"
mkdir -p "${PACKAGE_DIR}/studio-web"
cp -R "${DIST_DIR}/." "${PACKAGE_DIR}/studio-web/"
cp "${RELEASE_DIR}/legacy-studio-web-manifest.json" "${PACKAGE_DIR}/"
cp "${RELEASE_DIR}/legacy-studio-web-files.sha256" "${PACKAGE_DIR}/"

SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-315532800}"
[[ "${SOURCE_DATE_EPOCH}" =~ ^[0-9]+$ ]] || { echo "SOURCE_DATE_EPOCH must be an integer Unix timestamp." >&2; exit 1; }
find "${PACKAGE_DIR}" -type f -exec touch -d "@${SOURCE_DATE_EPOCH}" {} +

(
  cd "${PACKAGE_DIR}"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 zip -X -q "../${ARCHIVE_NAME}"
)
unzip -tq "${ARCHIVE_PATH}" >/dev/null
(
  cd "${RELEASE_DIR}"
  sha256sum "${ARCHIVE_NAME}" > "${ARCHIVE_NAME}.sha256"
  sha256sum -c "${ARCHIVE_NAME}.sha256"
)

echo "Legacy Web compatibility package created at ${ARCHIVE_PATH}. It is NOT a production release candidate."
