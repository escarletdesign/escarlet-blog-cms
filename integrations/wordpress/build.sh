#!/usr/bin/env bash
set -euo pipefail

plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${plugin_dir}/.." && pwd)"
build_dir="${plugin_dir}/build/escarlet-elementor-bridge"

rm -rf "${plugin_dir}/build"
mkdir -p "${build_dir}"
cp -R "${plugin_dir}/escarlet-elementor-bridge.php" "${plugin_dir}/readme.txt" "${plugin_dir}/src" "${plugin_dir}/resources" "${build_dir}/"
if [[ -d "${root_dir}/vendor" ]]; then
  cp -R "${root_dir}/vendor" "${build_dir}/"
fi
find "${build_dir}" -name '*.dist' -delete
(cd "${plugin_dir}/build" && zip -qr escarlet-elementor-bridge.zip escarlet-elementor-bridge)
echo "${plugin_dir}/build/escarlet-elementor-bridge.zip"
