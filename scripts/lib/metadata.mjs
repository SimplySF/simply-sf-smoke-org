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
export const metadataTypes = ['ApplicationFactory_ServiceBinding', 'ApplicationFactory_SelectorBinding',
  'ApplicationFactory_DomainBinding', 'ApplicationFactory_UnitOfWorkBinding', 'DomainProcessBinding',
  'SelectorConfig_FieldSetInclusion', 'PlatformEvents_Subscription'];
export function isRunMetadata(name) {
  return name.startsWith('SSO_Run_') || name.startsWith('SSO_Gen') || name.startsWith('SSOGen') || name === 'SSO_Aep_Gen';
}
export function isGeneratedApex(name) {
  return /^(?:I?SSO_Gen|I?SSOGen)/.test(name);
}
export function manifest(groups) {
  const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const types = Object.entries(groups).filter(([, names]) => names.length).map(([type, names]) =>
    `<types>${names.map((name) => `<members>${escape(name)}</members>`).join('')}<name>${type}</name></types>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">${types}<version>63.0</version></Package>\n`;
}
