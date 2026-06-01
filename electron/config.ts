import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export type StartupDocs = {
  required: string[];
  optional: string[];
};

export type TaskMode = 'quick' | 'standard' | 'deep';
export type GitBranchMode = 'current' | 'new';

export type ProjectRunConfig = {
  model: string | null;
  reasoningEffort: string;
  contextLengthTokens: number;
  skill: string;
  commitAfterTask: boolean;
  pushAfterCommit: boolean;
  taskMode: TaskMode;
  gitRepositoryPath: string | null;
  gitRemoteUrl: string;
  gitBranchMode: GitBranchMode;
  gitBranchName: string;
};

export type TeamRolePrompts = {
  planner: string;
  executor: string;
  reviewer: string;
};

export type PromptMemory = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
};

export type SessionHistoryEntry = {
  id: string;
  projectPath: string;
  role: string;
  model: string;
  skill: string;
  promptPreview: string;
  transcriptTail: string;
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
};

export type TaskAttachment = {
  id: string;
  projectPath: string;
  path: string;
  originalName: string;
  kind: 'image' | 'document';
  note: string;
  createdAt: string;
};

export type TaskTemplate = {
  id: string;
  title: string;
  prompt: string;
};

export type ViewcodexProject = {
  name: string;
  path: string;
  startupDocs: StartupDocs;
  promptDraft: string;
  runConfig: ProjectRunConfig;
};

export type ViewcodexConfig = {
  projects: ViewcodexProject[];
  selectedProjectPath: string | null;
  models: string[];
  reasoningEfforts: string[];
  contextLengthOptions: number[];
  defaultModel: string | null;
  defaultReasoningEffort: string;
  defaultContextLengthTokens: number;
  defaultSkill: string | null;
  codexCliPath: string;
  commitAfterTask: boolean;
  teamRolePrompts: TeamRolePrompts;
  promptMemories: PromptMemory[];
  sessionHistory: SessionHistoryEntry[];
  taskAttachments: TaskAttachment[];
  taskTemplates: TaskTemplate[];
  startupDocSummaryCache: StartupDocSummaryCache;
};

export type SkillOption = {
  name: string;
  path: string;
};

export type StartupDocReadResult = {
  path: string;
  required: boolean;
  exists: boolean;
  content: string | null;
  error?: string;
};

export type StartupDocSummaryCache = Record<
  string,
  Record<
    string,
    {
      sourceHash: string;
      summary: string;
      updatedAt: string;
    }
  >
>;

export type StartupDocContextResult = {
  taskMode: TaskMode;
  context: string;
  tokenEstimate: number;
  docs: StartupDocReadResult[];
  handoff: SessionHandoffDoc | null;
};

export type StartupDocContextOptions = {
  consumeHandoff?: boolean;
};

export type SessionHandoffDoc = {
  path: string;
  exists: boolean;
  content: string | null;
  createdAt: string | null;
};

const configDirectory = path.join(os.homedir(), '.viewcodex');
const configPath = path.join(configDirectory, 'config.json');
const sessionHandoffRelativePath = path.join('.viewcodex', 'codex-session-handoff.md');
const taskAttachmentDirectory = path.join('.viewcodex', 'attachments');
const maxTaskAttachmentsPerProject = 20;
const maxTaskTemplates = 30;
const imageAttachmentExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const documentAttachmentExtensions = new Set(['.md', '.mdx', '.txt', '.pdf']);
let configWriteQueue: Promise<void> = Promise.resolve();

