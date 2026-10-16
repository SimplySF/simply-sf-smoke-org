#!/usr/bin/env bash
# Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
set -euo pipefail
cd "$(dirname "$0")/.."
alias_name=${1:-simply-smoke-org}
create_args=(org create scratch --definition-file config/project-scratch-def.json --duration-days 7 --alias "$alias_name" --wait 30 --json)
if [[ -n ${DEV_HUB_ALIAS:-} ]]; then
  create_args+=(--target-dev-hub "$DEV_HUB_ALIAS")
fi
sf "${create_args[@]}" | node scripts/require-sf-success.mjs
bash bin/setup-smoke-org.sh "$alias_name"
