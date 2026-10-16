/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { spawnSync } from 'node:child_process';
import { filesUnder } from './lib/files.mjs';
const files = await filesUnder(process.cwd(), '', { ignored: [
  'node_modules', '.git', '.deps', '.sf', '.sfdx', 'generated', 'reports', '.agents', '.codex', '.aws',
] });
function check(file, args) {
  const result = spawnSync(file, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const file of files.filter((file) => file.endsWith('.mjs'))) check(process.execPath, ['--check', file]);
const shells = files.filter((file) => /^bin\/.*\.sh$/.test(file));
for (const file of shells) check('bash', ['-n', file]);
const shellcheck = spawnSync('shellcheck', ['--version'], { stdio: 'ignore' });
if (shellcheck.status === 0) check('shellcheck', shells);
else if (shellcheck.error?.code !== 'ENOENT') throw shellcheck.error ?? new Error('shellcheck is installed but cannot run');
else console.log('shellcheck unavailable; bash syntax checks passed.');
check(process.execPath, ['--test', ...files.filter((file) => /^test\/.*\.test\.mjs$/.test(file))]);