const defaultConfig: ViewcodexConfig = {
  projects: [],
  selectedProjectPath: null,
  models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
  contextLengthOptions: [32_000, 128_000, 200_000, 400_000, 1_000_000],
  defaultModel: 'gpt-5.5',
  defaultReasoningEffort: 'medium',
  defaultContextLengthTokens: 200_000,
  defaultSkill: null,
  codexCliPath: 'codex',
  commitAfterTask: false,
  promptMemories: [],
  sessionHistory: [],
  taskAttachments: [],
  taskTemplates: [
    { id: 'fix-bug', title: '修复 Bug', prompt: '请调查并修复这个问题，完成后说明根因、改动文件和验证结果：\n\n' },
    { id: 'add-feature', title: '添加功能', prompt: '请实现以下功能，保持改动清晰，并补充必要验证：\n\n' },
    { id: 'ui-polish', title: '优化界面', prompt: '请优化这个界面体验，保持风格一致，检查布局、间距、状态和响应式表现：\n\n' },
    { id: 'code-review', title: '代码审查', prompt: '请做一次代码审查，优先列出 bug、风险、回归点和缺失测试：\n\n' },
    { id: 'write-tests', title: '补充测试', prompt: '请为以下行为补充测试，并运行相关验证：\n\n' },
  ],
  startupDocSummaryCache: {},
  teamRolePrompts: {
    planner:
      '你是 Planner。只输出步骤、风险、验证方式；不要改代码，不要长篇解释。完成时最后单独输出 VIEWCODEX_PLANNER_READY。',
    executor:
      '你是 Executor。按 Planner 方案实现并验证，只汇报改动文件、验证结果、阻塞点。每轮完成后最后单独输出 VIEWCODEX_EXECUTOR_DONE。',
    reviewer:
      '你是 Reviewer。只找 bug、漏测、风险，输出精简结论。通过时最后单独输出 VIEWCODEX_REVIEW_APPROVED；需修复时最后单独输出 VIEWCODEX_REVIEW_CHANGES。',
  },
};

export async function loadConfig(): Promise<ViewcodexConfig> {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return normalizeConfig(JSON.parse(raw) as Partial<ViewcodexConfig>);
  } catch (error) {
    if (isMissingFile(error)) {
      await saveConfig(defaultConfig);
      return defaultConfig;
    }

    throw error;
  }
}

export async function saveConfig(config: ViewcodexConfig): Promise<ViewcodexConfig> {
  await fs.mkdir(configDirectory, { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

export async function upsertProject(projectPath: string): Promise<ViewcodexConfig> {
  const config = await loadConfig();
  const existing = config.projects.find((project) => project.path === projectPath);

  if (!existing) {
    config.projects.unshift({
      name: path.basename(projectPath),
      path: projectPath,
      startupDocs: {
        required: await detectDefaultRequiredDocs(projectPath),
        optional: [],
      },
      promptDraft: '',
      runConfig: createDefaultRunConfig(config),
    });
  }

  config.selectedProjectPath = projectPath;
  return saveConfig(config);
}

export async function selectExistingProject(projectPath: string): Promise<ViewcodexConfig> {
  const config = await loadConfig();
  findProject(config, projectPath);
  config.selectedProjectPath = projectPath;
  return saveConfig(config);
}

export async function setCommitAfterTask(commitAfterTask: boolean): Promise<ViewcodexConfig> {
  const config = await loadConfig();
  config.commitAfterTask = commitAfterTask;
  return saveConfig(config);
}

export async function setCodexCliPath(codexCliPath: string): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    config.codexCliPath = normalizeCodexCliPath(codexCliPath);
  });
}

export async function addModel(model: string): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    const normalizedModel = normalizeModelName(model);
    if (!config.models.includes(normalizedModel)) {
      config.models.unshift(normalizedModel);
    }
    config.defaultModel ??= normalizedModel;
  });
}

export async function removeModel(model: string): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    if (config.models.length <= 1) {
      throw new Error('至少保留一个模型');
    }

    config.models = config.models.filter((entry) => entry !== model);
    if (config.models.length === 0) {
      throw new Error('至少保留一个模型');
    }

    if (config.defaultModel === model) {
      config.defaultModel = config.models[0] ?? null;
    }

    for (const project of config.projects) {
      if (project.runConfig.model === model) {
        project.runConfig.model = config.defaultModel;
      }
    }
  });
}

export async function addPromptMemory(title: string, content: string): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (!normalizedTitle) {
      throw new Error('请输入 Prompt 名称');
    }
    if (!normalizedContent) {
      throw new Error('请输入 Prompt 内容');
    }

    config.promptMemories.unshift({
      id: randomUUID(),
      title: normalizedTitle,
      content: normalizedContent,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function updatePromptMemory(
  id: string,
  title: string,
  content: string,
): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    const memory = config.promptMemories.find((entry) => entry.id === id);
    if (!memory) {
      throw new Error('Prompt 记忆不存在');
    }

    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (!normalizedTitle) {
      throw new Error('请输入 Prompt 名称');
    }
    if (!normalizedContent) {
      throw new Error('请输入 Prompt 内容');
    }

    memory.title = normalizedTitle;
    memory.content = normalizedContent;
    memory.updatedAt = new Date().toISOString();
  });
}

