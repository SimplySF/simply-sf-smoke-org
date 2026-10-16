#!/usr/bin/env bash
# Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
set -euo pipefail
cd "$(dirname "$0")/.."
bash bin/setup-aep.sh "$@"
node scripts/setup-community.mjs "${1:-simply-smoke-org}"
