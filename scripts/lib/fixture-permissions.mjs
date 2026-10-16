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
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { filesUnder } from './files.mjs';

export async function checkFixturePermissions(root) {
  const objects = resolve(root, 'sfdx-source/aep/main/objects');
  const permissions = await readFile(resolve(root,
    'sfdx-source/aep/main/permissionsets/SSO_Aep_Fixtures.permissionset-meta.xml'), 'utf8');
  const granted = new Set([...permissions.matchAll(/<fieldPermissions>([\s\S]*?)<\/fieldPermissions>/g)]
    .filter(([, entry]) => /<readable>\s*true\s*<\/readable>/.test(entry) && /<editable>\s*true\s*<\/editable>/.test(entry))
    .map(([, entry]) => entry.match(/<field>\s*([^<]+?)\s*<\/field>/)?.[1]));
  for (const file of await filesUnder(objects)) {
    if (!file.endsWith('__c.field-meta.xml')) continue;
    const field = await readFile(resolve(objects, file), 'utf8');
    if (/<required>\s*true\s*<\/required>/.test(field) || /<type>\s*MasterDetail\s*<\/type>/.test(field)) continue;
    const name = `${file.split('/')[0]}.${file.split('/').at(-1).replace('.field-meta.xml', '')}`;
    assert.ok(granted.has(name), `SSO_Aep_Fixtures needs readable and editable fieldPermissions for ${name}`);
  }
}