export async function removePromptMemory(id: string): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    config.promptMemories = config.promptMemories.filter((entry) => entry.id !== id);
  });
}

export async function addTaskAttachments(
  projectPath: string,
  filePaths: string[],
  note = '',
): Promise<ViewcodexConfig> {
  const config = await loadConfig();
  findProject(config, projectPath);
  const normalizedNote = note.trim().slice(0, 500);
  const createdAt = new Date().toISOString();
  const nextAttachments: TaskAttachment[] = [];

  for (const filePath of filePaths) {
    const kind = getTaskAttachmentKind(filePath);
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error('附件必须是文件');
    }

    const id = randomUUID();
    const sourceName = path.basename(filePath);
    const safeName = sanitizeAttachmentFileName(sourceName);
    const relativePath = path.join(taskAttachmentDirectory, `${id}-${safeName}`);
    const absolutePath = path.join(projectPath, relativePath);
    if (!isPathInside(projectPath, absolutePath)) {
      throw new Error('附件必须复制到项目目录内');
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.copyFile(filePath, absolutePath);
    nextAttachments.push({
      id,
      projectPath,
      path: relativePath,
      originalName: sourceName,
      kind,
      note: normalizedNote,
      createdAt,
    });
  }

  const previousAttachments = config.taskAttachments;
  config.taskAttachments = capTaskAttachments([
    ...nextAttachments,
    ...config.taskAttachments,
  ]);
  await cleanupRemovedTaskAttachments([...previousAttachments, ...nextAttachments], config.taskAttachments);
  return saveConfig(config);
}

export async function updateTaskAttachmentNote(id: string, note: string): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    const attachment = config.taskAttachments.find((entry) => entry.id === id);
    if (!attachment) {
      throw new Error('附件不存在');
    }

    attachment.note = note.trim().slice(0, 500);
  });
}

export async function removeTaskAttachment(id: string): Promise<ViewcodexConfig> {
  const config = await loadConfig();
  const attachment = config.taskAttachments.find((entry) => entry.id === id);
  if (!attachment) {
    return config;
  }

  config.taskAttachments = config.taskAttachments.filter((entry) => entry.id !== id);
  await unlinkTaskAttachment(attachment);
  return saveConfig(config);
}

export async function clearTaskAttachments(projectPath?: string): Promise<ViewcodexConfig> {
  const config = await loadConfig();
  const removing = projectPath
    ? config.taskAttachments.filter((attachment) => attachment.projectPath === projectPath)
    : config.taskAttachments;
  config.taskAttachments = projectPath
    ? config.taskAttachments.filter((attachment) => attachment.projectPath !== projectPath)
    : [];

  await Promise.all(removing.map((attachment) => unlinkTaskAttachment(attachment)));
  return saveConfig(config);
}

export async function recordSessionHistory(entry: SessionHistoryEntry): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    config.sessionHistory = [
      entry,
      ...config.sessionHistory.filter((item) => item.id !== entry.id),
    ].slice(0, 80);
  });
}

export async function clearSessionHistory(projectPath?: string): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    config.sessionHistory = projectPath
      ? config.sessionHistory.filter((entry) => entry.projectPath !== projectPath)
      : [];
  });
}

export async function setProjectPromptDraft(projectPath: string, promptDraft: string): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    const project = findProject(config, projectPath);
    project.promptDraft = promptDraft;
  });
}

export async function setProjectRunConfig(
  projectPath: string,
  runConfig: Partial<ProjectRunConfig>,
): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    const project = findProject(config, projectPath);
    project.runConfig = {
      ...createDefaultRunConfig(config),
      ...project.runConfig,
      ...runConfig,
    };
  });
}

export async function setTeamRolePrompt(role: keyof TeamRolePrompts, prompt: string): Promise<ViewcodexConfig> {
  return updateConfig((config) => {
    config.teamRolePrompts = {
      ...defaultConfig.teamRolePrompts,
      ...config.teamRolePrompts,
      [role]: prompt,
    };
  });
}

export async function addStartupDocs(
  projectPath: string,
  docPaths: string[],
  required = true,
): Promise<ViewcodexConfig> {
  const config = await loadConfig();
  const project = findProject(config, projectPath);

  for (const docPath of docPaths) {
    const relativePath = toProjectRelativePath(projectPath, docPath);
    addStartupDocPath(project.startupDocs, relativePath, required);
  }

  return saveConfig(config);
}

