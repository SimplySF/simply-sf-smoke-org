#!/usr/bin/env bash
# Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/setup-aep.mjs "$@"
