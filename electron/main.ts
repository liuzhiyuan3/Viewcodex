import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawn, type IPty } from 'node-pty';
import {
  addModel,
  addPromptMemory,
  addStartupDocs,
  createStartupDoc,
  getStartupDocContext,
  listAvailableSkills,
  loadConfig,
  readSessionHandoff,
  readStartupDocContent,
  readStartupDocs,
  removeModel,
  removePromptMemory,
  removeStartupDoc,
  selectExistingProject,
  setCommitAfterTask,
  setProjectPromptDraft,
  setProjectRunConfig,
  setTeamRolePrompt,
  updatePromptMemory,
  type ProjectRunConfig,
  type TaskMode,
  type TeamRolePrompts,
  upsertProject,
  writeSessionHandoff,
  writeStartupDocContent,
} from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const execFileAsync = promisify(execFile);
const terminals = new Map<string, IPty>();
const terminalMetadata = new Map<string, TerminalRuntimeSession>();
let quittingAfterTerminalPrompt = false;

type TerminalStartOptions = {
  projectPath: string;
  model: string;
  reasoningEffort: string;
  skill: string;
  prompt: string;
  commitAfterTask: boolean;
  role?: CodexRole;
};

type CodexRole = 'solo' | 'planner' | 'executor' | 'reviewer';

type TerminalRuntimeSession = {
  id: string;
  projectPath: string;
  command: string;
  startedAt: string;
  role: CodexRole;
  commitAfterTask: boolean;
  commitSkipReason?: string;
  promptPreview: string;
  transcriptTail: string;
};

type StartupCheckResult = {
  projectExists: boolean;
  codexAvailable: boolean;
  docs: Awaited<ReturnType<typeof readStartupDocs>>;
  ok: boolean;
  errors: string[];
};

ipcMain.handle('config:load', () => loadConfig());

ipcMain.handle('skills:list', () => listAvailableSkills());

ipcMain.handle('project:select', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择项目目录',
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return loadConfig();
  }

  return upsertProject(result.filePaths[0]);
});

ipcMain.handle('project:set-selected', (_event, projectPath: string) => {
  return selectExistingProject(projectPath);
});

ipcMain.handle('config:set-commit-after-task', (_event, commitAfterTask: boolean) => {
  return setCommitAfterTask(commitAfterTask);
});

ipcMain.handle('config:add-model', (_event, model: string) => {
  return addModel(model);
});

ipcMain.handle('config:remove-model', (_event, model: string) => {
  return removeModel(model);
});

ipcMain.handle('config:add-prompt-memory', (_event, title: string, content: string) => {
  return addPromptMemory(title, content);
});

ipcMain.handle('config:update-prompt-memory', (_event, id: string, title: string, content: string) => {
  return updatePromptMemory(id, title, content);
});

ipcMain.handle('config:remove-prompt-memory', (_event, id: string) => {
  return removePromptMemory(id);
});

ipcMain.handle('gpt-config:read', () => {
  return readGptConfigFile();
});

ipcMain.handle('gpt-config:write', (_event, content: string) => {
  return writeGptConfigFile(content);
});

ipcMain.handle('project:set-prompt-draft', (_event, projectPath: string, promptDraft: string) => {
  return setProjectPromptDraft(projectPath, promptDraft);
});

ipcMain.handle('project:set-run-config', (_event, projectPath: string, runConfig: Partial<ProjectRunConfig>) => {
  return setProjectRunConfig(projectPath, runConfig);
});

ipcMain.handle('config:set-team-role-prompt', (_event, role: keyof TeamRolePrompts, prompt: string) => {
  return setTeamRolePrompt(role, prompt);
});