export async function removeStartupDoc(projectPath: string, docPath: string): Promise<ViewcodexConfig> {
  const config = await loadConfig();
  const project = findProject(config, projectPath);
  project.startupDocs.required = project.startupDocs.required.filter((entry) => entry !== docPath);
  project.startupDocs.optional = project.startupDocs.optional.filter((entry) => entry !== docPath);
  return saveConfig(config);
}

export async function createStartupDoc(
  projectPath: string,
  inputName: string,
  required = true,
): Promise<ViewcodexConfig> {
  const config = await loadConfig();
  const project = findProject(config, projectPath);
  const relativePath = normalizeMarkdownPath(inputName);
  assertSafeStartupDocPath(relativePath);
  const absolutePath = path.join(projectPath, relativePath);

  if (!isPathInside(projectPath, absolutePath)) {
    throw new Error('文档必须创建在项目目录内');
  }

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  try {
    await fs.writeFile(absolutePath, createDocTemplate(project.name), { flag: 'wx' });
  } catch (error) {
    if (!isFileExists(error)) {
      throw error;
    }
  }

  addStartupDocPath(project.startupDocs, relativePath, required);

  return saveConfig(config);
}

export async function readStartupDocs(projectPath: string): Promise<StartupDocReadResult[]> {
  const config = await loadConfig();
  const project = findProject(config, projectPath);
  const required = project.startupDocs.required.map((docPath) => readStartupDoc(projectPath, docPath, true));
  const optional = project.startupDocs.optional.map((docPath) => readStartupDoc(projectPath, docPath, false));

  return Promise.all([...required, ...optional]);
}

export async function getStartupDocContext(
  projectPath: string,
  taskMode: TaskMode,
  options: StartupDocContextOptions = {},
): Promise<StartupDocContextResult> {
  const config = await loadConfig();
  findProject(config, projectPath);
  const docs = await readStartupDocs(projectPath);
  const handoff = options.consumeHandoff
    ? await consumeSessionHandoff(projectPath)
    : await readSessionHandoff(projectPath);
  const existingDocs = docs.filter((doc) => doc.exists && doc.content?.trim());
  const selectedDocs = taskMode === 'quick' ? existingDocs.filter((doc) => doc.required) : existingDocs;
  const context = prependSessionHandoffContext(
    buildStartupDocContext(config, projectPath, selectedDocs, taskMode),
    handoff,
  );

  if (taskMode !== 'deep') {
    await saveConfig(config);
  }

  return {
    taskMode,
    context,
    tokenEstimate: estimateTokens(context),
    docs,
    handoff,
  };
}

export async function readSessionHandoff(projectPath: string): Promise<SessionHandoffDoc> {
  const absolutePath = getSessionHandoffPath(projectPath);
  if (!isPathInside(projectPath, absolutePath)) {
    throw new Error('交接文档路径不在项目目录内');
  }

  try {
    const [content, stats] = await Promise.all([
      fs.readFile(absolutePath, 'utf8'),
      fs.stat(absolutePath),
    ]);
    return {
      path: sessionHandoffRelativePath,
      exists: true,
      content,
      createdAt: stats.mtime.toISOString(),
    };
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }

    return {
      path: sessionHandoffRelativePath,
      exists: false,
      content: null,
      createdAt: null,
    };
  }
}

