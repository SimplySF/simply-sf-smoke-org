// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sfJson, run, resultFrom, runSuite, success, expectedFailure } from './lib/smoke.mjs';
import { root, parseSuiteArgs, command, linkedPlugin, queryOrg, deploySource } from './lib/apex-flow.mjs';

export const frameworkClasses = ['fflib_SObjectDescribe', 'fflib_SObjectDomain', 'ApplicationSObjectDomain',
  'di_Binding', 'di_Module', 'di_PlatformCache', 'di_Injector'];
const levelFields = ['ApexCode', 'ApexProfiling', 'Callout', 'Database', 'System', 'Validation', 'Visualforce', 'Workflow'];
const traceFields = 'Id, TracedEntityId, LogType, DebugLevelId, StartDate, ExpirationDate';
export async function prepareTraceCleanup(targetOrg, entityIds, { query = queryOrg, json = sfJson, now = Date.now } = {}) {
  assert.ok(entityIds.length > 0);
  const where = `TracedEntityId IN (${entityIds.map((id) => { assert.match(id, /^[a-zA-Z0-9]+$/); return `'${id}'`; }).join(',')})`;
  const snapshot = await query(targetOrg, `SELECT ${traceFields} FROM TraceFlag WHERE ${where}`);
  const levels = await query(targetOrg, "SELECT Id FROM DebugLevel WHERE DeveloperName IN ('ReplayDebuggerLevels','Silence')");
  return async () => {
    const errors = [], deleted = [], restored = [], deletedLevels = [];
    async function attempt(action) { try { await action(); } catch (error) { errors.push(error); } }
    const current = await query(targetOrg, `SELECT ${traceFields} FROM TraceFlag WHERE ${where}`);
    const originalIds = new Set(snapshot.map((flag) => flag.Id));
    for (const flag of current.filter((flag) => !originalIds.has(flag.Id))) {
      await attempt(async () => { await json(['data', 'delete', 'record', '-o', targetOrg, '--use-tooling-api', '--sobject', 'TraceFlag', '--record-id', flag.Id]); deleted.push(flag.Id); });
    }
    const renewedIds = new Set();
    for (const flag of snapshot) {
      const restoredAt = now();
      const needsFutureDates = Date.parse(flag.ExpirationDate) <= restoredAt + 60_000;
      const restoredFlag = needsFutureDates ? { ...flag, StartDate: new Date(restoredAt).toISOString(),
        ExpirationDate: new Date(restoredAt + 120_000).toISOString() } : flag;
      if (needsFutureDates) renewedIds.add(flag.Id);
      const values = ['DebugLevelId', 'StartDate', 'ExpirationDate'].map((key) => `${key}=${restoredFlag[key]}`).join(' ');
      await attempt(async () => { await json(['data', 'update', 'record', '-o', targetOrg, '--use-tooling-api', '--sobject', 'TraceFlag', '--record-id', flag.Id, '--values', values]); restored.push(flag.Id); });
    }
    const after = await query(targetOrg, `SELECT ${traceFields} FROM TraceFlag WHERE ${where}`);
    await attempt(async () => {
      const fields = traceFields.split(', ');
      const normalize = (flags) => flags.map((flag) => Object.fromEntries(fields
        .filter((key) => !renewedIds.has(flag.Id) || !['StartDate', 'ExpirationDate'].includes(key))
        .map((key) => [key, flag[key]]))).sort((a, b) => a.Id.localeCompare(b.Id));
      assert.deepEqual(normalize(after), normalize(snapshot), 'TraceFlag cleanup did not restore baseline');
    });
    const currentLevels = await query(targetOrg, "SELECT Id FROM DebugLevel WHERE DeveloperName IN ('ReplayDebuggerLevels','Silence')");
    for (const level of currentLevels.filter((level) => !levels.some((old) => old.Id === level.Id))) {
      await attempt(async () => {
        const references = await query(targetOrg, `SELECT Id FROM TraceFlag WHERE DebugLevelId = '${level.Id}'`);
        assert.equal(references.length, 0, 'New smoke debug level is still referenced');
        await json(['data', 'delete', 'record', '-o', targetOrg, '--use-tooling-api', '--sobject', 'DebugLevel', '--record-id', level.Id]);
        deletedLevels.push(level.Id);
      });
    }
    if (errors.length) throw new AggregateError(errors, errors.map((e) => e.message).join('\n'));
    return { deletedTraceFlagIds: deleted, restoredTraceFlagIds: restored, deletedDebugLevelIds: deletedLevels };
  };
}
export async function setupApex(targetOrg, { json = sfJson, deploy = deploySource } = {}) {
  await deploy(targetOrg, resolve(root, 'sfdx-source/apex-flow/main/classes'), { json });
  const result = await json(['apex', 'run', '-o', targetOrg, '--file', resolve(root, 'fixtures/apex/seedSmokeUsers.apex')]);
  assert.equal(result.compiled, true); assert.equal(result.success, true);
}
export function checkSuiteMembers(xml, names) {
  const expected = ['SSO_ApexLeadingComment', 'SSO_ApexNoisyTest'];
  assert.deepEqual(names, expected);
  assert.deepEqual([...xml.matchAll(/<testClassName>([^<]+)<\/testClassName>/g)].map((m) => m[1]).sort(), expected);
  return true;
}
export function buildApexTests({ targetOrg = 'simply-smoke-org', context, runner = run, json = sfJson, query = queryOrg, deploy = deploySource } = {}) {
  const cmd = (verb, flags = []) => command('apex', verb, verb === 'test-suite generate' ? undefined : targetOrg, flags);
  const ensureTrace = () => json(cmd('trace setup')[1].slice(0, -1));
  const executeOk = async () => {
    await ensureTrace();
    return json(cmd('execute', ['--file', resolve(root, 'fixtures/apex/ok.apex')])[1].slice(0, -1));
  };
  const tests = [];
  let firstTraceId;
  function setupCase(name, behalf) {
    return success(name, async (e) => {
      const result = resultFrom(e.stdout);
      const id = behalf ? context.userId : context.adminId;
      assert.equal(result.userId, id);
      const flags = await query(targetOrg, `SELECT ${traceFields} FROM TraceFlag WHERE TracedEntityId = '${id}' AND LogType = 'DEVELOPER_LOG'`);
      assert.equal(flags.length, 1); assert.equal(flags[0].Id, result.traceFlagId);
      assert.equal(flags[0].DebugLevelId, result.debugLevelId);
      assert.ok(Math.abs(Date.parse(flags[0].ExpirationDate) - Date.now() - 86400_000) < 5 * 60_000);
      const levels = await query(targetOrg, `SELECT DeveloperName FROM DebugLevel WHERE Id = '${result.debugLevelId}'`);
      assert.equal(levels[0]?.DeveloperName, 'ReplayDebuggerLevels');
      if (name.startsWith('05')) assert.equal(result.traceFlagId, firstTraceId);
      if (name.startsWith('04')) firstTraceId = result.traceFlagId;
      return true;
    }, cmd('trace setup', behalf ? ['--on-behalf-of', `Username:${context.username}`] : []));
  }
  tests.push(setupCase('04 trace setup running user', false), setupCase('05 trace setup updates existing flag', false),
    setupCase('06 trace setup on behalf of seeded user', true),
    expectedFailure('07 trace setup rejects reversed dates', /--end-date.*must be after --start-date/i,
      cmd('trace setup', ['--start-date', '2099-01-02T00:00:00Z', '--end-date', '2099-01-01T00:00:00Z'])),
    success('01 execute compiles and runs', async (e) => {
      const result = resultFrom(e.stdout);
      assert.equal(result.compiled, true); assert.equal(result.success, true);
      assert.match(result.logs, /SSO_APEX_PING/);
      const logs = await query(targetOrg, `SELECT Id FROM ApexLog WHERE LogUserId = '${context.adminId}' AND StartTime >= ${context.startedAt}`);
      assert.ok(logs.length > 0, 'Anonymous execution must produce an org log');
      return true;
    }, cmd('execute', ['--file', resolve(root, 'fixtures/apex/ok.apex')])),
    expectedFailure('02 execute surfaces compile diagnostic', /Compilation failed at line 1, column \d+.*SSO_Missing_Type/i,
      cmd('execute', ['--file', resolve(root, 'fixtures/apex/compile-error.apex')])),
    expectedFailure('03 execute surfaces exception', /Execution failed.*SSO_EXPECTED_EXCEPTION/i,
      cmd('execute', ['--file', resolve(root, 'fixtures/apex/throws.apex')])));
  for (const [name, flags, classes] of [
    ['08 trace silence explicit class', ['--classes', 'SSO_ApexNoisy'], ['SSO_ApexNoisy']],
    ['09 trace silence classes file', ['--classes-file', resolve(root, 'fixtures/apex/silence.json')], ['SSO_ApexNoisy', 'SSO_ApexNoisyTest']],
    ['10 trace silence framework classes', ['--fflib', '--at4dx', '--force-di'], frameworkClasses],
  ]) tests.push(success(name, async (e) => {
    const result = resultFrom(e.stdout);
    assert.deepEqual(result.map((v) => v.class).sort(), [...classes].sort());
    for (const entry of result) {
      assert.equal(entry.classId, context.classIds[entry.class]);
      const records = await query(targetOrg, `SELECT ${traceFields} FROM TraceFlag WHERE Id = '${entry.traceFlagId}'`);
      assert.equal(records.length, 1); assert.equal(records[0].TracedEntityId, entry.classId);
      assert.equal(records[0].LogType, 'CLASS_TRACING');
      const levels = await query(targetOrg, `SELECT ${levelFields.join(',')} FROM DebugLevel WHERE Id = '${records[0].DebugLevelId}'`);
      assert.equal(levels.length, 1);
      for (const field of levelFields) assert.equal(levels[0][field], 'NONE');
    }
    return true;
  }, cmd('trace silence', flags)));
  tests.push(success('11 trace silence warns for missing class', (e) => {
    assert.deepEqual(resultFrom(e.stdout), []);
    assert.match(e.output, /No Apex classes found matching the provided names/i); return true;
  }, cmd('trace silence', ['--classes', 'SSO_DoesNotExist'])),
  expectedFailure('11b trace silence rejects empty selection', /No Apex classes specified to silence/i, cmd('trace silence')),
  { ...expectedFailure('11c trace silence rejects conflicting inputs', /cannot also be provided/i,
    cmd('trace silence', ['--classes', 'SSO_ApexNoisy', '--classes-file', resolve(root, 'fixtures/apex/silence.json')])), expectedExitCode: 2 });
  for (const [name, bulk] of [['12 logs purge REST', false], ['13 logs purge Bulk API', true]]) {
    let before;
    const test = success(name, async (e) => {
      const result = resultFrom(e.stdout);
      assert.deepEqual(result.map((r) => r.Id).sort(), before.map((r) => r.Id).sort());
      assert.ok(result.every((r) => r.Success === true));
      assert.deepEqual(await query(targetOrg, `SELECT Id FROM ApexLog WHERE Id IN (${before.map((r) => `'${r.Id}'`).join(',')})`), []);
      return true;
    }, cmd('logs purge'));
    test.execute = async () => {
      const startedAt = new Date(Date.now() - 2_000).toISOString();
      await executeOk();
      before = await query(targetOrg, `SELECT Id FROM ApexLog WHERE LogUserId = '${context.adminId}' AND StartTime >= ${startedAt} AND Operation = 'Api'`);
      assert.ok(before.length > 0, 'Purge needs a nonempty smoke-log snapshot');
      test.cmd = cmd('logs purge', ['--where', `Id IN (${before.map((r) => `'${r.Id}'`).join(',')})`, ...(bulk ? ['--use-bulk-api', '--wait', '10'] : [])]);
      return runner(...test.cmd, { cwd: root, timeoutMs: 15 * 60_000 });
    };
    tests.push(test);
  }
  tests.push(expectedFailure('14 logs purge rejects invalid SOQL', /Nope|INVALID_FIELD/i, cmd('logs purge', ['--where', 'Nope = 1'])));
  const source = resolve(root, 'generated/apex/source');
  const output = resolve(root, 'generated/apex/testSuites');
  const suitePath = resolve(output, 'SSO_Smoke_Suite.testSuite-meta.xml');
  const generate = cmd('test-suite generate', ['--source-dir', source, '--name', 'SSO_Smoke_Suite', '--output-dir', output]);
  async function generateSuite() {
    await rm(source, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
    await mkdir(source, { recursive: true });
    await cp(resolve(root, 'sfdx-source/apex-flow/main/classes'), source, { recursive: true });
    await cp(resolve(root, 'fixtures/apex/not-test'), source, { recursive: true });
    return runner(...generate, { cwd: root });
  }
  const generated = success('15 test-suite generate exact test classes', async (e) => {
    const result = resultFrom(e.stdout);
    assert.equal(resolve(result.filePath), suitePath);
    return checkSuiteMembers(await readFile(suitePath, 'utf8'), result.testClassNames);
  }, generate);
  generated.execute = generateSuite;
  tests.push(generated, { name: '16 test-suite generate deploys and passes org tests', cmd: generate, expectedExitCode: 0,
    execute: async () => {
      const execution = await generateSuite();
      assert.equal(execution.exitCode, 0);
      await generated.check(execution);
      await deploy(targetOrg, output, { json });
      const result = await json(['apex', 'run', 'test', '-o', targetOrg, '--suite-names', 'SSO_Smoke_Suite', '--wait', '10', '--result-format', 'json']);
      assert.equal(result.summary?.outcome, 'Passed');
      assert.equal(Number(result.summary?.testsRan), 2);
      return execution;
    }, check: () => true },
    expectedFailure('17 test-suite generate rejects source without tests', /No @IsTest-annotated classes were found/i,
      cmd('test-suite generate', ['--source-dir', resolve(root, 'fixtures/apex/not-test'), '--name', 'SSO_Empty', '--output-dir', output])));
  for (const test of tests.filter((t) => !t.execute)) test.execute = async () => {
    if (/^0[123] /.test(test.name)) await ensureTrace();
    if (test.name.startsWith('05') && !firstTraceId) {
      firstTraceId = (await json(cmd('trace setup')[1].slice(0, -1))).traceFlagId;
    }
    return runner(...test.cmd, { cwd: root, timeoutMs: 20 * 60_000 });
  };
  return tests;
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseSuiteArgs(argv);
  let plugin, cleanup;
  return runSuite({ suiteName: 'apex', cwd: root, ...options, plugin: () => plugin,
    preflight: async () => { plugin = await linkedPlugin('apex'); },
    setup: () => setupApex(options.targetOrg),
    cleanup: async () => cleanup ? cleanup() : { traceSnapshot: 'not started' },
    tests: async function* () {
      const org = await sfJson(['org', 'display', '-o', options.targetOrg]);
      const users = await queryOrg(options.targetOrg, "SELECT Id, Username FROM User WHERE LastName = 'SSO Apex Smoke' AND IsActive = true", { tooling: false });
      assert.equal(users.length, 1, 'Run setup to seed exactly one Apex smoke user');
      const admins = await queryOrg(options.targetOrg, `SELECT Id FROM User WHERE Username = '${org.username.replaceAll("'", "\\'")}'`, { tooling: false });
      assert.equal(admins.length, 1);
      const classes = await queryOrg(options.targetOrg, `SELECT Id, Name FROM ApexClass WHERE Name IN (${['SSO_ApexNoisy', 'SSO_ApexNoisyTest', ...frameworkClasses].map((n) => `'${n}'`).join(',')})`);
      assert.equal(classes.length, frameworkClasses.length + 2, 'Deploy AEP frameworks before the Apex suite');
      const context = { adminId: admins[0].Id, userId: users[0].Id, username: users[0].Username,
        classIds: Object.fromEntries(classes.map((c) => [c.Name, c.Id])), startedAt: new Date().toISOString() };
      cleanup = await prepareTraceCleanup(options.targetOrg, [context.adminId, context.userId, ...classes.map((c) => c.Id)]);
      yield* buildApexTests({ ...options, context });
    },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