ipcMain.handle('docs:select', async (_event, projectPath: string, required = true) => {
  const result = await dialog.showOpenDialog({
    title: '选择启动文档',
    defaultPath: projectPath,
    filters: [{ name: 'Markdown', extensions: ['md', 'mdx'] }],
    properties: ['openFile', 'multiSelections'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return loadConfig();
  }

  return addStartupDocs(projectPath, result.filePaths, required);
});

ipcMain.handle('docs:create', (_event, projectPath: string, inputName: string, required = true) => {
  return createStartupDoc(projectPath, inputName, required);
});

ipcMain.handle('docs:read', (_event, projectPath: string) => {
  return readStartupDocs(projectPath);
});

ipcMain.handle('docs:context', (_event, projectPath: string, taskMode: TaskMode, consumeHandoff = false) => {
  return getStartupDocContext(projectPath, taskMode, { consumeHandoff });
});

ipcMain.handle('handoff:read', (_event, projectPath: string) => {
  return readSessionHandoff(projectPath);
});

ipcMain.handle('docs:create-with-dialog', async (_event, projectPath: string, inputName: string, required = true) => {
  const result = await dialog.showSaveDialog({
    title: '选择启动文档创建位置',
    defaultPath: path.join(projectPath, inputName || 'docs/project-context.md'),
    filters: [{ name: 'Markdown', extensions: ['md', 'mdx'] }],
  });

  if (result.canceled || !result.filePath) {
    return loadConfig();
  }

  return createStartupDoc(projectPath, path.relative(projectPath, result.filePath), required);
});

ipcMain.handle('docs:remove', (_event, projectPath: string, docPath: string) => {
  return removeStartupDoc(projectPath, docPath);
});

ipcMain.handle('docs:read-one', (_event, projectPath: string, docPath: string) => {
  return readStartupDocContent(projectPath, docPath);
});

ipcMain.handle('docs:write-one', (_event, projectPath: string, docPath: string, content: string) => {
  return writeStartupDocContent(projectPath, docPath, content);
});

ipcMain.handle('startup:check', async (_event, projectPath: string): Promise<StartupCheckResult> => {
  const errors: string[] = [];
  let projectExists = true;
  let codexAvailable = true;
  let docs: Awaited<ReturnType<typeof readStartupDocs>> = [];

  try {
    await ensureConfiguredProject(projectPath);
    await fs.access(projectPath);
  } catch {
    projectExists = false;
    errors.push('项目目录不可访问');
  }

  try {
    await execFileAsync('codex', ['--version']);
  } catch {
    codexAvailable = false;
    errors.push('当前环境无法执行 codex 命令');
  }

  if (projectExists) {
    docs = await readStartupDocs(projectPath);
    const missingRequiredDocs = docs.filter((doc) => doc.required && !doc.exists);
    if (missingRequiredDocs.length > 0) {
      errors.push(`缺失 ${missingRequiredDocs.length} 份必读启动文档`);
    }
  }

  return {
    projectExists,
    codexAvailable,
    docs,
    ok: errors.length === 0,
    errors,
  };
});

ipcMain.handle('terminal:list', () => {
  return Array.from(terminalMetadata.values()).filter((session) => terminals.has(session.id));
});

ipcMain.handle('terminal:start', async (event, options: TerminalStartOptions) => {
  await ensureConfiguredProject(options.projectPath);
  const role = options.role ?? 'solo';
  const existingSession = Array.from(terminalMetadata.values()).find(
    (session) => session.projectPath === options.projectPath && session.role === role && terminals.has(session.id),
  );

  if (existingSession) {
    throw new Error('当前项目这个角色已有 Codex 在运行');
  }

  const sessionId = randomUUID();
  const prompt = buildCodexPrompt(options.skill, options.prompt);
  const commitReadiness =
    role === 'solo' && options.commitAfterTask
      ? await getCommitReadiness(options.projectPath)
      : { ok: false, reason: '自动提交未启用' };
  const baseArgs = [
    '--cd',
    options.projectPath,
    '--model',
    options.model,
    '-c',
    `model_reasoning_effort="${options.reasoningEffort}"`,
    '--no-alt-screen',
  ];
  const args = [...baseArgs];

  if (prompt) {
    args.push(prompt);
  }

  const command = ['codex', ...baseArgs, prompt ? '<prompt>' : ''].filter(Boolean).join(' ');
  const terminal = spawn('codex', args, {
    name: 'xterm-256color',
    cols: 96,
    rows: 28,
    cwd: options.projectPath,
    env: process.env,
  });

  terminals.set(sessionId, terminal);
  terminalMetadata.set(sessionId, {
    id: sessionId,
    projectPath: options.projectPath,
    command,
    startedAt: new Date().toISOString(),
    role,
    commitAfterTask: role === 'solo' && options.commitAfterTask && commitReadiness.ok,
    commitSkipReason: commitReadiness.ok ? undefined : commitReadiness.reason,
    promptPreview: options.prompt.trim().slice(0, 4000),
    transcriptTail: '',
  });

  terminal.onData((data) => {
    appendTranscriptTail(sessionId, data);
    event.sender.send('terminal:data', sessionId, data);
  });

  terminal.onExit(({ exitCode }) => {
    const metadata = terminalMetadata.get(sessionId);
    terminals.delete(sessionId);
    terminalMetadata.delete(sessionId);
    event.sender.send('terminal:exit', sessionId, exitCode);
    if (metadata) {
      void writeSessionHandoff(metadata.projectPath, createSessionHandoff(metadata, exitCode)).catch((error) => {
        const message = error instanceof Error ? error.message : '未知错误';
        event.sender.send('terminal:data', sessionId, `\r\n[Viewcodex] 会话交接记录生成失败：${message}\r\n`);
      });
    }
    if (metadata?.commitAfterTask) {
      void commitProjectChanges(metadata.projectPath, sessionId, event.sender);
    } else if (metadata?.commitSkipReason && metadata.role === 'solo' && options.commitAfterTask) {
      event.sender.send('terminal:data', sessionId, `\r\n[Viewcodex] 跳过 Git 自动提交：${metadata.commitSkipReason}\r\n`);
    }
  });

  return {
    id: sessionId,
    command,
  };
});

ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) => {
  terminals.get(sessionId)?.write(data);
});

ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
  terminals.get(sessionId)?.resize(cols, rows);
});

