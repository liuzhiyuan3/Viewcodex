import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewcodex-test-'));
process.env.HOME = path.join(tempRoot, 'home');
await fs.mkdir(process.env.HOME, { recursive: true });

const configModule = await import('../dist-electron/config.js');

async function createProject(name) {
  const projectPath = path.join(tempRoot, name);
  await fs.mkdir(path.join(projectPath, 'docs'), { recursive: true });
  return projectPath;
}

test('creates required and optional startup docs with correct flags', async () => {
  const projectPath = await createProject('docs-flags');
  await configModule.upsertProject(projectPath);

  await configModule.createStartupDoc(projectPath, 'docs/required-context', true);
  await configModule.createStartupDoc(projectPath, 'docs/optional-context', false);

  const docs = await configModule.readStartupDocs(projectPath);
  const requiredDoc = docs.find((doc) => doc.path === 'docs/required-context.md');
  const optionalDoc = docs.find((doc) => doc.path === 'docs/optional-context.md');

  assert.equal(requiredDoc?.required, true);
  assert.equal(requiredDoc?.exists, true);
  assert.equal(optionalDoc?.required, false);
  assert.equal(optionalDoc?.exists, true);
});

test('rejects startup docs outside the project directory', async () => {
  const projectPath = await createProject('path-safety');
  await configModule.upsertProject(projectPath);

  await assert.rejects(
    () => configModule.createStartupDoc(projectPath, '../outside-project', true),
    /项目目录内/,
  );
});

test('only reads startup docs registered on the project', async () => {
  const projectPath = await createProject('read-boundary');
  await configModule.upsertProject(projectPath);
  await fs.writeFile(path.join(projectPath, 'docs/unregistered.md'), 'private note', 'utf8');

  await assert.rejects(
    () => configModule.readStartupDocContent(projectPath, 'docs/unregistered.md'),
    /已加入列表/,
  );
});

test('preserves mdx extension when creating startup docs', async () => {
  const projectPath = await createProject('mdx-docs');
  await configModule.upsertProject(projectPath);

  const nextConfig = await configModule.createStartupDoc(projectPath, 'docs/context.mdx', false);
  const project = nextConfig.projects.find((entry) => entry.path === projectPath);

  assert.ok(project?.startupDocs.optional.includes('docs/context.mdx'));
  assert.equal(
    await fileExists(path.join(projectPath, 'docs/context.mdx')),
    true,
  );
  assert.equal(
    await fileExists(path.join(projectPath, 'docs/context.mdx.md')),
    false,
  );
});

test('standard context preserves required docs and summarizes optional docs', async () => {
  const projectPath = await createProject('context-modes');
  await configModule.upsertProject(projectPath);
  await configModule.createStartupDoc(projectPath, 'docs/required', true);
  await configModule.createStartupDoc(projectPath, 'docs/optional', false);

  const requiredContent = [
    '# Required',
    'This sentence must survive standard mode because required docs are sent in full.',
    'CRITICAL_REQUIRED_TAIL_MARKER',
  ].join('\n');
  const optionalContent = Array.from({ length: 40 }, (_, index) => `optional detail ${index}`).join('\n');

  await configModule.writeStartupDocContent(projectPath, 'docs/required.md', requiredContent);
  await configModule.writeStartupDocContent(projectPath, 'docs/optional.md', optionalContent);

  const standard = await configModule.getStartupDocContext(projectPath, 'standard');
  assert.match(standard.context, /CRITICAL_REQUIRED_TAIL_MARKER/);
  assert.match(standard.context, /docs\/optional\.md/);

  const quick = await configModule.getStartupDocContext(projectPath, 'quick');
  assert.match(quick.context, /docs\/required\.md/);
  assert.doesNotMatch(quick.context, /docs\/optional\.md/);
});

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('adds and removes model options while preserving at least one model', async () => {
  const configAfterAdd = await configModule.addModel('local-test-model');
  assert.ok(configAfterAdd.models.includes('local-test-model'));

  const configAfterRemove = await configModule.removeModel('local-test-model');
  assert.equal(configAfterRemove.models.includes('local-test-model'), false);
  assert.ok(configAfterRemove.models.length > 0);
});

test('adds updates and removes prompt memories', async () => {
  const configAfterAdd = await configModule.addPromptMemory('Review', '检查这个改动');
  const memory = configAfterAdd.promptMemories.find((entry) => entry.title === 'Review');

  assert.ok(memory);
  assert.equal(memory.content, '检查这个改动');

  const configAfterUpdate = await configModule.updatePromptMemory(memory.id, 'Review strict', '只输出问题');
  assert.equal(
    configAfterUpdate.promptMemories.find((entry) => entry.id === memory.id)?.content,
    '只输出问题',
  );

  const configAfterRemove = await configModule.removePromptMemory(memory.id);
  assert.equal(configAfterRemove.promptMemories.some((entry) => entry.id === memory.id), false);
});