export async function writeSessionHandoff(projectPath: string, content: string): Promise<SessionHandoffDoc> {
  const absolutePath = getSessionHandoffPath(projectPath);
  if (!isPathInside(projectPath, absolutePath)) {
    throw new Error('交接文档路径不在项目目录内');
  }

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.chmod(absolutePath, 0o600).catch(() => undefined);
  await fs.writeFile(absolutePath, normalizeSessionHandoffContent(content), { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(absolutePath, 0o400);
  return readSessionHandoff(projectPath);
}

export async function consumeSessionHandoff(projectPath: string): Promise<SessionHandoffDoc | null> {
  const handoff = await readSessionHandoff(projectPath);
  if (!handoff.exists) {
    return null;
  }

  const absolutePath = getSessionHandoffPath(projectPath);
  await fs.chmod(absolutePath, 0o600).catch(() => undefined);
  await fs.unlink(absolutePath);
  return handoff;
}

export async function readStartupDocContent(projectPath: string, docPath: string): Promise<StartupDocReadResult> {
  const config = await loadConfig();
  const project = findProject(config, projectPath);
  const required = project.startupDocs.required.includes(docPath);
  const optional = project.startupDocs.optional.includes(docPath);
  if (!required && !optional) {
    throw new Error('只能读取已加入列表的启动文档');
  }

  return readStartupDoc(projectPath, docPath, required);
}

export async function writeStartupDocContent(projectPath: string, docPath: string, content: string): Promise<void> {
  const config = await loadConfig();
  const project = findProject(config, projectPath);
  const isStartupDoc = project.startupDocs.required.includes(docPath) || project.startupDocs.optional.includes(docPath);

  if (!isStartupDoc) {
    throw new Error('只能编辑已加入列表的启动文档');
  }

  const absolutePath = path.join(projectPath, docPath);
  if (!isPathInside(projectPath, absolutePath)) {
    throw new Error('文档路径不在项目目录内');
  }

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
}

export async function listAvailableSkills(): Promise<SkillOption[]> {
  const skillFilesByPath = new Set<string>();
  for (const skillsRoot of getSkillRoots()) {
    for (const skillPath of await findSkillFiles(skillsRoot)) {
      skillFilesByPath.add(skillPath);
    }
  }
  const skills = await Promise.all(
    [...skillFilesByPath].map(async (skillPath) => ({
      name: await readSkillName(skillPath),
      path: skillPath,
    })),
  );
  const skillsByName = new Map<string, SkillOption>();
  for (const skill of skills) {
    if (!skillsByName.has(skill.name)) {
      skillsByName.set(skill.name, skill);
    }
  }

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeConfig(raw: Partial<ViewcodexConfig>): ViewcodexConfig {
  const projects = Array.isArray(raw.projects) ? raw.projects.map(normalizeProject) : [];
  const models = mergeUnique(raw.models, defaultConfig.models);
  const reasoningEfforts = mergeUnique(raw.reasoningEfforts, defaultConfig.reasoningEfforts);
  const contextLengthOptions = mergeUniqueNumbers(raw.contextLengthOptions, defaultConfig.contextLengthOptions);
  const selectedProjectPath =
    raw.selectedProjectPath && projects.some((project) => project.path === raw.selectedProjectPath)
      ? raw.selectedProjectPath
      : projects[0]?.path ?? null;

  return {
    ...defaultConfig,
    ...raw,
    models,
    reasoningEfforts,
    contextLengthOptions,
    defaultReasoningEffort: raw.defaultReasoningEffort ?? defaultConfig.defaultReasoningEffort,
    defaultContextLengthTokens:
      raw.defaultContextLengthTokens ?? defaultConfig.defaultContextLengthTokens,
    codexCliPath: normalizeCodexCliPath(raw.codexCliPath ?? defaultConfig.codexCliPath),
    teamRolePrompts: {
      ...defaultConfig.teamRolePrompts,
      ...raw.teamRolePrompts,
    },
    promptMemories: Array.isArray(raw.promptMemories) ? raw.promptMemories.map(normalizePromptMemory) : [],
    sessionHistory: Array.isArray(raw.sessionHistory) ? raw.sessionHistory.map(normalizeSessionHistoryEntry) : [],
    taskAttachments: capTaskAttachments(
      Array.isArray(raw.taskAttachments) ? raw.taskAttachments.map(normalizeTaskAttachment) : [],
    ),
    taskTemplates: Array.isArray(raw.taskTemplates)
      ? raw.taskTemplates.map(normalizeTaskTemplate).slice(0, maxTaskTemplates)
      : defaultConfig.taskTemplates,
    startupDocSummaryCache: raw.startupDocSummaryCache ?? {},
    projects,
    selectedProjectPath,
  };
}

function normalizeProject(project: Partial<ViewcodexProject>): ViewcodexProject {
  return {
    name: project.name || (project.path ? path.basename(project.path) : '未命名项目'),
    path: project.path || '',
    startupDocs: {
      required: project.startupDocs?.required ?? [],
      optional: project.startupDocs?.optional ?? [],
    },
    promptDraft: project.promptDraft ?? '',
    runConfig: {
      ...createDefaultRunConfig(defaultConfig),
      ...project.runConfig,
    },
  };
}

function normalizePromptMemory(memory: Partial<PromptMemory>): PromptMemory {
  return {
    id: memory.id || randomUUID(),
    title: memory.title?.trim() || '未命名 Prompt',
    content: memory.content ?? '',
    updatedAt: memory.updatedAt ?? new Date().toISOString(),
  };
}

function normalizeSessionHistoryEntry(entry: Partial<SessionHistoryEntry>): SessionHistoryEntry {
  return {
    id: entry.id || randomUUID(),
    projectPath: entry.projectPath ?? '',
    role: entry.role ?? 'solo',
    model: entry.model ?? '',
    skill: entry.skill ?? '',
    promptPreview: entry.promptPreview ?? '',
    transcriptTail: entry.transcriptTail ?? '',
    startedAt: entry.startedAt ?? new Date().toISOString(),
    endedAt: entry.endedAt ?? entry.startedAt ?? new Date().toISOString(),
    exitCode: typeof entry.exitCode === 'number' ? entry.exitCode : null,
  };
}

function normalizeTaskAttachment(attachment: Partial<TaskAttachment>): TaskAttachment {
  return {
    id: attachment.id || randomUUID(),
    projectPath: attachment.projectPath ?? '',
    path: attachment.path ?? '',
    originalName: attachment.originalName ?? path.basename(attachment.path ?? '附件'),
    kind: attachment.kind === 'image' ? 'image' : 'document',
    note: attachment.note ?? '',
    createdAt: attachment.createdAt ?? new Date().toISOString(),
  };
}

function normalizeTaskTemplate(template: Partial<TaskTemplate>): TaskTemplate {
  return {
    id: template.id || randomUUID(),
    title: template.title?.trim() || '未命名模板',
    prompt: template.prompt ?? '',
  };
}

function capTaskAttachments(attachments: TaskAttachment[]): TaskAttachment[] {
  const byProject = new Map<string, TaskAttachment[]>();
  for (const attachment of attachments) {
    const entries = byProject.get(attachment.projectPath) ?? [];
    entries.push(attachment);
    byProject.set(attachment.projectPath, entries);
  }

  return [...byProject.values()].flatMap((entries) =>
    entries
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, maxTaskAttachmentsPerProject),
  );
}

async function cleanupRemovedTaskAttachments(
  previousAttachments: TaskAttachment[],
  nextAttachments: TaskAttachment[],
): Promise<void> {
  const nextIds = new Set(nextAttachments.map((attachment) => attachment.id));
  const removed = previousAttachments.filter((attachment) => !nextIds.has(attachment.id));
  await Promise.all(removed.map((attachment) => unlinkTaskAttachment(attachment)));
}

async function unlinkTaskAttachment(attachment: TaskAttachment): Promise<void> {
  const absolutePath = path.join(attachment.projectPath, attachment.path);
  if (!isPathInside(attachment.projectPath, absolutePath)) {
    return;
  }

  await fs.unlink(absolutePath).catch((error) => {
    if (!isMissingFile(error)) {
      throw error;
    }
  });
}

function getTaskAttachmentKind(filePath: string): TaskAttachment['kind'] {
  const extension = path.extname(filePath).toLowerCase();
  if (imageAttachmentExtensions.has(extension)) {
    return 'image';
  }
  if (documentAttachmentExtensions.has(extension)) {
    return 'document';
  }

  throw new Error('附件仅支持图片 png/jpg/jpeg/webp/gif 和文档 md/mdx/txt/pdf');
}

function sanitizeAttachmentFileName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, extension).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${baseName || 'attachment'}${extension}`;
}

function mergeUnique(primary: string[] | undefined, fallback: string[]): string[] {
  return [...new Set([...(primary ?? []), ...fallback])];
}

function mergeUniqueNumbers(primary: number[] | undefined, fallback: number[]): number[] {
  return [...new Set([...(primary ?? []), ...fallback])].filter(Number.isFinite).sort((left, right) => left - right);
}

function normalizeModelName(model: string): string {
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    throw new Error('请输入模型名称');
  }

  return normalizedModel;
}

function normalizeCodexCliPath(codexCliPath: string): string {
  return codexCliPath.trim() || 'codex';
}

async function updateConfig(mutator: (config: ViewcodexConfig) => void): Promise<ViewcodexConfig> {
  const operation = configWriteQueue.then(async () => {
    const config = await loadConfig();
    mutator(config);
    return saveConfig(config);
  });

  configWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );

  return operation;
}

function createDefaultRunConfig(config: ViewcodexConfig): ProjectRunConfig {
  return {
    model: config.defaultModel,
    reasoningEffort: config.defaultReasoningEffort,
    contextLengthTokens: config.defaultContextLengthTokens,
    skill: '',
    commitAfterTask: config.commitAfterTask,
    pushAfterCommit: false,
    taskMode: 'standard',
    gitRepositoryPath: null,
    gitRemoteUrl: '',
    gitBranchMode: 'current',
    gitBranchName: 'viewcodex-task',
  };
}

function addStartupDocPath(startupDocs: StartupDocs, relativePath: string, required: boolean): void {
  assertSafeStartupDocPath(relativePath);
  startupDocs.required = startupDocs.required.filter((entry) => entry !== relativePath);
  startupDocs.optional = startupDocs.optional.filter((entry) => entry !== relativePath);

  if (required) {
    startupDocs.required.push(relativePath);
  } else {
    startupDocs.optional.push(relativePath);
  }
}

function assertSafeStartupDocPath(relativePath: string): void {
  const normalized = relativePath.replaceAll('\\', '/');
  const fileName = path.basename(normalized);
  if (normalized.split('/').some((part) => part.startsWith('.') && part !== '.' && part !== '..')) {
    throw new Error('启动文档不能使用隐藏路径');
  }

  if (/\b(secret|password|token|credential|private-key|id_rsa|api-key|apikey)\b/i.test(fileName)) {
    throw new Error('启动文档文件名疑似包含敏感信息');
  }
}

async function detectDefaultRequiredDocs(projectPath: string): Promise<string[]> {
  const candidates = [
    'VIEWCODEX_BRIEF.md',
    'AGENTS.md',
    'README.md',
    'docs/viewcodex-visual-cli-requirements.md',
    'docs/viewcodex-implementation-plan.md',
  ];
  const found: string[] = [];

  for (const candidate of candidates) {
    try {
      await fs.access(path.join(projectPath, candidate));
      found.push(candidate);
    } catch {
      // Missing defaults are expected for many projects.
    }
  }

  return found;
}

function findProject(config: ViewcodexConfig, projectPath: string): ViewcodexProject {
  const project = config.projects.find((entry) => entry.path === projectPath);
  if (!project) {
    throw new Error('请先选择项目');
  }

  return project;
}

async function readStartupDoc(
  projectPath: string,
  relativePath: string,
  required: boolean,
): Promise<StartupDocReadResult> {
  const absolutePath = path.join(projectPath, relativePath);

  if (!isPathInside(projectPath, absolutePath)) {
    return {
      path: relativePath,
      required,
      exists: false,
      content: null,
      error: '文档路径不在项目目录内',
    };
  }

  try {
    return {
      path: relativePath,
      required,
      exists: true,
      content: await fs.readFile(absolutePath, 'utf8'),
    };
  } catch (error) {
    return {
      path: relativePath,
      required,
      exists: false,
      content: null,
      error: error instanceof Error ? error.message : '无法读取文档',
    };
  }
}

function normalizeMarkdownPath(inputName: string): string {
  const trimmed = inputName.trim();
  if (!trimmed) {
    throw new Error('请输入文档名称');
  }

  return /\.(md|mdx)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

function toProjectRelativePath(projectPath: string, docPath: string): string {
  const relativePath = path.relative(projectPath, docPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('只能选择项目目录内的文档');
  }

  return relativePath;
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = path.relative(parent, child);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function createDocTemplate(projectName: string): string {
  return `# ${projectName} 项目启动文档

## 项目说明

在这里写这个项目每次启动 Codex 前必须阅读的背景、规则和约束。

## 工作规范

- 

## 注意事项

- 
`;
}

function buildFullStartupDocContext(docs: StartupDocReadResult[]): string {
  if (docs.length === 0) {
    return '';
  }

  return [
    '以下是本项目启动文档全文，请在执行用户需求前遵守：',
    ...docs.map((doc) => `\n## ${doc.path}${doc.required ? '（必读）' : '（可选）'}\n${doc.content?.trim() ?? ''}`),
  ].join('\n');
}