ipcMain.handle('terminal:kill', (_event, sessionId: string) => {
  const metadata = terminalMetadata.get(sessionId);
  if (metadata) {
    void writeSessionHandoff(metadata.projectPath, createSessionHandoff(metadata, null));
  }
  terminals.get(sessionId)?.kill();
  terminals.delete(sessionId);
  terminalMetadata.delete(sessionId);
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'Viewcodex',
    backgroundColor: '#f7f7f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.on('close', (event) => {
    if (terminals.size === 0 || quittingAfterTerminalPrompt) {
      return;
    }

    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['取消', '退出并停止 Codex'],
      defaultId: 0,
      cancelId: 0,
      title: '还有 Codex 正在运行',
      message: `还有 ${terminals.size} 个 Codex 进程正在运行。`,
      detail: '退出 Viewcodex 会停止这些 Codex 进程。',
    });

    if (choice === 0) {
      event.preventDefault();
      return;
    }

    for (const terminal of terminals.values()) {
      terminal.kill();
    }
    terminals.clear();
    terminalMetadata.clear();
    quittingAfterTerminalPrompt = true;
    app.quit();
  });

  if (isDev) {
    void window.loadURL('http://127.0.0.1:5173');
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  window.webContents.once('did-finish-load', async () => {
    const hasBridge = await window.webContents.executeJavaScript('Boolean(window.viewcodex)');
    console.log(`[Viewcodex] preload bridge loaded: ${hasBridge}`);
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function buildCodexPrompt(skill: string, prompt: string): string {
  const trimmedPrompt = prompt.trim();
  const trimmedSkill = skill.trim();

  if (!trimmedSkill && !trimmedPrompt) {
    return '';
  }

  if (!trimmedSkill) {
    return trimmedPrompt;
  }

  const normalizedSkill = trimmedSkill.startsWith('$') ? trimmedSkill : `$${trimmedSkill}`;
  return trimmedPrompt ? `${normalizedSkill} ${trimmedPrompt}` : normalizedSkill;
}

function appendTranscriptTail(sessionId: string, data: string): void {
  const metadata = terminalMetadata.get(sessionId);
  if (!metadata) {
    return;
  }

  metadata.transcriptTail = `${metadata.transcriptTail}${data}`.slice(-24_000);
}

function createSessionHandoff(metadata: TerminalRuntimeSession, exitCode: number | null): string {
  const transcriptTail = cleanTerminalTranscript(metadata.transcriptTail).slice(-12_000).trim();
  const promptPreview = metadata.promptPreview.trim();

  return [
    '# Codex 临时交接',
    '',
    '> 这不是项目规范。它只记录上一次 Viewcodex 管理的 Codex 会话状态；下一次启动 Codex 时会自动读取并删除。',
    '',
    `- 项目：${metadata.projectPath}`,
    `- 角色：${formatRoleName(metadata.role)}`,
    `- 开始：${metadata.startedAt}`,
    `- 结束：${new Date().toISOString()}`,
    `- 退出码：${exitCode ?? 'unknown'}`,
    '',
    promptPreview ? `## 上次输入\n\n${promptPreview}` : '',
    transcriptTail ? `## 终端尾部记录\n\n\`\`\`text\n${transcriptTail}\n\`\`\`` : '',
  ].filter(Boolean).join('\n');
}

function cleanTerminalTranscript(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .slice(-220)
    .join('\n');
}

function formatRoleName(role: CodexRole): string {
  const roleNames: Record<CodexRole, string> = {
    solo: 'CLI',
    planner: 'Planner',
    executor: 'Executor',
    reviewer: 'Reviewer',
  };

  return roleNames[role];
}

async function ensureConfiguredProject(projectPath: string): Promise<void> {
  const config = await loadConfig();
  const project = config.projects.find((entry) => entry.path === projectPath);
  if (!project) {
    throw new Error('请先选择已配置项目');
  }
}

async function commitProjectChanges(
  projectPath: string,
  sessionId: string,
  sender: Electron.WebContents,
): Promise<void> {
  try {
    const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectPath });
    if (!status.stdout.trim()) {
      sender.send('terminal:data', sessionId, '\r\n[Viewcodex] Git 没有检测到变更，跳过自动提交。\r\n');
      return;
    }

    await execFileAsync('git', ['add', '-A'], { cwd: projectPath });
    await execFileAsync(
      'git',
      [
        'commit',
        '-m',
        [
          'Capture Viewcodex task result',
          '',
          'Committed automatically after a Viewcodex-managed Codex session completed.',
          '',
          'Confidence: medium',
          'Scope-risk: narrow',
          'Tested: Viewcodex terminal session reached exit handling',
        ].join('\n'),
      ],
      { cwd: projectPath },
    );
    sender.send('terminal:data', sessionId, '\r\n[Viewcodex] Git 自动提交完成。\r\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    sender.send('terminal:data', sessionId, `\r\n[Viewcodex] Git 自动提交失败：${message}\r\n`);
  }
}

async function getCommitReadiness(projectPath: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectPath });
    if (status.stdout.trim()) {
      return { ok: false, reason: '会话开始前仓库已有未提交变更' };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return { ok: false, reason: `无法检查 Git 状态：${message}` };
  }
}

function getGptConfigPath(): string {
  return path.join(app.getPath('home'), '.codex', 'config.toml');
}

async function readGptConfigFile(): Promise<{ path: string; content: string; exists: boolean }> {
  const configFilePath = getGptConfigPath();
  try {
    return {
      path: configFilePath,
      content: await fs.readFile(configFilePath, 'utf8'),
      exists: true,
    };
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) {
      throw error;
    }

    return {
      path: configFilePath,
      content: '',
      exists: false,
    };
  }
}

async function writeGptConfigFile(content: string): Promise<{ path: string; content: string; exists: boolean }> {
  const configFilePath = getGptConfigPath();
  await fs.mkdir(path.dirname(configFilePath), { recursive: true });
  await fs.writeFile(configFilePath, content, 'utf8');
  return {
    path: configFilePath,
    content,
    exists: true,
  };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}
