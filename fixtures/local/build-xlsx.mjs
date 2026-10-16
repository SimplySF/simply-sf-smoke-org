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
// Manual fixture rebuild only; reuses exceljs from the linked schema checkout.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const plugins = process.env.SIMPLY_PLUGINS_DIR;
if (!plugins) throw new Error('Set SIMPLY_PLUGINS_DIR to the built monorepo');
const require = createRequire(resolve(plugins, 'packages/simply-schema/package.json'));
const ExcelJS = require('exceljs');
const workbook = new ExcelJS.Workbook();
workbook.created = new Date('2026-10-15T00:00:00Z');
workbook.modified = workbook.created;
const object = workbook.addWorksheet('object');
for (const row of [
  ['apiName', 'SSO_Schema_Xlsx__c'], ['App_Prefix', 'SSO'],
  ['label', 'SSO Schema Excel'], ['pluralLabel', 'SSO Schema Excels'],
  ['nameFieldType', 'Text'], ['sharingModel', 'ReadWrite'], ['visibility', 'Public'],
]) object.addRow(row);
const fields = workbook.addWorksheet('fields');
fields.addRow(['label', 'apiName_optional', 'type', 'length']);
fields.addRow(['Note', 'SSO_Note__c', 'Text', '80']);
await workbook.xlsx.writeFile(fileURLToPath(new URL('schema.xlsx', import.meta.url)));
