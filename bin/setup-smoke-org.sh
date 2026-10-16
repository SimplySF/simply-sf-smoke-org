#!/usr/bin/env bash
# Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
set -euo pipefail
cd "$(dirname "$0")/.."
bash bin/setup-aep.sh "$@"
target_org=simply-smoke-org
if [[ $# -gt 0 && "$1" != --* ]]; then
  target_org="$1"
fi
node scripts/setup-community.mjs "$target_org"