function buildStartupDocContext(
  config: ViewcodexConfig,
  projectPath: string,
  docs: StartupDocReadResult[],
  taskMode: TaskMode,
): string {
  if (taskMode === 'deep') {
    return buildFullStartupDocContext(docs);
  }

  if (taskMode === 'standard') {
    const requiredDocs = docs.filter((doc) => doc.required);
    const optionalDocs = docs.filter((doc) => !doc.required);
    const requiredContext = buildFullStartupDocContext(requiredDocs);
    const optionalContext = buildSummaryStartupDocContext(config, projectPath, optionalDocs, taskMode);

    return [requiredContext, optionalContext].filter(Boolean).join('\n\n');
  }

  return buildSummaryStartupDocContext(config, projectPath, docs.filter((doc) => doc.required), taskMode);
}

function prependSessionHandoffContext(context: string, handoff: SessionHandoffDoc | null): string {
  if (!handoff?.exists || !handoff.content?.trim()) {
    return context;
  }

  return [
    '以下是上一次 Codex 会话的临时交接记录。它不是项目规范，只用于本次快速恢复上下文；阅读后系统会删除原文件：',
    handoff.content.trim(),
    context,
  ].filter(Boolean).join('\n\n');
}

function getSessionHandoffPath(projectPath: string): string {
  return path.join(projectPath, sessionHandoffRelativePath);
}

function normalizeSessionHandoffContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('交接文档内容不能为空');
  }

  return `${trimmed}\n`;
}

function buildSummaryStartupDocContext(
  config: ViewcodexConfig,
  projectPath: string,
  docs: StartupDocReadResult[],
  taskMode: TaskMode,
): string {
  if (docs.length === 0) {
    return '';
  }

  const maxChars = taskMode === 'quick' ? 700 : 1200;
  const projectCache = (config.startupDocSummaryCache[projectPath] ??= {});
  const summaries = docs.map((doc) => {
    const content = doc.content?.trim() ?? '';
    const sourceHash = hashContent(content);
    const cached = projectCache[doc.path];

    if (!cached || cached.sourceHash !== sourceHash) {
      projectCache[doc.path] = {
        sourceHash,
        summary: summarizeMarkdown(content, maxChars),
        updatedAt: new Date().toISOString(),
      };
    }

    return `\n## ${doc.path}${doc.required ? '（必读）' : '（可选）'}\n${projectCache[doc.path].summary}`;
  });

  return ['以下是本项目启动文档摘要，请在执行用户需求前遵守：', ...summaries].join('\n');
}

function summarizeMarkdown(content: string, maxChars: number): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('```'));
  const selected: string[] = [];

  for (const line of lines) {
    const isHeading = /^#{1,3}\s+/.test(line);
    const isListItem = /^[-*]\s+/.test(line);
    const shouldKeep = isHeading || isListItem || selected.length < 8;

    if (shouldKeep) {
      selected.push(line);
    }

    if (selected.join('\n').length >= maxChars) {
      break;
    }
  }

  const summary = selected.join('\n').slice(0, maxChars).trim();
  return summary || content.slice(0, maxChars).trim();
}

function hashContent(content: string): string {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash * 31 + content.charCodeAt(index)) >>> 0;
  }

  return `${content.length}:${hash.toString(16)}`;
}

function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

async function findSkillFiles(directory: string, depth = 0): Promise<string[]> {
  if (depth > 4) {
    return [];
  }

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === 'SKILL.md') {
      files.push(entryPath);
    } else if (entry.isDirectory()) {
      files.push(...(await findSkillFiles(entryPath, depth + 1)));
    }
  }

  return files;
}

function getSkillRoots(): string[] {
  return [
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'skills') : null,
    path.join(os.homedir(), '.codex', 'skills'),
  ].filter((entry, index, entries): entry is string => Boolean(entry) && entries.indexOf(entry) === index);
}

async function readSkillName(skillPath: string): Promise<string> {
  const fallbackName = path.basename(path.dirname(skillPath));

  try {
    const content = await fs.readFile(skillPath, 'utf8');
    const match = content.match(/^name:\s*["']?([^"'\n]+)["']?/m);
    return match?.[1]?.trim() || fallbackName;
  } catch {
    return fallbackName;
  }
}

function isMissingFile(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT';
}

function isFileExists(error: unknown): boolean {
  return isNodeError(error) && error.code === 'EEXIST';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
