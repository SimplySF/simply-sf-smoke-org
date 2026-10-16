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
import { cp, mkdir, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../../scripts/lib/smoke.mjs';

export async function makeGitFixture(destination) {
  await mkdir(destination, { recursive: true });
  await cp(fileURLToPath(new URL('project/', import.meta.url)), destination, { recursive: true });
  const git = async (...args) => {
    const result = await run('git', args, { cwd: destination, env: { ...process.env,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } });
    if (result.exitCode !== 0) throw new Error(result.output);
  };
  await git('init');
  await git('config', 'user.name', 'Simply Smoke');
  await git('config', 'user.email', 'smoke@example.invalid');
  const source = resolve(destination, 'force-app/main/default');
  const flow = resolve(source, 'flows/SSO_LocalFlow.flow-meta.xml');
  const flowContent = await readFile(flow);
  await rm(flow);
  await git('add', '.');
  await git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture v1');
  await git('tag', 'v1.0.0');
  await appendFile(resolve(source, 'classes/SSO_LocalService.cls'), '// modified in v1.1.0\n');
  await writeFile(flow, flowContent);
  await rm(resolve(source, 'objects/SSO_Local__c/fields/Note__c.field-meta.xml'));
  await git('add', '.');
  await git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture v1.1');
  await git('tag', 'v1.1.0');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Pass a fresh destination under generated/local');
  await makeGitFixture(resolve(process.argv[2]));
}
