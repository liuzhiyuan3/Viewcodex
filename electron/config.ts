import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export type StartupDocs = {
  required: string[];
  optional: string[];
};

export type TaskMode = 'quick' | 'standard' | 'deep';

export type ProjectRunConfig = {
  model: string | null;
  reasoningEffort: string;
  contextLengthTokens: number;
  skill: string;
  commitAfterTask: boolean;
  taskMode: TaskMode;
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
  commitAfterTask: boolean;
  teamRolePrompts: TeamRolePrompts;
  promptMemories: PromptMemory[];
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
};

const configDirectory = path.join(os.homedir(), '.viewcodex');
const configPath = path.join(configDirectory, 'config.json');
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
  commitAfterTask: false,
  promptMemories: [],
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
): Promise<StartupDocContextResult> {
  const config = await loadConfig();
  findProject(config, projectPath);
  const docs = await readStartupDocs(projectPath);
  const existingDocs = docs.filter((doc) => doc.exists && doc.content?.trim());
  const selectedDocs = taskMode === 'quick' ? existingDocs.filter((doc) => doc.required) : existingDocs;
  const context = buildStartupDocContext(config, projectPath, selectedDocs, taskMode);

  if (taskMode !== 'deep') {
    await saveConfig(config);
  }

  return {
    taskMode,
    context,
    tokenEstimate: estimateTokens(context),
    docs,
  };
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
  const skillsRoot = path.join(os.homedir(), '.codex', 'skills');
  const skillFiles = await findSkillFiles(skillsRoot);
  const skills = await Promise.all(
    skillFiles.map(async (skillPath) => ({
      name: await readSkillName(skillPath),
      path: skillPath,
    })),
  );

  return skills.sort((left, right) => left.name.localeCompare(right.name));
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
    teamRolePrompts: {
      ...defaultConfig.teamRolePrompts,
      ...raw.teamRolePrompts,
    },
    promptMemories: Array.isArray(raw.promptMemories) ? raw.promptMemories.map(normalizePromptMemory) : [],
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
    taskMode: 'standard',
  };
}

function addStartupDocPath(startupDocs: StartupDocs, relativePath: string, required: boolean): void {
  startupDocs.required = startupDocs.required.filter((entry) => entry !== relativePath);
  startupDocs.optional = startupDocs.optional.filter((entry) => entry !== relativePath);

  if (required) {
    startupDocs.required.push(relativePath);
  } else {
    startupDocs.optional.push(relativePath);
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
