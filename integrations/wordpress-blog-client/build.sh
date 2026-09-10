#!/usr/bin/env bash
set -euo pipefail

plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build_dir="${plugin_dir}/build/escarlet-blog-client"
rm -rf "${plugin_dir}/build"
mkdir -p "${build_dir}"
cp -R "${plugin_dir}/escarlet-blog-client.php" "${plugin_dir}/readme.txt" "${plugin_dir}/includes" "${plugin_dir}/assets" "${build_dir}/"
(cd "${plugin_dir}/build" && zip -qr escarlet-blog-client.zip escarlet-blog-client)
echo "${plugin_dir}/build/escarlet-blog-client.zip"
