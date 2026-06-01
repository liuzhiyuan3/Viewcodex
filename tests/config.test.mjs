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

async function createSkill(root, directoryName, skillName) {
  const skillDirectory = path.join(root, directoryName);
  await fs.mkdir(skillDirectory, { recursive: true });
  await fs.writeFile(path.join(skillDirectory, 'SKILL.md'), `name: ${skillName}\n`, 'utf8');
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

test('rejects startup docs with hidden or sensitive-looking paths', async () => {
  const projectPath = await createProject('safe-docs');
  await configModule.upsertProject(projectPath);

  await assert.rejects(
    () => configModule.createStartupDoc(projectPath, '.hidden/context', true),
    /隐藏路径/,
  );
  await assert.rejects(
    () => configModule.createStartupDoc(projectPath, 'docs/api-token.md', true),
    /敏感信息/,
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

test('session handoff is read once without becoming a startup doc', async () => {
  const projectPath = await createProject('handoff-doc');
  await configModule.upsertProject(projectPath);

  await configModule.writeSessionHandoff(projectPath, '# Handoff\n\nunfinished task');

  const preview = await configModule.getStartupDocContext(projectPath, 'quick');
  assert.match(preview.context, /unfinished task/);
  assert.equal((await configModule.readSessionHandoff(projectPath)).exists, true);

  const consumed = await configModule.getStartupDocContext(projectPath, 'quick', { consumeHandoff: true });
  assert.match(consumed.context, /unfinished task/);
  assert.equal(consumed.docs.some((doc) => doc.path.includes('codex-session-handoff')), false);
  assert.equal((await configModule.readSessionHandoff(projectPath)).exists, false);
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

test('stores codex cli path with codex fallback', async () => {
  const configWithPath = await configModule.setCodexCliPath('/opt/bin/codex');
  assert.equal(configWithPath.codexCliPath, '/opt/bin/codex');

  const configWithFallback = await configModule.setCodexCliPath('  ');
  assert.equal(configWithFallback.codexCliPath, 'codex');
});

test('project run config persists git repository and branch strategy', async () => {
  const projectPath = await createProject('git-config');
  await configModule.upsertProject(projectPath);

  const nextConfig = await configModule.setProjectRunConfig(projectPath, {
    gitRepositoryPath: projectPath,
    gitRemoteUrl: 'https://github.com/example/repo.git',
    gitBranchMode: 'new',
    gitBranchName: 'viewcodex/test-task',
  });
  const project = nextConfig.projects.find((entry) => entry.path === projectPath);

  assert.equal(project?.runConfig.gitRepositoryPath, projectPath);
  assert.equal(project?.runConfig.gitRemoteUrl, 'https://github.com/example/repo.git');
  assert.equal(project?.runConfig.gitBranchMode, 'new');
  assert.equal(project?.runConfig.gitBranchName, 'viewcodex/test-task');
});

test('records recent session history with newest entries first', async () => {
  const projectPath = await createProject('session-history');
  await configModule.upsertProject(projectPath);

  await configModule.recordSessionHistory({
    id: 'old-session',
    projectPath,
    role: 'solo',
    model: 'gpt-test',
    skill: '',
    promptPreview: 'old',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:00.000Z',
    exitCode: 0,
  });
  const nextConfig = await configModule.recordSessionHistory({
    id: 'new-session',
    projectPath,
    role: 'solo',
    model: 'gpt-test',
    skill: 'review',
    promptPreview: 'new',
    transcriptTail: 'last terminal lines',
    startedAt: '2026-01-01T00:02:00.000Z',
    endedAt: '2026-01-01T00:03:00.000Z',
    exitCode: 1,
  });

  assert.equal(nextConfig.sessionHistory[0].id, 'new-session');
  assert.equal(nextConfig.sessionHistory[0].transcriptTail, 'last terminal lines');
  assert.equal(nextConfig.sessionHistory[1].id, 'old-session');

  const clearedConfig = await configModule.clearSessionHistory(projectPath);
  assert.equal(clearedConfig.sessionHistory.some((entry) => entry.projectPath === projectPath), false);
});

test('copies task attachments into the project and clears them', async () => {
  const projectPath = await createProject('task-attachments');
  const externalPath = path.join(tempRoot, 'reference.md');
  await fs.writeFile(externalPath, '# Reference\n\nUse this file.', 'utf8');
  await configModule.upsertProject(projectPath);

  const attachedConfig = await configModule.addTaskAttachments(projectPath, [externalPath], 'read first');
  const attachment = attachedConfig.taskAttachments.find((entry) => entry.projectPath === projectPath);

  assert.equal(attachment?.originalName, 'reference.md');
  assert.equal(attachment?.kind, 'document');
  assert.equal(attachment?.note, 'read first');
  assert.match(attachment?.path ?? '', /^\.viewcodex\/attachments\//);
  assert.equal(await fileExists(path.join(projectPath, attachment.path)), true);

  const notedConfig = await configModule.updateTaskAttachmentNote(attachment.id, 'updated note');
  assert.equal(notedConfig.taskAttachments.find((entry) => entry.id === attachment.id)?.note, 'updated note');

  const clearedConfig = await configModule.clearTaskAttachments(projectPath);
  assert.equal(clearedConfig.taskAttachments.some((entry) => entry.projectPath === projectPath), false);
  assert.equal(await fileExists(path.join(projectPath, attachment.path)), false);
});

test('caps task attachments per project', async () => {
  const projectPath = await createProject('task-attachment-cap');
  await configModule.upsertProject(projectPath);
  const files = [];

  for (let index = 0; index < 22; index += 1) {
    const filePath = path.join(tempRoot, `cap-${index}.txt`);
    await fs.writeFile(filePath, `attachment ${index}`, 'utf8');
    files.push(filePath);
  }

  const nextConfig = await configModule.addTaskAttachments(projectPath, files);
  const projectAttachments = nextConfig.taskAttachments.filter((entry) => entry.projectPath === projectPath);
  assert.equal(projectAttachments.length, 20);
});

test('lists skills from CODEX_HOME and default codex home without stale cache', async () => {
  const codexHome = path.join(tempRoot, 'custom-codex-home');
  process.env.CODEX_HOME = codexHome;
  await createSkill(path.join(codexHome, 'skills'), 'alpha', 'alpha-skill');
  await createSkill(path.join(process.env.HOME, '.codex', 'skills'), 'beta', 'beta-skill');

  const firstList = await configModule.listAvailableSkills();
  assert.ok(firstList.some((skill) => skill.name === 'alpha-skill'));
  assert.ok(firstList.some((skill) => skill.name === 'beta-skill'));

  await createSkill(path.join(codexHome, 'skills'), 'gamma', 'gamma-skill');
  const secondList = await configModule.listAvailableSkills();
  assert.ok(secondList.some((skill) => skill.name === 'gamma-skill'));
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
