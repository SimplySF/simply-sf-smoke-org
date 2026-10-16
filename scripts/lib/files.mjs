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
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function filesUnder(directory, prefix = '', { ignored = [] } = {}) {
  let entries;
  try { entries = await readdir(resolve(directory, prefix), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (ignored.includes(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesUnder(directory, path, { ignored }));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}
export async function compareTrees(left, right) {
  const paths = new Set([...await filesUnder(left), ...await filesUnder(right)]);
  const differences = [], cmdtDifferences = [];
  for (const path of [...paths].sort()) {
    const read = async (dir) => { try { return await readFile(resolve(dir, path), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
    if (await read(left) !== await read(right)) (path.endsWith('.md-meta.xml') ? cmdtDifferences : differences).push(path);
  }
  return { differences, cmdtDifferences };
}
