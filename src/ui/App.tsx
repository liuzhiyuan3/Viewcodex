import {
  BookOpenCheck,
  Eraser,
  FilePlus2,
  FolderOpen,
  GitCommitHorizontal,
  LayoutDashboard,
  Paperclip,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Send,
  Square,
  Star,
  TerminalSquare,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import type {
  CodexRole,
  GitBranchMode,
  GptConfigFile,
  HealthCheckResult,
  ProjectRunConfig,
  SessionHistoryEntry,
  SessionHandoffDoc,
  SkillOption,
  StartupCheckResult,
  StartupDocContextResult,
  StartupDocReadResult,
  TaskAttachment,
  TaskMode,
  TeamRolePrompts,
  TerminalRuntimeSession,
  ViewcodexConfig,
  ViewcodexProject,
} from '../types/viewcodex';

const fallbackConfig: ViewcodexConfig = {
  projects: [
    {
      name: 'Viewcodex',
      path: '/Users/benfit/code/Viewcodex',
      startupDocs: {
        required: ['VIEWCODEX_BRIEF.md', 'docs/viewcodex-visual-cli-requirements.md'],
        optional: [],
      },
      promptDraft: '',
      runConfig: {
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
        contextLengthTokens: 200_000,
        skill: '',
        commitAfterTask: false,
        pushAfterCommit: false,
        taskMode: 'standard',
        gitRepositoryPath: null,
        gitRemoteUrl: '',
        gitBranchMode: 'current',
        gitBranchName: 'viewcodex-task',
      },
    },
  ],
  selectedProjectPath: '/Users/benfit/code/Viewcodex',
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
    { id: 'fix-bug', title: '修复 Bug', category: '开发', prompt: '请调查并修复这个问题，完成后说明根因、改动文件和验证结果：\n\n' },
    { id: 'add-feature', title: '添加功能', category: '开发', prompt: '请实现以下功能，保持改动清晰，并补充必要验证：\n\n' },
    { id: 'ui-polish', title: '优化界面', category: '界面', prompt: '请优化这个界面体验，保持风格一致，检查布局、间距、状态和响应式表现：\n\n' },
    { id: 'code-review', title: '代码审查', category: '质量', prompt: '请做一次代码审查，优先列出 bug、风险、回归点和缺失测试：\n\n' },
    { id: 'write-tests', title: '补充测试', category: '质量', prompt: '请为以下行为补充测试，并运行相关验证：\n\n' },
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

const fallbackSkills: SkillOption[] = [
  { name: 'deep-interview', path: '' },
  { name: 'ralph', path: '' },
  { name: 'code-review', path: '' },
];

type WorkspaceView = 'dashboard' | 'cli' | 'team' | 'docs' | 'config';

type ProjectStartupCheck = StartupCheckResult & {
  projectPath: string;
};

type ProjectStartupDocContext = StartupDocContextResult & {
  projectPath: string;
};

type StartupConfirmation = {
  projectPath: string;
  projectName: string;
  check: StartupCheckResult;
  previewContext: StartupDocContextResult;
};

type CodexSessionView = {
  id: string;
  command: string;
  projectName: string;
  projectPath: string;
  skill: string;
  model: string;
  reasoningEffort: string;
  contextLengthTokens: number;
  promptTokenEstimate: number;
  role: CodexRole;
  status: 'running' | 'exited';
  startedAt: string;
  startedAtMs: number;
  exitCode: number | null;
  terminal: Terminal;
  fitAddon: FitAddon;
};

type StartCodexOverrides = {
  model?: string;
  skill?: string;
  reasoningEffort?: string;
  contextLengthTokens?: number;
};

export function App() {
  const [config, setConfig] = useState<ViewcodexConfig>(fallbackConfig);
  const [availableSkills, setAvailableSkills] = useState<SkillOption[]>(fallbackSkills);
  const [selectedSkill, setSelectedSkill] = useState(fallbackConfig.defaultSkill ?? '');
  const [selectedModel, setSelectedModel] = useState(fallbackConfig.defaultModel ?? fallbackConfig.models[0]);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(fallbackConfig.defaultReasoningEffort);
  const [selectedContextLengthTokens, setSelectedContextLengthTokens] = useState(
    fallbackConfig.defaultContextLengthTokens,
  );
  const [selectedTaskMode, setSelectedTaskMode] = useState<TaskMode>('standard');
  const [codexCliPath, setCodexCliPath] = useState(fallbackConfig.codexCliPath);
  const [commitAfterTask, setCommitAfterTask] = useState(fallbackConfig.commitAfterTask);
  const [pushAfterCommit, setPushAfterCommit] = useState(false);
  const [gitRepositoryPath, setGitRepositoryPath] = useState(
    fallbackConfig.projects[0]?.runConfig.gitRepositoryPath ?? '',
  );
  const [gitRemoteUrl, setGitRemoteUrl] = useState(fallbackConfig.projects[0]?.runConfig.gitRemoteUrl ?? '');
  const [gitBranchMode, setGitBranchMode] = useState<GitBranchMode>('current');
  const [gitBranchName, setGitBranchName] = useState('viewcodex-task');
  const [gitCurrentBranch, setGitCurrentBranch] = useState<string | null>(null);
  const [healthCheck, setHealthCheck] = useState<HealthCheckResult | null>(null);
  const [prompt, setPrompt] = useState('');
  const [newDocPath, setNewDocPath] = useState('docs/project-context.md');
  const [newDocRequired, setNewDocRequired] = useState(true);
  const [newModelName, setNewModelName] = useState('');
  const [gptConfigFile, setGptConfigFile] = useState<GptConfigFile | null>(null);
  const [gptConfigDraft, setGptConfigDraft] = useState('');
  const [promptMemoryTitle, setPromptMemoryTitle] = useState('');
  const [promptMemoryContent, setPromptMemoryContent] = useState('');
  const [editingPromptMemoryId, setEditingPromptMemoryId] = useState<string | null>(null);
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateCategory, setTemplateCategory] = useState('通用');
  const [templatePrompt, setTemplatePrompt] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'favorite' | 'success' | 'failed'>('all');
  const [configDialog, setConfigDialog] = useState<'gpt' | 'prompt' | 'template' | null>(null);
  const [docsResult, setDocsResult] = useState<StartupDocReadResult[]>([]);
  const [startupCheck, setStartupCheck] = useState<ProjectStartupCheck | null>(null);
  const [startupDocContext, setStartupDocContext] = useState<ProjectStartupDocContext | null>(null);
  const [sessionHandoff, setSessionHandoff] = useState<SessionHandoffDoc | null>(null);
  const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null);
  const [selectedDocProjectPath, setSelectedDocProjectPath] = useState<string | null>(null);
  const [selectedDocContent, setSelectedDocContent] = useState('');
  const [readOnlyDoc, setReadOnlyDoc] = useState<{ title: string; subtitle: string; content: string } | null>(null);
  const [startupConfirmation, setStartupConfirmation] = useState<StartupConfirmation | null>(null);
  const [savedDocContent, setSavedDocContent] = useState('');
  const [sessions, setSessions] = useState<CodexSessionView[]>([]);
  const [runningTerminals, setRunningTerminals] = useState<TerminalRuntimeSession[]>([]);
  const [runningProjectPaths, setRunningProjectPaths] = useState<Set<string>>(new Set());
  const [startingProjectPaths, setStartingProjectPaths] = useState<Set<string>>(new Set());
  const [clockNow, setClockNow] = useState(Date.now());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>('cli');
  const [teamStatus, setTeamStatus] = useState('就绪');
  const [selectedTeamRole, setSelectedTeamRole] = useState<Exclude<CodexRole, 'solo'>>('planner');
  const [teamRolePromptDrafts, setTeamRolePromptDrafts] = useState<TeamRolePrompts>(fallbackConfig.teamRolePrompts);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cliInfoCollapsed, setCliInfoCollapsed] = useState(false);
  const [status, setStatus] = useState('就绪');
  const [error, setError] = useState<string | null>(null);
  const terminalsByIdRef = useRef(new Map<string, Terminal>());
  const sessionsRef = useRef<CodexSessionView[]>([]);
  const startingProjectPathsRef = useRef(new Set<string>());
  const outputBySessionIdRef = useRef(new Map<string, string>());
  const forwardedExecutorDoneRef = useRef(new Map<string, number>());
  const forwardedReviewerResultRef = useRef(new Map<string, number>());

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    if (!window.viewcodex) {
      return;
    }

    const offData = window.viewcodex.onTerminalData((sessionId, data) => {
      terminalsByIdRef.current.get(sessionId)?.write(data);
      appendSessionOutput(sessionId, data);
      void handleTeamAutomation(sessionId);
    });

    const offExit = window.viewcodex.onTerminalExit((sessionId, exitCode) => {
      const terminal = terminalsByIdRef.current.get(sessionId);
      if (terminal) {
        terminal.writeln('');
        terminal.writeln(`[Viewcodex] Codex 已退出，退出码：${exitCode ?? 'unknown'}`);
      }

      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, status: 'exited', exitCode } : session,
        ),
      );
      void refreshRunningCodexProcesses();
      void loadConfig();
      setStatus('Codex 会话已退出。');
    });

    return () => {
      offData();
      offExit();
    };
  }, []);

  const selectedProject = useMemo(() => {
    return (
      config.projects.find((project) => project.path === config.selectedProjectPath) ??
      config.projects[0] ??
      null
    );
  }, [config.projects, config.selectedProjectPath]);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeSoloSession =
    sessions.find((session) => session.id === activeSessionId && session.role === 'solo') ??
    sessions.find((session) => session.projectPath === selectedProject?.path && session.role === 'solo') ??
    null;
  const visibleSoloSessions = sessions.filter(
    (session) => session.projectPath === selectedProject?.path && session.role === 'solo',
  );
  const allSessionHistoryForProject = config.sessionHistory.filter(
    (entry) => entry.projectPath === selectedProject?.path,
  );
  const sessionHistoryForProject = allSessionHistoryForProject.slice(0, 12);
  const filteredSessionHistoryForProject = sessionHistoryForProject.filter((entry) => {
    const matchesFilter =
      historyFilter === 'all' ||
      (historyFilter === 'favorite' && entry.favorite) ||
      (historyFilter === 'success' && entry.exitCode === 0) ||
      (historyFilter === 'failed' && entry.exitCode !== 0);
    const normalizedSearch = historySearch.trim().toLowerCase();
    const matchesSearch =
      !normalizedSearch ||
      [entry.promptPreview, entry.transcriptTail, entry.skill, entry.model, entry.role]
        .join('\n')
        .toLowerCase()
        .includes(normalizedSearch);
    return matchesFilter && matchesSearch;
  });
  const favoriteHistoryCount = allSessionHistoryForProject.filter((entry) => entry.favorite).length;
  const failedHistoryCount = allSessionHistoryForProject.filter((entry) => entry.exitCode !== 0).length;
  const docIsDirty = selectedDocPath !== null && selectedDocContent !== savedDocContent;
  const selectedDocProject =
    config.projects.find((project) => project.path === selectedDocProjectPath) ?? selectedProject;
  const selectedProjectIsStarting = selectedProject ? startingProjectPaths.has(selectedProject.path) : false;
  const visibleStartupCheck = startupCheck?.projectPath === selectedProject?.path ? startupCheck : null;
  const visibleStartupDocContext =
    startupDocContext?.projectPath === selectedProject?.path && startupDocContext.taskMode === selectedTaskMode
      ? startupDocContext
      : null;
  const taskAttachmentsForProject = config.taskAttachments.filter(
    (attachment) => attachment.projectPath === selectedProject?.path,
  );
  const taskAttachmentContext = buildTaskAttachmentContext(taskAttachmentsForProject);
  const composedStartupContext = [visibleStartupDocContext?.context ?? '', taskAttachmentContext]
    .filter((entry) => entry.trim())
    .join('\n\n');
  const promptTokenEstimate = estimateTokens(composePromptWithStartupContext(prompt, composedStartupContext));
  const contextUsagePercent =
    selectedContextLengthTokens > 0
      ? Math.min(100, Math.round((promptTokenEstimate / selectedContextLengthTokens) * 100))
      : 0;
  const startupDocCount = selectedProject
    ? selectedProject.startupDocs.required.length + selectedProject.startupDocs.optional.length
    : 0;
  const missingStartupDocs = docsResult.filter((doc) => doc.required && !doc.exists).length;
  const lastAttachment = taskAttachmentsForProject
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshOnFocus = () => {
      void refreshAvailableSkills(false);
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, []);

  useEffect(() => {
    if (!selectedProject || !window.viewcodex) {
      return;
    }

    void refreshStartupDocContext(selectedProject.path, selectedTaskMode);
  }, [selectedProject?.path, selectedTaskMode]);

  useEffect(() => {
    if (!selectedProject || !window.viewcodex) {
      return;
    }

    const timer = window.setTimeout(() => {
      void window.viewcodex
        ?.setProjectPromptDraft(selectedProject.path, prompt)
        .then((nextConfig) => setConfig(nextConfig))
        .catch((caughtError) => setError(toErrorMessage(caughtError)));
    }, 600);

    return () => window.clearTimeout(timer);
  }, [prompt, selectedProject?.path]);

  async function loadConfig() {
    if (!window.viewcodex) {
      setStatus('浏览器预览模式');
      return;
    }

    try {
      const nextConfig = await window.viewcodex.loadConfig();
      const nextGptConfig = await window.viewcodex.readGptConfig();
      setConfig(nextConfig);
      setGptConfigFile(nextGptConfig);
      setGptConfigDraft(nextGptConfig.content);
      setCodexCliPath(nextConfig.codexCliPath);
      setTeamRolePromptDrafts(nextConfig.teamRolePrompts);
      await refreshAvailableSkills(false);
      await runHealthCheck(false);
      applyRememberedProjectState(nextConfig, nextConfig.selectedProjectPath);
      await refreshRunningCodexProcesses();
      await refreshSessionHandoff(nextConfig.selectedProjectPath);
      setStatus(nextConfig.selectedProjectPath ? '已自动选择上次项目。' : '请选择项目。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function refreshAvailableSkills(showStatus = true) {
    if (!window.viewcodex) {
      setAvailableSkills(fallbackSkills);
      return;
    }

    try {
      const nextSkills = await window.viewcodex.listSkills();
      setAvailableSkills(nextSkills.length > 0 ? nextSkills : fallbackSkills);
      if (showStatus) {
        setStatus(`Skills 已刷新：${nextSkills.length}`);
      }
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function runHealthCheck(showStatus = true) {
    if (!window.viewcodex) {
      return;
    }

    try {
      const result = await window.viewcodex.checkHealth();
      setHealthCheck(result);
      if (showStatus) {
        const items = Object.values(result);
        const okCount = items.filter((item) => item.ok).length;
        setStatus(`环境体检：${okCount}/${items.length}`);
      }
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function selectProject() {
    if (!confirmDiscardUnsavedDoc()) {
      return;
    }

    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法打开项目选择器。请使用 npm run dev 启动的 Electron 窗口。');
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.selectProject();
      setConfig(nextConfig);
      applyRememberedProjectState(nextConfig, nextConfig.selectedProjectPath);
      setDocsResult([]);
      setStartupCheck(null);
      await refreshSessionHandoff(nextConfig.selectedProjectPath);
      selectLatestSessionForProject(nextConfig.selectedProjectPath);
      setActiveView('cli');
      setStatus('项目已选择。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function setSelectedProject(projectPath: string) {
    if (!confirmDiscardUnsavedDoc()) {
      return;
    }

    if (!window.viewcodex) {
      setConfig((current) => ({ ...current, selectedProjectPath: projectPath }));
      setStatus('当前是浏览器预览模式，只能临时切换界面状态。');
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.setSelectedProject(projectPath);
      setConfig(nextConfig);
      applyRememberedProjectState(nextConfig, projectPath);
      setDocsResult([]);
      setStartupCheck(null);
      await refreshSessionHandoff(projectPath);
      selectLatestSessionForProject(projectPath);
      setActiveView('cli');
      setStatus('当前项目已切换。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function updateCommitAfterTask(nextValue: boolean) {
    setCommitAfterTask(nextValue);
    if (!nextValue) {
      setPushAfterCommit(false);
    }

    if (!selectedProject || !window.viewcodex) {
      return;
    }

    try {
      await window.viewcodex.setCommitAfterTask(nextValue);
      const nextConfig = await window.viewcodex.setProjectRunConfig(selectedProject.path, {
        commitAfterTask: nextValue,
        pushAfterCommit: nextValue ? pushAfterCommit : false,
      });
      setConfig(nextConfig);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function updatePushAfterCommit(nextValue: boolean) {
    setPushAfterCommit(nextValue);
    await updateProjectRunConfig({ pushAfterCommit: nextValue });
  }

  async function updateSelectedModel(model: string) {
    setSelectedModel(model);
    await updateProjectRunConfig({ model });
  }

  async function updateSelectedReasoningEffort(reasoningEffort: string) {
    setSelectedReasoningEffort(reasoningEffort);
    await updateProjectRunConfig({ reasoningEffort });
  }

  async function updateSelectedContextLength(contextLengthTokens: number) {
    setSelectedContextLengthTokens(contextLengthTokens);
    await updateProjectRunConfig({ contextLengthTokens });
  }

  async function updateSelectedSkill(skill: string) {
    setSelectedSkill(skill);
    await updateProjectRunConfig({ skill });
  }

  async function updateSelectedTaskMode(taskMode: TaskMode) {
    setSelectedTaskMode(taskMode);
    await updateProjectRunConfig({ taskMode });
  }

  async function updateCodexCliPath(nextPath: string) {
    setCodexCliPath(nextPath);
    if (!window.viewcodex) {
      return;
    }

    try {
      const nextConfig = await window.viewcodex.setCodexCliPath(nextPath);
      setConfig(nextConfig);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function updateGitRepositoryPath(repositoryPath: string) {
    setGitRepositoryPath(repositoryPath);
    await updateProjectRunConfig({ gitRepositoryPath: repositoryPath.trim() || null });
  }

  async function updateGitRemoteUrl(remoteUrl: string) {
    setGitRemoteUrl(remoteUrl);
    await updateProjectRunConfig({ gitRemoteUrl: remoteUrl });
  }

  async function updateGitBranchMode(branchMode: GitBranchMode) {
    setGitBranchMode(branchMode);
    await updateProjectRunConfig({ gitBranchMode: branchMode });
  }

  async function updateGitBranchName(branchName: string) {
    setGitBranchName(branchName);
    await updateProjectRunConfig({ gitBranchName: branchName });
  }

  async function detectGitSettings() {
    if (!selectedProject || !window.viewcodex) {
      setError(!window.viewcodex ? '当前环境不是 Electron 窗口，无法检测 Git。' : '请先选择项目。');
      return;
    }

    try {
      setError(null);
      const detected = await window.viewcodex.detectGitConfig(selectedProject.path);
      const nextGitBranchName = gitBranchName.trim() || `viewcodex/${Date.now()}`;
      setGitRepositoryPath(detected.repositoryPath ?? '');
      setGitRemoteUrl(detected.remoteUrl);
      setGitCurrentBranch(detected.currentBranch);
      const nextConfig = await window.viewcodex.setProjectRunConfig(selectedProject.path, {
        gitRepositoryPath: detected.repositoryPath,
        gitRemoteUrl: detected.remoteUrl,
        gitBranchName: nextGitBranchName,
      });
      setConfig(nextConfig);
      setStatus(
        detected.repositoryPath
          ? `Git 已检测：${detected.currentBranch ?? 'detached'}${detected.remoteUrl ? '' : '，未配置 origin'}`
          : '未检测到 Git 仓库',
      );
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function copyRemoteCommand() {
    const remoteUrl = gitRemoteUrl.trim();
    if (!remoteUrl) {
      setStatus('Origin 为空');
      return;
    }

    await navigator.clipboard.writeText(`git remote add origin ${remoteUrl}`);
    setStatus('已复制 remote 命令');
  }

  async function updateProjectRunConfig(runConfig: Partial<ProjectRunConfig>) {
    if (!selectedProject || !window.viewcodex) {
      return;
    }

    try {
      const nextConfig = await window.viewcodex.setProjectRunConfig(selectedProject.path, runConfig);
      setConfig(nextConfig);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function addModelOption() {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法保存模型配置。');
      return;
    }

    try {
      setError(null);
      const normalizedModel = newModelName.trim();
      const nextConfig = await window.viewcodex.addModel(normalizedModel);
      setConfig(nextConfig);
      setSelectedModel(normalizedModel);
      setNewModelName('');
      if (selectedProject) {
        const updatedConfig = await window.viewcodex.setProjectRunConfig(selectedProject.path, {
          model: normalizedModel,
        });
        setConfig(updatedConfig);
      }
      setStatus(`模型已加入：${normalizedModel}`);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function removeSelectedModel() {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法保存模型配置。');
      return;
    }

    try {
      setError(null);
      const removingModel = selectedModel;
      const nextConfig = await window.viewcodex.removeModel(removingModel);
      setConfig(nextConfig);
      applyRememberedProjectState(nextConfig, selectedProject?.path ?? nextConfig.selectedProjectPath);
      setStatus(`模型已移除：${removingModel}`);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function saveGptConfig() {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法保存 GPT 配置文件。');
      return;
    }

    try {
      setError(null);
      const nextFile = await window.viewcodex.writeGptConfig(gptConfigDraft);
      setGptConfigFile(nextFile);
      setGptConfigDraft(nextFile.content);
      setStatus(`GPT 配置已保存：${nextFile.path}`);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function reloadGptConfig() {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法读取 GPT 配置文件。');
      return;
    }

    try {
      setError(null);
      const nextFile = await window.viewcodex.readGptConfig();
      setGptConfigFile(nextFile);
      setGptConfigDraft(nextFile.content);
      setStatus(nextFile.exists ? `已读取 GPT 配置：${nextFile.path}` : `GPT 配置尚未创建：${nextFile.path}`);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function savePromptMemory() {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法保存 Prompt 记忆。');
      return;
    }

    try {
      setError(null);
      const nextConfig = editingPromptMemoryId
        ? await window.viewcodex.updatePromptMemory(editingPromptMemoryId, promptMemoryTitle, promptMemoryContent)
        : await window.viewcodex.addPromptMemory(promptMemoryTitle, promptMemoryContent);
      setConfig(nextConfig);
      clearPromptMemoryEditor();
      setStatus('Prompt 记忆已保存。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function removePromptMemory(id: string) {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法删除 Prompt 记忆。');
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.removePromptMemory(id);
      setConfig(nextConfig);
      if (editingPromptMemoryId === id) {
        clearPromptMemoryEditor();
      }
      setStatus('Prompt 记忆已删除。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  function editPromptMemory(id: string) {
    const memory = config.promptMemories.find((entry) => entry.id === id);
    if (!memory) {
      return;
    }

    setEditingPromptMemoryId(memory.id);
    setPromptMemoryTitle(memory.title);
    setPromptMemoryContent(memory.content);
  }

  function clearPromptMemoryEditor() {
    setEditingPromptMemoryId(null);
    setPromptMemoryTitle('');
    setPromptMemoryContent('');
  }

  function insertPromptMemory(id: string) {
    const memory = config.promptMemories.find((entry) => entry.id === id);
    if (!memory) {
      return;
    }

    setPrompt((current) => [current.trim(), memory.content.trim()].filter(Boolean).join('\n\n'));
    setStatus(`已插入 Prompt 记忆：${memory.title}`);
  }

  function insertTaskTemplate(id: string) {
    const template = config.taskTemplates.find((entry) => entry.id === id);
    if (!template) {
      return;
    }

    setPrompt((current) => [template.prompt.trim(), current.trim()].filter(Boolean).join('\n\n'));
    setStatus(`已使用任务模板：${template.title}`);
  }

  async function saveTaskTemplate() {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法保存任务模板。');
      return;
    }

    try {
      setError(null);
      const nextConfig = editingTemplateId
        ? await window.viewcodex.updateTaskTemplate(editingTemplateId, templateTitle, templateCategory, templatePrompt)
        : await window.viewcodex.addTaskTemplate(templateTitle, templateCategory, templatePrompt);
      setConfig(nextConfig);
      clearTaskTemplateEditor();
      setStatus('任务模板已保存。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function removeTaskTemplate(id: string) {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法删除任务模板。');
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.removeTaskTemplate(id);
      setConfig(nextConfig);
      if (editingTemplateId === id) {
        clearTaskTemplateEditor();
      }
      setStatus('任务模板已删除。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  function editTaskTemplate(id: string) {
    const template = config.taskTemplates.find((entry) => entry.id === id);
    if (!template) {
      return;
    }

    setEditingTemplateId(template.id);
    setTemplateTitle(template.title);
    setTemplateCategory(template.category);
    setTemplatePrompt(template.prompt);
  }

  function clearTaskTemplateEditor() {
    setEditingTemplateId(null);
    setTemplateTitle('');
    setTemplateCategory('通用');
    setTemplatePrompt('');
  }

  function saveHistoryAsTemplate(entry: SessionHistoryEntry) {
    setEditingTemplateId(null);
    setTemplateTitle(entry.promptPreview.slice(0, 24) || '历史会话模板');
    setTemplateCategory(entry.skill || '历史');
    setTemplatePrompt(entry.promptPreview);
    setConfigDialog('template');
  }

  async function toggleHistoryFavorite(id: string) {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法更新历史会话。');
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.toggleSessionHistoryFavorite(id);
      setConfig(nextConfig);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function removeHistoryEntry(id: string) {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法删除历史会话。');
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.removeSessionHistory(id);
      setConfig(nextConfig);
      setStatus('历史会话已删除。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function selectTaskAttachments() {
    if (!selectedProject || !window.viewcodex) {
      setError(!window.viewcodex ? '当前环境不是 Electron 窗口，无法选择附件。' : '请先选择项目。');
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.selectTaskAttachments(selectedProject.path);
      setConfig(nextConfig);
      setStatus('任务附件已更新。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function updateTaskAttachmentNote(id: string, note: string) {
    if (!window.viewcodex) {
      return;
    }

    try {
      const nextConfig = await window.viewcodex.updateTaskAttachmentNote(id, note);
      setConfig(nextConfig);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function removeTaskAttachment(id: string) {
    if (!window.viewcodex) {
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.removeTaskAttachment(id);
      setConfig(nextConfig);
      setStatus('任务附件已移除。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function clearCurrentProjectTaskAttachments() {
    if (!selectedProject || !window.viewcodex) {
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.clearTaskAttachments(selectedProject.path);
      setConfig(nextConfig);
      setStatus('任务附件已清空。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  function viewSessionHistory(entry: SessionHistoryEntry) {
    setReadOnlyDoc({
      title: `历史会话 ${entry.id}`,
      subtitle: `${formatRoleName(entry.role as CodexRole)} · ${formatDateTime(entry.endedAt)}`,
      content: buildSessionHistoryDetail(entry),
    });
  }

  function restoreSessionPrompt(entry: SessionHistoryEntry) {
    setPrompt(entry.promptPreview);
    if (entry.model && config.models.includes(entry.model)) {
      setSelectedModel(entry.model);
      void updateProjectRunConfig({ model: entry.model });
    }
    setSelectedSkill(entry.skill);
    void updateProjectRunConfig({ skill: entry.skill });
    setActiveView('cli');
    setStatus('已恢复历史会话输入。');
  }

  async function continueSessionHistory(entry: SessionHistoryEntry) {
    const project = config.projects.find((candidate) => candidate.path === entry.projectPath);
    if (!project || !window.viewcodex) {
      setError(!window.viewcodex ? '当前环境不是 Electron 窗口，无法继续历史会话。' : '历史会话项目不存在。');
      return;
    }

    try {
      setError(null);
      if (findRunningSessionsForProject(project.path).length > 0) {
        selectLatestSessionForProject(project.path);
        setStatus('当前项目已有 Codex 在运行。需要继续历史会话时，请先停止当前会话。');
        return;
      }

      setProjectStarting(project.path, true);
      const check = await window.viewcodex.checkStartup(project.path);
      setStartupCheck({ ...check, projectPath: project.path });
      setDocsResult(check.docs);
      if (!check.ok) {
        setStatus(`启动检查未通过：${check.errors.join('、')}`);
        return;
      }

      const docContext = await window.viewcodex.getStartupDocContext(project.path, selectedTaskMode, true);
      setStartupDocContext({ ...docContext, projectPath: project.path });
      setSessionHandoff({ path: docContext.handoff?.path ?? '', exists: false, content: null, createdAt: null });
      setDocsResult(docContext.docs);
      const attachments = config.taskAttachments.filter((attachment) => attachment.projectPath === project.path);
      const startupContext = [
        docContext.context,
        buildTaskAttachmentContext(attachments),
        buildSessionHistoryContext(entry),
      ].filter((value) => value.trim()).join('\n\n');
      const continuePrompt = composePromptWithStartupContext(
        '请基于上述历史会话继续推进，优先处理未完成事项，并在完成后说明本次接续做了什么。',
        startupContext,
      );
      await startCodexTerminal(project, 'solo', continuePrompt, {
        model: entry.model || selectedModel,
        skill: entry.skill || selectedSkill,
      });
      setStatus('已从历史会话继续启动 Codex。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    } finally {
      setProjectStarting(project.path, false);
    }
  }

  function applyRememberedProjectState(nextConfig: ViewcodexConfig, projectPath: string | null) {
    const preferences = getProjectPreferences(nextConfig, projectPath);
    setSelectedModel(preferences.model);
    setSelectedReasoningEffort(preferences.reasoningEffort);
    setSelectedContextLengthTokens(preferences.contextLengthTokens);
    setSelectedSkill(preferences.skill);
    setSelectedTaskMode(preferences.taskMode);
    setCommitAfterTask(preferences.commitAfterTask);
    setPushAfterCommit(preferences.pushAfterCommit);
    setGitRepositoryPath(preferences.gitRepositoryPath ?? '');
    setGitRemoteUrl(preferences.gitRemoteUrl);
    setGitBranchMode(preferences.gitBranchMode);
    setGitBranchName(preferences.gitBranchName);
    setPrompt(preferences.promptDraft);
  }

  async function selectStartupDocs() {
    if (!selectedProject || !window.viewcodex) {
      setError(
        !window.viewcodex
          ? '当前环境不是 Electron 窗口，无法选择启动文档。请使用 npm run dev 启动的 Electron 窗口。'
          : '请先选择项目。',
      );
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.selectStartupDocs(selectedProject.path, newDocRequired);
      setConfig(nextConfig);
      setDocsResult([]);
      setStartupCheck(null);
      setStartupDocContext(null);
      setStatus('启动文档已更新。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function createStartupDoc() {
    if (!selectedProject || !window.viewcodex) {
      setError(
        !window.viewcodex
          ? '当前环境不是 Electron 窗口，无法创建启动文档。请使用 npm run dev 启动的 Electron 窗口。'
          : '请先选择项目。',
      );
      return;
    }

    if (!newDocPath.trim()) {
      setError('请输入要创建的 Markdown 文档路径。');
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.createStartupDocWithDialog(
        selectedProject.path,
        newDocPath,
        newDocRequired,
      );
      setConfig(nextConfig);
      setDocsResult([]);
      setStartupCheck(null);
      setStatus('启动文档已创建并加入列表。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function removeStartupDoc(docPath: string) {
    if (!selectedProject || !window.viewcodex) {
      setError('请在 Electron 窗口中先选择项目。');
      return;
    }

    const removingOpenDoc = selectedDocPath === docPath && selectedDocProjectPath === selectedProject.path;
    if (removingOpenDoc && !confirmDiscardUnsavedDoc()) {
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.removeStartupDoc(selectedProject.path, docPath);
      setConfig(nextConfig);
      setDocsResult([]);
      setStartupCheck(null);
      if (removingOpenDoc) {
        setSelectedDocPath(null);
        setSelectedDocProjectPath(null);
        setSelectedDocContent('');
        setSavedDocContent('');
      }
      setStatus('启动文档已从列表移除，原文件未删除。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function viewStartupDoc(docPath: string) {
    if (!selectedProject || !window.viewcodex) {
      setError('请在 Electron 窗口中先选择项目。');
      return;
    }

    if (!confirmDiscardUnsavedDoc()) {
      return;
    }

    try {
      setError(null);
      const result = await window.viewcodex.readStartupDoc(selectedProject.path, docPath);
      const content = result.content ?? result.error ?? '文档为空或无法读取。';
      setSelectedDocPath(docPath);
      setSelectedDocProjectPath(selectedProject.path);
      setSelectedDocContent(content);
      setSavedDocContent(content);
      setStatus(`正在编辑启动文档：${docPath}`);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function saveStartupDoc() {
    if (!selectedDocProjectPath || !selectedDocPath || !window.viewcodex) {
      setError('请先在 Electron 窗口中打开启动文档。');
      return;
    }

    try {
      setError(null);
      await window.viewcodex.writeStartupDoc(selectedDocProjectPath, selectedDocPath, selectedDocContent);
      setSavedDocContent(selectedDocContent);
      if (selectedDocProjectPath === selectedProject?.path) {
        await refreshStartupDocContext(selectedDocProjectPath, selectedTaskMode);
      }
      setStatus(`启动文档已保存：${selectedDocPath}`);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  function closeStartupDocEditor() {
    if (docIsDirty && !window.confirm('文档还没有保存，确定关闭吗？')) {
      return;
    }

    setSelectedDocPath(null);
    setSelectedDocProjectPath(null);
    setSelectedDocContent('');
    setSavedDocContent('');
  }

  function confirmDiscardUnsavedDoc(): boolean {
    return !docIsDirty || window.confirm('文档还没有保存，确定放弃修改吗？');
  }

  async function runStartupCheck(): Promise<StartupCheckResult | null> {
    if (!selectedProject || !window.viewcodex) {
      setError(
        !window.viewcodex
          ? '当前环境不是 Electron 窗口，无法检查启动环境。'
          : '请先选择项目。',
      );
      return null;
    }

    try {
      setError(null);
      const result = await window.viewcodex.checkStartup(selectedProject.path);
      setStartupCheck({ ...result, projectPath: selectedProject.path });
      setDocsResult(result.docs);
      if (result.ok) {
        void refreshStartupDocContext(selectedProject.path, selectedTaskMode);
      }
      setStatus(result.ok ? '启动检查通过。' : `启动检查未通过：${result.errors.join('、')}`);
      return result;
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
      return null;
    }
  }

  async function openDefaultStartupDoc() {
    const defaultDoc = selectedProject?.startupDocs.required[0] ?? selectedProject?.startupDocs.optional[0];
    if (!defaultDoc) {
      setStatus('当前项目还没有启动文档。');
      return;
    }

    await viewStartupDoc(defaultDoc);
  }

  async function readDocsBeforeRun(): Promise<boolean> {
    if (!selectedProject || !window.viewcodex) {
      setError(
        !window.viewcodex
          ? '当前环境不是 Electron 窗口，无法启动 Codex。请在 Electron 窗口中点击“读取并启动”，不要在普通浏览器里启动。'
          : '请先选择项目。',
      );
      return false;
    }

    try {
      setError(null);
      if (startingProjectPathsRef.current.has(selectedProject.path)) {
        setStatus('当前项目正在启动 Codex。');
        return false;
      }

      const existingSessions = findRunningSessionsForProject(selectedProject.path);
      if (existingSessions.length > 0) {
        selectLatestSessionForProject(selectedProject.path);
        setStatus('当前项目已有 Codex 在运行。需要重新启动时，请点击“重启”。');
        return false;
      }

      setProjectStarting(selectedProject.path, true);
      const check = await runStartupCheck();
      if (!check?.ok) {
        return false;
      }

      const docContext = await window.viewcodex.getStartupDocContext(selectedProject.path, selectedTaskMode, false);
      setStartupDocContext({ ...docContext, projectPath: selectedProject.path });
      setDocsResult(docContext.docs);
      setStartupConfirmation({
        projectPath: selectedProject.path,
        projectName: selectedProject.name,
        check,
        previewContext: docContext,
      });
      setStatus('等待启动确认');
      return false;
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
      return false;
    } finally {
      setProjectStarting(selectedProject.path, false);
    }
  }

  async function confirmStartupRun(): Promise<boolean> {
    if (!startupConfirmation || !window.viewcodex) {
      return false;
    }
    const project = config.projects.find((entry) => entry.path === startupConfirmation.projectPath);
    if (!project) {
      setError('确认的项目已不存在');
      return false;
    }

    try {
      setError(null);
      setProjectStarting(startupConfirmation.projectPath, true);
      const docContext = await window.viewcodex.getStartupDocContext(startupConfirmation.projectPath, selectedTaskMode, true);
      setStartupDocContext({ ...docContext, projectPath: startupConfirmation.projectPath });
      setSessionHandoff({ path: docContext.handoff?.path ?? '', exists: false, content: null, createdAt: null });
      setDocsResult(docContext.docs);
      const attachments = config.taskAttachments.filter(
        (attachment) => attachment.projectPath === startupConfirmation.projectPath,
      );
      const startupContext = [docContext.context, buildTaskAttachmentContext(attachments)]
        .filter((entry) => entry.trim())
        .join('\n\n');
      const startupPrompt = composePromptWithStartupContext(prompt, startupContext);
      await startCodexTerminal(project, 'solo', startupPrompt);
      setStartupConfirmation(null);
      setStatus(
        `已按${formatTaskMode(selectedTaskMode)}模式读取 ${docContext.docs.filter((doc) => doc.exists).length} 份启动文档和 ${attachments.length} 个附件，预计 ${estimateTokens(startupPrompt)} tokens。`,
      );
      return true;
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
      return false;
    } finally {
      setProjectStarting(startupConfirmation.projectPath, false);
    }
  }

  async function refreshWorkspaceStatus() {
    try {
      setError(null);
      await loadConfig();
      await refreshRunningCodexProcesses();

      if (selectedProject && window.viewcodex) {
        const result = await window.viewcodex.readStartupDocs(selectedProject.path);
        setDocsResult(result);
        await refreshSessionHandoff(selectedProject.path);
        void refreshStartupDocContext(selectedProject.path, selectedTaskMode);
        selectLatestSessionForProject(selectedProject.path);
        setStatus(`已刷新：${result.filter((doc) => doc.exists).length} 份启动文档可读。`);
      } else {
        setStatus('已刷新。');
      }
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function refreshStartupDocContext(projectPath: string, taskMode: TaskMode) {
    if (!window.viewcodex) {
      return;
    }

    try {
      const context = await window.viewcodex.getStartupDocContext(projectPath, taskMode);
      setStartupDocContext({ ...context, projectPath });
      setSessionHandoff(context.handoff);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function refreshSessionHandoff(projectPath: string | null) {
    if (!projectPath || !window.viewcodex) {
      setSessionHandoff(null);
      return;
    }

    try {
      setSessionHandoff(await window.viewcodex.readSessionHandoff(projectPath));
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  function viewSessionHandoff() {
    if (!sessionHandoff?.exists || !sessionHandoff.content) {
      setStatus('暂无交接');
      return;
    }

    setReadOnlyDoc({
      title: sessionHandoff.path,
      subtitle: sessionHandoff.createdAt ? `生成于 ${formatDateTime(sessionHandoff.createdAt)}` : '临时交接',
      content: sessionHandoff.content,
    });
  }

  async function clearCurrentProjectSessionHistory() {
    if (!selectedProject || !window.viewcodex) {
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.clearSessionHistory(selectedProject.path);
      setConfig(nextConfig);
      setStatus('会话历史已清空');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function restartCodex() {
    if (!selectedProject || !window.viewcodex) {
      setError('请先在 Electron 窗口中选择项目。');
      return;
    }

    try {
      setError(null);
      const runningSessions = findRunningSessionsForProject(selectedProject.path);

      for (const runningSession of runningSessions) {
        await window.viewcodex.killTerminal(runningSession.id);
        terminalsByIdRef.current.get(runningSession.id)?.writeln('');
        terminalsByIdRef.current.get(runningSession.id)?.writeln('[Viewcodex] Codex 已被重启操作停止。');
      }

      if (runningSessions.length > 0) {
        const runningIds = new Set(runningSessions.map((session) => session.id));
        setSessions((current) =>
          current.map((session) =>
            runningIds.has(session.id) ? { ...session, status: 'exited', exitCode: null } : session,
          ),
        );
        await refreshRunningCodexProcesses();
      }

      const started = await readDocsBeforeRun();
      if (started) {
        setStatus('Codex 已重启。');
      }
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function stopCodex() {
    if (!selectedProject || !window.viewcodex) {
      setError('请先在 Electron 窗口中选择项目。');
      return;
    }

    try {
      setError(null);
      const runningSessions = findRunningSessionsForProject(selectedProject.path);
      if (runningSessions.length === 0) {
        setStatus('当前项目没有运行中的 Codex。');
        return;
      }

      for (const runningSession of runningSessions) {
        await window.viewcodex.killTerminal(runningSession.id);
        terminalsByIdRef.current.get(runningSession.id)?.writeln('');
        terminalsByIdRef.current.get(runningSession.id)?.writeln('[Viewcodex] Codex 已停止。');
      }

      const runningIds = new Set(runningSessions.map((session) => session.id));
      setSessions((current) =>
        current.map((session) =>
          runningIds.has(session.id) ? { ...session, status: 'exited', exitCode: null } : session,
        ),
      );
      await refreshRunningCodexProcesses();
      setStatus('Codex 已停止。');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  function clearActiveTerminal() {
    if (!activeSoloSession) {
      setStatus('没有可清屏的 CLI。');
      return;
    }

    activeSoloSession.terminal.clear();
    setStatus('CLI 已清屏。');
  }

  async function startTeam() {
    if (!selectedProject) {
      setError('请先选择项目。');
      return;
    }

    try {
      setError(null);
      await ensureTeamSession('planner');
      setActiveView('team');
      setSelectedTeamRole('planner');
      setTeamStatus('Planner 已启动');
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  async function sendPromptToPlanner() {
    if (!prompt.trim()) {
      setStatus('请先输入需求。');
      return;
    }

    const planner = await ensureTeamSession('planner');
    await sendTextToSession(planner.id, `需求：\n${prompt.trim()}`);
    setTeamStatus('已发送给 Planner');
  }

  async function sendPlannerToExecutionGroup() {
    if (!selectedProject) {
      setError('请先选择项目。');
      return;
    }

    const planner = getRoleSession('planner');
    const plannerOutput = planner
      ? compactOutputForForward(outputBySessionIdRef.current.get(planner.id) ?? '', 180)
      : '';
    if (!plannerOutput.trim()) {
      setTeamStatus('Planner 还没有可发送的输出。');
      return;
    }

    const executor = await ensureTeamSession('executor');
    await ensureTeamSession('reviewer');
    setSelectedTeamRole('executor');
    forwardedExecutorDoneRef.current.clear();
    forwardedReviewerResultRef.current.clear();
    await sendTextToSession(
      executor.id,
      `按下面精简 Planner 方案执行。完成实现和验证后，最后单独输出 VIEWCODEX_EXECUTOR_DONE。\n\n${plannerOutput}`,
    );
    setTeamStatus('Planner 方案已发送给 Executor。Executor 完成后会自动交给 Reviewer。');
  }

  async function ensureTeamSession(role: Exclude<CodexRole, 'solo'>): Promise<CodexSessionView> {
    const existing = getRoleSession(role);
    if (existing?.status === 'running') {
      return existing;
    }

    if (!selectedProject || !window.viewcodex) {
      throw new Error(!window.viewcodex ? '当前环境不是 Electron 窗口，无法启动 Team' : '请先选择项目');
    }

    const docContext = await window.viewcodex.getStartupDocContext(selectedProject.path, selectedTaskMode, true);
    setStartupDocContext({ ...docContext, projectPath: selectedProject.path });
    setSessionHandoff({ path: docContext.handoff?.path ?? '', exists: false, content: null, createdAt: null });
    const rolePrompt = composePromptWithStartupContext(
      getTeamRolePrompt(role, config.teamRolePrompts),
      docContext.context,
      '角色提示词',
    );
    return startCodexTerminal(selectedProject, role, rolePrompt);
  }

  async function saveSelectedTeamRolePrompt() {
    if (!window.viewcodex) {
      setError('当前环境不是 Electron 窗口，无法保存角色提示词。');
      return;
    }

    try {
      setError(null);
      const nextConfig = await window.viewcodex.setTeamRolePrompt(
        selectedTeamRole,
        teamRolePromptDrafts[selectedTeamRole],
      );
      setConfig(nextConfig);
      setTeamRolePromptDrafts(nextConfig.teamRolePrompts);
      setTeamStatus(`${formatRoleName(selectedTeamRole)} 提示词已保存。新启动的角色会使用它。`);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    }
  }

  function getRoleSession(role: Exclude<CodexRole, 'solo'>): CodexSessionView | null {
    return (
      sessionsRef.current.find(
        (session) => session.projectPath === selectedProject?.path && session.role === role && session.status === 'running',
      ) ?? null
    );
  }

  function selectTeamRole(role: Exclude<CodexRole, 'solo'>) {
    setSelectedTeamRole(role);
    const roleSession = sessionsRef.current.find(
      (session) => session.projectPath === selectedProject?.path && session.role === role,
    );
    if (roleSession) {
      setActiveSessionId(roleSession.id);
    }
  }

  async function sendTextToSession(sessionId: string, message: string) {
    if (!window.viewcodex) {
      throw new Error('当前环境不是 Electron 窗口，无法发送消息');
    }

    terminalsByIdRef.current.get(sessionId)?.writeln('');
    terminalsByIdRef.current.get(sessionId)?.writeln('[Viewcodex] 已发送协作消息。');
    await window.viewcodex.writeTerminal(sessionId, `${message}\r`);
  }

  function appendSessionOutput(sessionId: string, data: string) {
    const current = outputBySessionIdRef.current.get(sessionId) ?? '';
    outputBySessionIdRef.current.set(sessionId, `${current}${data}`.slice(-40_000));
  }

  async function handleTeamAutomation(sessionId: string) {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session || session.role === 'solo') {
      return;
    }

    const output = cleanTerminalOutput(outputBySessionIdRef.current.get(sessionId) ?? '');

    if (session.role === 'executor' && output.includes('VIEWCODEX_EXECUTOR_DONE')) {
      const markerIndex = output.lastIndexOf('VIEWCODEX_EXECUTOR_DONE');
      const lastForwardedIndex = forwardedExecutorDoneRef.current.get(sessionId) ?? -1;
      if (markerIndex <= lastForwardedIndex) {
        return;
      }

      const reviewer = getRoleSession('reviewer');
      if (!reviewer) {
        return;
      }

      forwardedExecutorDoneRef.current.set(sessionId, markerIndex);
      const compactOutput = compactOutputForForward(output, 220);
      await sendTextToSession(
        reviewer.id,
        `审核 Executor 的精简实现与验证结果。通过时最后单独输出 VIEWCODEX_REVIEW_APPROVED；有问题时列出问题并最后单独输出 VIEWCODEX_REVIEW_CHANGES。\n\n${compactOutput}`,
      );
      setSelectedTeamRole('reviewer');
      setTeamStatus('Executor 已完成，结果已自动发送给 Reviewer。');
    }

    if (session.role === 'reviewer') {
      const hasChanges = output.includes('VIEWCODEX_REVIEW_CHANGES');
      const hasApproved = output.includes('VIEWCODEX_REVIEW_APPROVED');
      const changeMarkerIndex = output.lastIndexOf('VIEWCODEX_REVIEW_CHANGES');
      const approvedMarkerIndex = output.lastIndexOf('VIEWCODEX_REVIEW_APPROVED');
      const lastForwardedIndex = forwardedReviewerResultRef.current.get(sessionId) ?? -1;

      if (hasApproved && approvedMarkerIndex > lastForwardedIndex) {
        forwardedReviewerResultRef.current.set(sessionId, approvedMarkerIndex);
        setTeamStatus('Reviewer 已通过，执行组完成。');
        return;
      }

      if (hasChanges && changeMarkerIndex > lastForwardedIndex) {
        const executor = getRoleSession('executor');
        if (!executor) {
          return;
        }

        forwardedReviewerResultRef.current.set(sessionId, changeMarkerIndex);
        const compactOutput = compactOutputForForward(output, 180);
        await sendTextToSession(
          executor.id,
          `Reviewer 发现问题，请修复后重新验证，并最后单独输出 VIEWCODEX_EXECUTOR_DONE。\n\n${compactOutput}`,
        );
        setSelectedTeamRole('executor');
        setTeamStatus('Reviewer 发现问题，意见已自动发回 Executor。');
      }
    }
  }

  async function startCodexTerminal(
    project: ViewcodexProject,
    role: CodexRole = 'solo',
    promptOverride = prompt,
    overrides: StartCodexOverrides = {},
  ): Promise<CodexSessionView> {
    if (!window.viewcodex) {
      throw new Error('当前环境不是 Electron 窗口，无法启动内嵌终端');
    }

    const sessionModel = overrides.model ?? selectedModel;
    const sessionSkill = overrides.skill ?? selectedSkill;
    const sessionReasoningEffort = overrides.reasoningEffort ?? selectedReasoningEffort;
    const sessionContextLength = overrides.contextLengthTokens ?? selectedContextLengthTokens;
    const { terminal, fitAddon } = createTerminal();
    terminal.writeln('[Viewcodex] 正在启动 Codex CLI...');
    terminal.writeln(`[Viewcodex] 项目：${project.path}`);
    terminal.writeln(`[Viewcodex] 角色：${formatRoleName(role)}`);
    terminal.writeln(`[Viewcodex] Skill：${sessionSkill || '不使用'}`);
    terminal.writeln(`[Viewcodex] 模型：${sessionModel}`);
    terminal.writeln(`[Viewcodex] 思考强度：${sessionReasoningEffort}`);
    terminal.writeln(`[Viewcodex] 上下文长度：${formatContextLength(sessionContextLength)}`);
    if (role === 'solo') {
      terminal.writeln(`[Viewcodex] 任务模式：${formatTaskMode(selectedTaskMode)}`);
    }
    terminal.writeln('');

    const session = await window.viewcodex.startTerminal({
      projectPath: project.path,
      model: sessionModel,
      reasoningEffort: sessionReasoningEffort,
      skill: role === 'solo' ? sessionSkill : '',
      prompt: promptOverride,
      commitAfterTask: role === 'solo' && commitAfterTask,
      pushAfterCommit: role === 'solo' && pushAfterCommit,
      gitRepositoryPath: gitRepositoryPath.trim() || null,
      gitRemoteUrl: gitRemoteUrl.trim(),
      gitBranchMode,
      gitBranchName: gitBranchName.trim(),
      role,
    });
    const startedAt = new Date();
    const sessionPromptTokenEstimate = estimateTokens(promptOverride);
    setRunningTerminals((current) => [
      ...current.filter((terminalSession) => terminalSession.id !== session.id),
      {
        ...session,
        projectPath: project.path,
        startedAt: startedAt.toISOString(),
        role,
        commitAfterTask: role === 'solo' && commitAfterTask,
        pushAfterCommit: role === 'solo' && pushAfterCommit,
      },
    ]);
    setRunningProjectPaths((current) => new Set([...current, project.path]));

    terminal.onData((data) => {
      void window.viewcodex?.writeTerminal(session.id, data);
    });
    terminalsByIdRef.current.set(session.id, terminal);

    const nextSession: CodexSessionView = {
        id: session.id,
        command: session.command,
        projectName: project.name,
        projectPath: project.path,
        skill: role === 'solo' ? sessionSkill : '',
        model: sessionModel,
        reasoningEffort: sessionReasoningEffort,
        contextLengthTokens: sessionContextLength,
        promptTokenEstimate: sessionPromptTokenEstimate,
        role,
        status: 'running',
        startedAt: startedAt.toLocaleTimeString(),
        startedAtMs: startedAt.getTime(),
        exitCode: null,
        terminal,
        fitAddon,
      };

    setSessions((current) => [nextSession, ...current]);
    setActiveSessionId(session.id);
    setActiveView(role === 'solo' ? 'cli' : 'team');
    return nextSession;
  }

  function selectLatestSessionForProject(projectPath: string | null) {
    if (!projectPath) {
      setActiveSessionId(null);
      return;
    }

    const latestSession = sessions.find((session) => session.projectPath === projectPath);
    setActiveSessionId(latestSession?.id ?? null);
  }

  async function refreshRunningCodexProcesses() {
    if (!window.viewcodex) {
      return;
    }

    const runningTerminals = await window.viewcodex.listTerminals();
    setRunningTerminals(runningTerminals);
    setRunningProjectPaths(new Set(runningTerminals.map((session) => session.projectPath)));
  }

  function findRunningSessionsForProject(projectPath: string): Array<{ id: string }> {
    const runtimeSessions = runningTerminals.filter((session) => session.projectPath === projectPath);
    const runtimeIds = new Set(runtimeSessions.map((session) => session.id));
    const frontendSessions = sessions.filter(
      (session) =>
        session.projectPath === projectPath && session.status === 'running' && !runtimeIds.has(session.id),
    );

    return [...runtimeSessions, ...frontendSessions];
  }

  function setProjectStarting(projectPath: string, starting: boolean) {
    const next = new Set(startingProjectPathsRef.current);
    if (starting) {
      next.add(projectPath);
    } else {
      next.delete(projectPath);
    }

    startingProjectPathsRef.current = next;
    setStartingProjectPaths(new Set(next));
  }

  function getRunningDurationLabel(projectPath: string): string | null {
    const runtimeSession = runningTerminals.find((session) => session.projectPath === projectPath);
    const startedAtMs =
      runtimeSession ? Date.parse(runtimeSession.startedAt) : sessions.find(
        (session) => session.projectPath === projectPath && session.status === 'running',
      )?.startedAtMs;

    if (!startedAtMs || Number.isNaN(startedAtMs)) {
      return null;
    }

    return formatDuration(clockNow - startedAtMs);
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar" aria-hidden={sidebarCollapsed}>
        <div className="project-sidebar-header">
          <div className="brand">
            <TerminalSquare size={24} />
            <div>
              <strong>Viewcodex</strong>
              <span>Workbench</span>
            </div>
          </div>
          <button className="sidebar-action" onClick={selectProject}>
            <FolderOpen size={16} />
            选择项目
          </button>
        </div>

        <div className="sidebar-projects">
          {config.projects.length === 0 ? (
            <p className="empty-text">暂无项目</p>
          ) : (
            config.projects.map((project) => (
              <ProjectRow
                key={project.path}
                project={project}
                selected={project.path === selectedProject?.path}
                active={
                  runningProjectPaths.has(project.path) ||
                  sessions.some((session) => session.projectPath === project.path && session.status === 'running')
                }
                durationLabel={getRunningDurationLabel(project.path)}
                onSelect={() => void setSelectedProject(project.path)}
              />
            ))
          )}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{selectedProject?.name ?? '选择项目'}</h1>
            <p>{selectedProject?.path ?? '未选择项目'}</p>
          </div>
          <div className="topbar-actions">
            <button
              className={`workspace-tab ${activeView === 'dashboard' ? 'active' : ''}`}
              title="工作台"
              aria-label="工作台"
              onClick={() => setActiveView('dashboard')}
            >
              <LayoutDashboard size={16} />
            </button>
            <button
              className={`workspace-tab ${activeView === 'cli' ? 'active' : ''}`}
              title="CLI"
              aria-label="CLI"
              onClick={() => setActiveView('cli')}
            >
              <TerminalSquare size={16} />
            </button>
            <button
              className={`workspace-tab ${activeView === 'team' ? 'active' : ''}`}
              title="Team"
              aria-label="Team"
              onClick={() => setActiveView('team')}
            >
              <Users size={16} />
            </button>
            <button
              className={`workspace-tab ${activeView === 'docs' ? 'active' : ''}`}
              title="文档"
              aria-label="文档"
              onClick={() => setActiveView('docs')}
            >
              <BookOpenCheck size={16} />
            </button>
            <button
              className={`workspace-tab ${activeView === 'config' ? 'active' : ''}`}
              title="配置"
              aria-label="配置"
              onClick={() => setActiveView('config')}
            >
              <GitCommitHorizontal size={16} />
            </button>
            <button className="primary-button" disabled={selectedProjectIsStarting} onClick={readDocsBeforeRun}>
              <Play size={17} />
              {selectedProjectIsStarting ? '启动中' : '启动'}
            </button>
            <button
              className="workspace-tab"
              title={sidebarCollapsed ? '显示项目' : '最大化 CLI'}
              aria-label={sidebarCollapsed ? '显示项目' : '最大化 CLI'}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
        </header>

        <section className="status-strip">
          <span>{status}</span>
          {error ? <strong>{error}</strong> : null}
        </section>

        {visibleStartupCheck ? (
          <section className="preflight-strip">
            <span className={visibleStartupCheck.projectExists ? 'result-ok' : 'result-error'}>
              项目{visibleStartupCheck.projectExists ? '可访问' : '不可访问'}
            </span>
            <span className={visibleStartupCheck.codexAvailable ? 'result-ok' : 'result-error'}>
              Codex{visibleStartupCheck.codexAvailable ? '可用' : '不可用'}
            </span>
            <span className={visibleStartupCheck.docs.every((doc) => !doc.required || doc.exists) ? 'result-ok' : 'result-error'}>
              文档 {visibleStartupCheck.docs.filter((doc) => doc.exists).length}/{visibleStartupCheck.docs.length}
            </span>
          </section>
        ) : null}

        {activeView === 'dashboard' ? (
          <section className="workspace-view dashboard-view">
            <div className="panel-title-row">
              <h2>项目工作台</h2>
              <div className="compact-actions">
                <button onClick={() => void refreshWorkspaceStatus()}>
                  <RefreshCw size={15} />
                  刷新
                </button>
              </div>
            </div>
            <div className="dashboard-grid">
              <DashboardMetric
                label="启动文档"
                value={`${startupDocCount}`}
                detail={`必读 ${selectedProject?.startupDocs.required.length ?? 0} · 可选 ${selectedProject?.startupDocs.optional.length ?? 0}`}
              />
              <DashboardMetric
                label="任务附件"
                value={`${taskAttachmentsForProject.length}`}
                detail={taskAttachmentsForProject.length > 0 ? '启动时随 prompt 发送' : '暂无'}
              />
              <DashboardMetric
                label="最近会话"
                value={`${allSessionHistoryForProject.length}`}
                detail={`收藏 ${favoriteHistoryCount} · 失败 ${failedHistoryCount}`}
              />
              <DashboardMetric
                label="上下文"
                value={formatContextLength(selectedContextLengthTokens)}
                detail={`当前估算 ${formatTokenCount(promptTokenEstimate)} · ${contextUsagePercent}%`}
              />
              <DashboardMetric
                label="运行会话"
                value={`${visibleSoloSessions.filter((session) => session.status === 'running').length}`}
                detail={activeSoloSession?.status === 'running' ? 'Solo 运行中' : 'Solo 未运行'}
              />
              <DashboardMetric
                label="任务模板"
                value={`${config.taskTemplates.length}`}
                detail={`${new Set(config.taskTemplates.map((template) => template.category)).size} 个分类`}
              />
              <DashboardMetric
                label="资源"
                value={`${config.promptMemories.length + taskAttachmentsForProject.length}`}
                detail={`Prompt ${config.promptMemories.length} · 附件 ${taskAttachmentsForProject.length}`}
              />
              <DashboardMetric
                label="Skills"
                value={`${availableSkills.length}`}
                detail={selectedSkill || '当前未选择'}
              />
            </div>
            <div className="dashboard-columns">
              <section className="dashboard-panel">
                <h3>运行状态</h3>
                <div className="health-row">
                  <span className={activeSoloSession?.status === 'running' ? 'result-ok' : 'result-error'}>
                    Solo
                  </span>
                  <strong>{activeSoloSession?.status === 'running' ? '运行中' : '未启动'}</strong>
                  <small>{activeSoloSession?.command ?? '无命令'}</small>
                </div>
                <div className="health-row">
                  <span className={sessionHandoff?.exists ? 'result-ok' : 'result-error'}>交接</span>
                  <strong>{sessionHandoff?.exists ? '待读取' : '无'}</strong>
                  <small>{sessionHandoff?.createdAt ? formatDateTime(sessionHandoff.createdAt) : '下一次启动会自动检查'}</small>
                </div>
                <div className="health-row">
                  <span className={selectedSkill ? 'result-ok' : 'result-error'}>Skill</span>
                  <strong>{selectedSkill || '不使用'}</strong>
                  <small>{formatTaskMode(selectedTaskMode)}模式</small>
                </div>
                <div className="health-row">
                  <span className={lastAttachment ? 'result-ok' : 'result-error'}>附件</span>
                  <strong>{lastAttachment ? lastAttachment.originalName : '无'}</strong>
                  <small>{lastAttachment ? formatDateTime(lastAttachment.createdAt) : '本项目暂无任务附件'}</small>
                </div>
              </section>
              <section className="dashboard-panel">
                <h3>Git</h3>
                <div className="health-row">
                  <span className={gitRepositoryPath ? 'result-ok' : 'result-error'}>仓库</span>
                  <strong>{gitRepositoryPath ? '已配置' : '未配置'}</strong>
                  <small>{gitRepositoryPath || selectedProject?.path || '未选择项目'}</small>
                </div>
                <div className="health-row">
                  <span className={gitRemoteUrl ? 'result-ok' : 'result-error'}>Origin</span>
                  <strong>{gitRemoteUrl ? '已填写' : '未填写'}</strong>
                  <small>{gitRemoteUrl || '需要用户或检测提供远程仓库 URL'}</small>
                </div>
                <div className="health-row">
                  <span className={gitBranchMode === 'new' ? 'result-ok' : 'result-error'}>分支</span>
                  <strong>{gitBranchMode === 'new' ? '创建任务分支' : '沿用当前分支'}</strong>
                  <small>{gitBranchMode === 'new' ? gitBranchName : gitCurrentBranch ?? '未检测'}</small>
                </div>
              </section>
              <section className="dashboard-panel">
                <h3>最近任务</h3>
                {allSessionHistoryForProject.length > 0 ? (
                  allSessionHistoryForProject.slice(0, 5).map((entry) => (
                    <div className="health-row" key={entry.id}>
                      <span className={entry.exitCode === 0 ? 'result-ok' : 'result-error'}>
                        {entry.favorite ? '收藏' : '历史'}
                      </span>
                      <strong>{entry.skill || entry.model || formatRoleName(entry.role as CodexRole)}</strong>
                      <small>{formatDateTime(entry.endedAt)}</small>
                    </div>
                  ))
                ) : (
                  <p className="empty-text">暂无历史</p>
                )}
              </section>
              <section className="dashboard-panel">
                <h3>文档健康</h3>
                <div className="health-row">
                  <span className={missingStartupDocs === 0 ? 'result-ok' : 'result-error'}>必读</span>
                  <strong>{missingStartupDocs === 0 ? '完整' : `缺失 ${missingStartupDocs}`}</strong>
                  <small>{docsResult.length > 0 ? '来自最近一次读取结果' : '等待启动检查'}</small>
                </div>
                <div className="health-row">
                  <span className={sessionHandoff?.exists ? 'result-ok' : 'result-error'}>交接</span>
                  <strong>{sessionHandoff?.exists ? '待读取' : '无'}</strong>
                  <small>{sessionHandoff?.createdAt ? formatDateTime(sessionHandoff.createdAt) : '新会话会自动读取后删除'}</small>
                </div>
                <div className="health-row">
                  <span className={startupDocCount > 0 ? 'result-ok' : 'result-error'}>总数</span>
                  <strong>{startupDocCount}</strong>
                  <small>必读 {selectedProject?.startupDocs.required.length ?? 0} · 可选 {selectedProject?.startupDocs.optional.length ?? 0}</small>
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {activeView === 'docs' ? (
          <section className="workspace-view docs-view">
            <div className="panel-title-row">
              <h2>启动文档</h2>
              <div className="compact-actions">
                <button title="选择已有文档" onClick={selectStartupDocs}>
                  <FolderOpen size={15} />
                  选择{newDocRequired ? '必读' : '可选'}
                </button>
              </div>
            </div>
            <div className="doc-create-row">
              <input
                aria-label="新启动文档路径"
                placeholder="docs/project-context.md"
                value={newDocPath}
                onChange={(event) => setNewDocPath(event.target.value)}
              />
              <select
                aria-label="启动文档类型"
                value={newDocRequired ? 'required' : 'optional'}
                onChange={(event) => setNewDocRequired(event.target.value === 'required')}
              >
                <option value="required">必读</option>
                <option value="optional">可选</option>
              </select>
              <button title="创建新的项目文档" onClick={createStartupDoc}>
                <FilePlus2 size={15} />
                创建
              </button>
            </div>
            <div className="doc-list">
              {selectedProject &&
              (selectedProject.startupDocs.required.length > 0 || selectedProject.startupDocs.optional.length > 0) ? (
                <>
                  {selectedProject.startupDocs.required.map((doc) => (
                    <StartupDocRow
                      docPath={doc}
                      key={`required-${doc}`}
                      label="必读"
                      onRemove={removeStartupDoc}
                      onView={viewStartupDoc}
                    />
                  ))}
                  {selectedProject.startupDocs.optional.map((doc) => (
                    <StartupDocRow
                      docPath={doc}
                      key={`optional-${doc}`}
                      label="可选"
                      onRemove={removeStartupDoc}
                      onView={viewStartupDoc}
                    />
                  ))}
                </>
              ) : (
                <p className="empty-text">暂无启动文档</p>
              )}
            </div>
            <div className="read-result-panel inline-panel">
              <h2>启动文档读取结果</h2>
              {docsResult.length === 0 ? (
                <p className="empty-text">暂无读取记录</p>
              ) : (
                docsResult.map((doc) => (
                  <div className="read-result-row" key={`${doc.required}-${doc.path}`}>
                    <span className={doc.exists ? 'result-ok' : 'result-error'}>
                      {doc.exists ? '已读取' : '缺失'}
                    </span>
                    <strong>{doc.path}</strong>
                    <small>{doc.required ? '必读' : '可选'}</small>
                  </div>
                ))
              )}
            </div>
            <div className="read-result-panel inline-panel">
              <div className="panel-title-row">
                <h2>会话交接</h2>
                <div className="compact-actions">
                  <button disabled={!sessionHandoff?.exists} onClick={viewSessionHandoff}>
                    <BookOpenCheck size={15} />
                    查看
                  </button>
                </div>
              </div>
              <p className="empty-text">
                {sessionHandoff?.exists ? '待下次启动读取' : '暂无交接'}
              </p>
            </div>
          </section>
        ) : null}

        {activeView === 'config' ? (
          <section className="workspace-view config-view">
            <div className="panel-title-row">
              <h2>运行配置</h2>
              <div className="compact-actions">
                <button onClick={() => void runHealthCheck()}>
                  <RefreshCw size={15} />
                  体检
                </button>
              </div>
            </div>
            <div className="health-list">
              {healthCheck ? (
                Object.values(healthCheck).map((item) => (
                  <div className="health-row" key={item.label}>
                    <span className={item.ok ? 'result-ok' : 'result-error'}>{item.ok ? '正常' : '缺失'}</span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                ))
              ) : (
                <p className="empty-text">暂无体检</p>
              )}
            </div>
            <label className="field">
              <span>模型</span>
              <select value={selectedModel} onChange={(event) => void updateSelectedModel(event.target.value)}>
                {config.models.map((model) => (
                  <option key={model}>{model}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Codex CLI</span>
              <input
                value={codexCliPath}
                onChange={(event) => void updateCodexCliPath(event.target.value)}
                placeholder="codex 或 /usr/local/bin/codex"
              />
            </label>
            <div className="model-manage-row">
              <input
                aria-label="新增模型名称"
                placeholder="输入模型名称"
                value={newModelName}
                onChange={(event) => setNewModelName(event.target.value)}
              />
              <button onClick={() => void addModelOption()}>添加</button>
              <button disabled={config.models.length <= 1} onClick={() => void removeSelectedModel()}>
                移除当前
              </button>
            </div>
            <label className="field">
              <span>思考强度</span>
              <select
                value={selectedReasoningEffort}
                onChange={(event) => void updateSelectedReasoningEffort(event.target.value)}
              >
                {config.reasoningEfforts.map((effort) => (
                  <option key={effort} value={effort}>
                    {formatReasoningEffort(effort)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>上下文长度</span>
              <select
                value={selectedContextLengthTokens}
                onChange={(event) => void updateSelectedContextLength(Number(event.target.value))}
              >
                {config.contextLengthOptions.map((contextLength) => (
                  <option key={contextLength} value={contextLength}>
                    {formatContextLength(contextLength)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>任务模式</span>
              <select value={selectedTaskMode} onChange={(event) => void updateSelectedTaskMode(event.target.value as TaskMode)}>
                <option value="quick">快速：只发必读摘要</option>
                <option value="standard">标准：发文档摘要</option>
                <option value="deep">深度：发文档全文</option>
              </select>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={commitAfterTask}
                onChange={(event) => void updateCommitAfterTask(event.target.checked)}
              />
              <GitCommitHorizontal size={16} />
              <span>每次任务完成后自动提交 Git</span>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={pushAfterCommit}
                disabled={!commitAfterTask}
                onChange={(event) => void updatePushAfterCommit(event.target.checked)}
              />
              <GitCommitHorizontal size={16} />
              <span>自动提交后 push</span>
            </label>
            <div className="config-section">
              <div className="panel-title-row">
                <h2>Git</h2>
                <div className="compact-actions">
                  <button disabled={!gitRemoteUrl.trim()} onClick={() => void copyRemoteCommand()}>
                    <GitCommitHorizontal size={15} />
                    复制 remote
                  </button>
                  <button onClick={() => void detectGitSettings()}>
                    <RefreshCw size={15} />
                    检测
                  </button>
                </div>
              </div>
              <label className="field">
                <span>仓库目录</span>
                <input
                  value={gitRepositoryPath}
                  onChange={(event) => void updateGitRepositoryPath(event.target.value)}
                  placeholder="Git repository root"
                />
              </label>
              <p className="config-path">{gitCurrentBranch ? `当前分支：${gitCurrentBranch}` : '当前分支：未检测'}</p>
              <label className="field">
                <span>GitHub / Origin</span>
                <input
                  value={gitRemoteUrl}
                  onChange={(event) => void updateGitRemoteUrl(event.target.value)}
                  placeholder="https://github.com/user/repo.git"
                />
              </label>
              <label className="field">
                <span>分支策略</span>
                <select
                  value={gitBranchMode}
                  onChange={(event) => void updateGitBranchMode(event.target.value as GitBranchMode)}
                >
                  <option value="current">沿用当前分支</option>
                  <option value="new">启动前创建任务分支</option>
                </select>
              </label>
              {gitBranchMode === 'new' ? (
                <label className="field">
                  <span>任务分支</span>
                  <input
                    value={gitBranchName}
                    onChange={(event) => void updateGitBranchName(event.target.value)}
                    placeholder="viewcodex/task"
                  />
                </label>
              ) : null}
            </div>
            <div className="config-shortcuts">
              <button onClick={() => setConfigDialog('gpt')}>
                <TerminalSquare size={15} />
                GPT 配置文件
              </button>
              <button onClick={() => setConfigDialog('prompt')}>
                <BookOpenCheck size={15} />
                Prompt 记忆
              </button>
              <button onClick={() => setConfigDialog('template')}>
                <FilePlus2 size={15} />
                任务模板
              </button>
            </div>
          </section>
        ) : null}

        {activeView === 'cli' ? (
          <section className={`cli-workspace ${cliInfoCollapsed ? 'info-collapsed' : ''}`}>
            <div className="cli-main">
              <div className="prompt-dock">
                <div className="prompt-toolbar">
                  <label>
                    <span>Skill</span>
                    <select value={selectedSkill} onChange={(event) => void updateSelectedSkill(event.target.value)}>
                      <option value="">不使用 skill</option>
                      {availableSkills.map((skill) => (
                        <option key={skill.path || skill.name} value={skill.name}>
                          {skill.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    title="重新扫描本机 skills"
                    aria-label="重新扫描本机 skills"
                    onClick={() => void refreshAvailableSkills()}
                  >
                    <RefreshCw size={14} />
                  </button>
                  <label>
                    <span>Prompt</span>
                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) {
                          insertPromptMemory(event.target.value);
                        }
                      }}
                    >
                      <option value="">插入常用 Prompt</option>
                      {config.promptMemories.map((memory) => (
                        <option key={memory.id} value={memory.id}>
                          {memory.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>模板</span>
                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) {
                          insertTaskTemplate(event.target.value);
                        }
                      }}
                    >
                      <option value="">选择任务模板</option>
                      {config.taskTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button title="选择任务附件" aria-label="选择任务附件" onClick={() => void selectTaskAttachments()}>
                    <Paperclip size={14} />
                  </button>
                  <button title="启动检查" aria-label="启动检查" onClick={() => void runStartupCheck()}>
                    <RefreshCw size={14} />
                  </button>
                  <button title="打开项目规范" aria-label="打开项目规范" onClick={() => void openDefaultStartupDoc()}>
                    <BookOpenCheck size={14} />
                  </button>
                  <button
                    title={cliInfoCollapsed ? '展开信息栏' : '收起信息栏'}
                    aria-label={cliInfoCollapsed ? '展开信息栏' : '收起信息栏'}
                    onClick={() => setCliInfoCollapsed((value) => !value)}
                  >
                    {cliInfoCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
                  </button>
                  <span className="token-estimate" title="粗略按 4 字符约 1 token 估算">
                    {formatTaskMode(selectedTaskMode)} · 约 {formatTokenCount(promptTokenEstimate)} /{' '}
                    {formatContextLength(selectedContextLengthTokens)}
                  </span>
                </div>
                <textarea
                  placeholder="输入需求"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </div>
              <section className="terminal-panel">
                <div className="terminal-header">
                  <h2>CLI</h2>
                  <span>{activeSoloSession?.command ?? '未启动'}</span>
                  {activeSoloSession ? <ContextUsageMeter session={activeSoloSession} /> : null}
                  <div className="terminal-actions">
                    <button onClick={() => void refreshWorkspaceStatus()}>
                      <RefreshCw size={14} />
                      刷新
                    </button>
                    <button onClick={clearActiveTerminal}>
                      <Eraser size={14} />
                      清屏
                    </button>
                    <button onClick={() => void stopCodex()}>
                      <Square size={13} />
                      停止
                    </button>
                    <button onClick={() => void restartCodex()}>
                      <RotateCw size={14} />
                      重启
                    </button>
                  </div>
                </div>
                {sessions.filter((session) => session.role === 'solo').length === 0 ? (
                  <div className="terminal-empty">未启动</div>
                ) : (
                  sessions.filter((session) => session.role === 'solo').map((session) => (
                    <TerminalViewport
                      active={session.id === activeSessionId}
                      fitAddon={session.fitAddon}
                      key={session.id}
                      sessionId={session.id}
                      terminal={session.terminal}
                      sidebarCollapsed={sidebarCollapsed || cliInfoCollapsed}
                    />
                  ))
                )}
              </section>
            </div>
            <aside className="cli-info-panel" aria-hidden={cliInfoCollapsed}>
              <div className="cli-info-header">
                <strong>上下文</strong>
                <button title="收起信息栏" aria-label="收起信息栏" onClick={() => setCliInfoCollapsed(true)}>
                  <PanelRightClose size={14} />
                </button>
              </div>
              <section className="cli-info-section">
                <div className="panel-title-row session-history-title">
                  <h2>任务附件</h2>
                  <div className="compact-actions">
                    <button disabled={taskAttachmentsForProject.length === 0} onClick={() => void clearCurrentProjectTaskAttachments()}>
                      <Eraser size={14} />
                      清空
                    </button>
                  </div>
                </div>
                {taskAttachmentsForProject.length > 0 ? (
                  <div className="attachment-list">
                    {taskAttachmentsForProject.map((attachment) => (
                      <TaskAttachmentRow
                        attachment={attachment}
                        key={attachment.id}
                        onRemove={removeTaskAttachment}
                        onUpdateNote={updateTaskAttachmentNote}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="empty-text">暂无附件</p>
                )}
              </section>
              <section className="cli-info-section">
                <h2>当前会话</h2>
                {visibleSoloSessions.length > 0 ? (
                  <div className="session-list">
                    {visibleSoloSessions.map((session) => (
                      <button
                        className={`session-row ${session.id === activeSessionId ? 'active' : ''}`}
                        key={session.id}
                        onClick={() => setActiveSessionId(session.id)}
                      >
                        <span className={`status-dot ${session.status === 'running' ? 'running' : 'exited'}`} />
                        <span>
                          <strong>{session.skill || session.model}</strong>
                          <small>
                            {session.status === 'running' ? '运行中' : `已退出 ${session.exitCode ?? ''}`} ·{' '}
                            {session.startedAt}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="empty-text">暂无会话</p>
                )}
              </section>
              <section className="cli-info-section">
                <div className="panel-title-row session-history-title">
                  <h2>最近会话</h2>
                  <div className="compact-actions">
                    <button disabled={allSessionHistoryForProject.length === 0} onClick={() => void clearCurrentProjectSessionHistory()}>
                      <Eraser size={14} />
                      清空
                    </button>
                  </div>
                </div>
                {allSessionHistoryForProject.length > 0 ? (
                  <div className="history-tools">
                    <label>
                      <Search size={13} />
                      <input
                        aria-label="搜索历史会话"
                        placeholder="搜索历史"
                        value={historySearch}
                        onChange={(event) => setHistorySearch(event.target.value)}
                      />
                    </label>
                    <select
                      aria-label="筛选历史会话"
                      value={historyFilter}
                      onChange={(event) => setHistoryFilter(event.target.value as typeof historyFilter)}
                    >
                      <option value="all">全部</option>
                      <option value="favorite">收藏</option>
                      <option value="success">成功</option>
                      <option value="failed">失败</option>
                    </select>
                  </div>
                ) : null}
                {filteredSessionHistoryForProject.length > 0 ? (
                  <div className="session-list history-list">
                    {filteredSessionHistoryForProject.map((entry) => (
                      <div className="session-row history-row" key={entry.id}>
                        <span className="status-dot exited" />
                        <span>
                          <strong>{entry.skill || entry.model || formatRoleName(entry.role as CodexRole)}</strong>
                          <small>
                            {formatRoleName(entry.role as CodexRole)} · 退出码 {entry.exitCode ?? 'unknown'} ·{' '}
                            {formatDateTime(entry.endedAt)}
                          </small>
                        </span>
                        <div className="history-actions">
                          <button
                            title={entry.favorite ? '取消收藏' : '收藏'}
                            aria-label={entry.favorite ? '取消收藏' : '收藏'}
                            className={entry.favorite ? 'favorite active' : 'favorite'}
                            onClick={() => void toggleHistoryFavorite(entry.id)}
                          >
                            <Star size={12} />
                          </button>
                          <button onClick={() => viewSessionHistory(entry)}>查看</button>
                          <button onClick={() => restoreSessionPrompt(entry)}>恢复</button>
                          <button onClick={() => void continueSessionHistory(entry)}>继续</button>
                          <button onClick={() => saveHistoryAsTemplate(entry)}>存模板</button>
                          <button
                            title="删除历史"
                            aria-label="删除历史"
                            className="danger"
                            onClick={() => void removeHistoryEntry(entry.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : allSessionHistoryForProject.length > 0 ? (
                  <p className="empty-text">没有匹配的历史</p>
                ) : (
                  <p className="empty-text">暂无历史</p>
                )}
              </section>
            </aside>
          </section>
        ) : null}

        {activeView === 'team' ? (
          <section className="team-workspace">
            <div className="team-layout">
              <aside className="team-sidebar">
                <div className="team-actions">
                  <button onClick={() => void startTeam()}>
                    <Users size={15} />
                    启动 Team
                  </button>
                  <button onClick={() => void sendPromptToPlanner()}>
                    <Send size={15} />
                    发给 Planner
                  </button>
                  <button onClick={() => void sendPlannerToExecutionGroup()}>
                    <Play size={15} />
                    发送方案
                  </button>
                </div>
                <div className="team-role-list">
                  {(['planner', 'executor', 'reviewer'] as const).map((role) => {
                    const roleSession =
                      sessions.find((entry) => entry.projectPath === selectedProject?.path && entry.role === role) ??
                      null;
                    return (
                      <button
                        className={selectedTeamRole === role ? 'selected' : ''}
                        key={role}
                        onClick={() => selectTeamRole(role)}
                      >
                        <strong>{formatRoleName(role)}</strong>
                        <span>{roleSession?.status === 'running' ? '运行中' : '未启动'}</span>
                      </button>
                    );
                  })}
                </div>
                <label className="team-prompt-editor">
                  <span>{formatRoleName(selectedTeamRole)} 提示词</span>
                  <textarea
                    value={teamRolePromptDrafts[selectedTeamRole]}
                    onChange={(event) =>
                      setTeamRolePromptDrafts((current) => ({
                        ...current,
                        [selectedTeamRole]: event.target.value,
                      }))
                    }
                  />
                </label>
                <button className="team-save-prompt" onClick={() => void saveSelectedTeamRolePrompt()}>
                  <Save size={15} />
                  保存提示词
                </button>
                <p>{teamStatus}</p>
              </aside>
              <TeamRolePanel
                role={selectedTeamRole}
                session={
                  sessions.find(
                    (entry) => entry.projectPath === selectedProject?.path && entry.role === selectedTeamRole,
                  ) ?? null
                }
                sidebarCollapsed={sidebarCollapsed}
              />
            </div>
          </section>
        ) : null}
      </section>
      {startupConfirmation ? (
        <div className="doc-editor-overlay" role="dialog" aria-modal="true" aria-label="启动确认">
          <section className="doc-editor startup-confirm-dialog">
            <header className="doc-editor-header">
              <div>
                <h2>启动确认</h2>
                <span>{startupConfirmation.projectName}</span>
              </div>
              <div className="doc-editor-actions">
                <button onClick={() => setStartupConfirmation(null)}>
                  <X size={15} />
                  取消
                </button>
                <button onClick={() => void confirmStartupRun()}>
                  <Play size={15} />
                  启动
                </button>
              </div>
            </header>
            <div className="startup-confirm-body">
              <div className="health-row">
                <span className="result-ok">文档</span>
                <strong>{startupConfirmation.previewContext.docs.filter((doc) => doc.exists).length} 份</strong>
                <small>
                  必读 {startupConfirmation.previewContext.docs.filter((doc) => doc.required && doc.exists).length} ·
                  可选 {startupConfirmation.previewContext.docs.filter((doc) => !doc.required && doc.exists).length}
                </small>
              </div>
              <div className="health-row">
                <span className={startupConfirmation.previewContext.handoff?.exists ? 'result-ok' : 'result-error'}>
                  交接
                </span>
                <strong>{startupConfirmation.previewContext.handoff?.exists ? '将读取' : '无'}</strong>
                <small>确认启动后才会读取并删除交接记录</small>
              </div>
              <div className="health-row">
                <span className="result-ok">模型</span>
                <strong>{selectedModel}</strong>
                <small>
                  {formatTaskMode(selectedTaskMode)} · {formatContextLength(selectedContextLengthTokens)}
                </small>
              </div>
              <div className="health-row">
                <span className={selectedSkill ? 'result-ok' : 'result-error'}>Skill</span>
                <strong>{selectedSkill || '不使用'}</strong>
                <small>预计 {formatTokenCount(estimateTokens(composePromptWithStartupContext(prompt, startupConfirmation.previewContext.context)))} tokens</small>
              </div>
              <div className="health-row">
                <span className={commitAfterTask ? 'result-ok' : 'result-error'}>Git</span>
                <strong>{commitAfterTask ? '自动提交' : '不提交'}</strong>
                <small>{pushAfterCommit ? '提交后 push' : gitBranchMode === 'new' ? `任务分支：${gitBranchName}` : '沿用当前分支'}</small>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {selectedDocPath ? (
        <div className="doc-editor-overlay" role="dialog" aria-modal="true" aria-label="编辑启动文档">
          <section className="doc-editor">
            <header className="doc-editor-header">
              <div>
                <h2>{selectedDocPath}</h2>
                <span>{docIsDirty ? '未保存' : '已保存'} · {selectedDocProject?.name ?? '当前项目'}</span>
              </div>
              <div className="doc-editor-actions">
                <button onClick={() => void saveStartupDoc()}>
                  <Save size={15} />
                  保存
                </button>
                <button onClick={closeStartupDocEditor}>
                  <X size={15} />
                  关闭
                </button>
              </div>
            </header>
            <textarea
              autoFocus
              value={selectedDocContent}
              onChange={(event) => setSelectedDocContent(event.target.value)}
            />
          </section>
        </div>
      ) : null}
      {readOnlyDoc ? (
        <div className="doc-editor-overlay" role="dialog" aria-modal="true" aria-label="查看交接文档">
          <section className="doc-editor">
            <header className="doc-editor-header">
              <div>
                <h2>{readOnlyDoc.title}</h2>
                <span>{readOnlyDoc.subtitle}</span>
              </div>
              <div className="doc-editor-actions">
                <button onClick={() => setReadOnlyDoc(null)}>
                  <X size={15} />
                  关闭
                </button>
              </div>
            </header>
            <textarea readOnly value={readOnlyDoc.content} />
          </section>
        </div>
      ) : null}
      {configDialog ? (
        <div className="doc-editor-overlay" role="dialog" aria-modal="true" aria-label="配置编辑">
          <section className="doc-editor config-dialog">
            <header className="doc-editor-header">
              <div>
                <h2>
                  {configDialog === 'gpt'
                    ? 'GPT 配置文件'
                    : configDialog === 'prompt'
                      ? 'Prompt 记忆'
                      : '任务模板'}
                </h2>
                <span>
                  {configDialog === 'gpt'
                    ? (gptConfigFile?.path ?? '~/.codex/config.toml')
                    : configDialog === 'prompt'
                      ? `${config.promptMemories.length} 条常用 Prompt`
                      : `${config.taskTemplates.length} 个任务模板`}
                </span>
              </div>
              <div className="doc-editor-actions">
                {configDialog === 'gpt' ? (
                  <>
                    <button onClick={() => void reloadGptConfig()}>
                      <RefreshCw size={15} />
                      读取
                    </button>
                    <button onClick={() => void saveGptConfig()}>
                      <Save size={15} />
                      保存
                    </button>
                  </>
                ) : configDialog === 'prompt' ? (
                  <>
                    <button onClick={clearPromptMemoryEditor}>新建</button>
                    <button onClick={() => void savePromptMemory()}>
                      <Save size={15} />
                      保存
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={clearTaskTemplateEditor}>新建</button>
                    <button onClick={() => void saveTaskTemplate()}>
                      <Save size={15} />
                      保存
                    </button>
                  </>
                )}
                <button onClick={() => setConfigDialog(null)}>
                  <X size={15} />
                  关闭
                </button>
              </div>
            </header>
            {configDialog === 'gpt' ? (
              <textarea
                className="gpt-config-editor"
                spellCheck={false}
                value={gptConfigDraft}
                onChange={(event) => setGptConfigDraft(event.target.value)}
                placeholder='例如：model = "gpt-5.4"'
              />
            ) : configDialog === 'prompt' ? (
              <div className="prompt-memory-dialog">
                <div className="prompt-memory-editor">
                  <input
                    aria-label="Prompt 记忆名称"
                    placeholder="名称，例如：代码审查"
                    value={promptMemoryTitle}
                    onChange={(event) => setPromptMemoryTitle(event.target.value)}
                  />
                  <textarea
                    aria-label="Prompt 记忆内容"
                    placeholder="写下常用 Prompt"
                    value={promptMemoryContent}
                    onChange={(event) => setPromptMemoryContent(event.target.value)}
                  />
                </div>
                <div className="prompt-memory-list">
                  {config.promptMemories.length === 0 ? (
                    <p className="empty-text">暂无 Prompt</p>
                  ) : (
                    config.promptMemories.map((memory) => (
                      <div className="prompt-memory-row" key={memory.id}>
                        <button onClick={() => editPromptMemory(memory.id)}>
                          <strong>{memory.title}</strong>
                          <small>{memory.content}</small>
                        </button>
                        <button onClick={() => insertPromptMemory(memory.id)}>插入</button>
                        <button onClick={() => void removePromptMemory(memory.id)}>删除</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="prompt-memory-dialog">
                <div className="prompt-memory-editor template-editor">
                  <div className="template-editor-row">
                    <input
                      aria-label="模板名称"
                      placeholder="名称，例如：修复线上问题"
                      value={templateTitle}
                      onChange={(event) => setTemplateTitle(event.target.value)}
                    />
                    <input
                      aria-label="模板分类"
                      placeholder="分类，例如：开发"
                      value={templateCategory}
                      onChange={(event) => setTemplateCategory(event.target.value)}
                    />
                  </div>
                  <textarea
                    aria-label="模板内容"
                    placeholder="写下任务模板内容"
                    value={templatePrompt}
                    onChange={(event) => setTemplatePrompt(event.target.value)}
                  />
                </div>
                <div className="prompt-memory-list">
                  {config.taskTemplates.length === 0 ? (
                    <p className="empty-text">暂无模板</p>
                  ) : (
                    config.taskTemplates.map((template) => (
                      <div className="prompt-memory-row template-row" key={template.id}>
                        <button onClick={() => editTaskTemplate(template.id)}>
                          <span className="template-row-title">
                            <strong>{template.title}</strong>
                            <em>{template.category}</em>
                          </span>
                          <small>{template.prompt}</small>
                        </button>
                        <button onClick={() => insertTaskTemplate(template.id)}>插入</button>
                        <button onClick={() => void removeTaskTemplate(template.id)}>删除</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function TerminalViewport({
  terminal,
  fitAddon,
  active,
  sessionId,
  sidebarCollapsed,
}: {
  terminal: Terminal;
  fitAddon: FitAddon;
  active: boolean;
  sessionId: string;
  sidebarCollapsed: boolean;
}) {
  const containerRef = useTerminalMount(terminal, fitAddon, active, sessionId, sidebarCollapsed);
  return <div className={`terminal-viewport ${active ? 'active' : 'hidden'}`} ref={containerRef} />;
}

function TeamRolePanel({
  role,
  session,
  sidebarCollapsed,
}: {
  role: Exclude<CodexRole, 'solo'>;
  session: CodexSessionView | null;
  sidebarCollapsed: boolean;
}) {
  return (
    <section className="team-role-panel">
      <header>
        <strong>{formatRoleName(role)}</strong>
        {session ? <ContextUsageMeter session={session} /> : null}
        <span>{session?.status === 'running' ? '运行中' : '未启动'}</span>
      </header>
      {session ? (
        <TerminalViewport
          active
          fitAddon={session.fitAddon}
          sessionId={session.id}
          terminal={session.terminal}
          sidebarCollapsed={sidebarCollapsed}
        />
      ) : (
        <div className="team-role-empty">未启动</div>
      )}
    </section>
  );
}

function ProjectRow({
  project,
  selected,
  active,
  durationLabel,
  onSelect,
}: {
  project: ViewcodexProject;
  selected: boolean;
  active: boolean;
  durationLabel: string | null;
  onSelect: () => void;
}) {
  return (
    <button className={`project-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <span className="project-row-title">
        <span>{project.name}</span>
        <span
          aria-label={active ? '活跃' : '不活跃'}
          className={`project-status-box ${active ? 'active' : 'inactive'}`}
          title={active ? '有运行中的 Codex' : '没有运行中的 Codex'}
        />
        {active && durationLabel ? <span className="project-runtime">{durationLabel}</span> : null}
      </span>
      <small>{project.path}</small>
    </button>
  );
}

function DashboardMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="dashboard-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function TaskAttachmentRow({
  attachment,
  onRemove,
  onUpdateNote,
}: {
  attachment: TaskAttachment;
  onRemove: (id: string) => Promise<void>;
  onUpdateNote: (id: string, note: string) => Promise<void>;
}) {
  return (
    <div className="attachment-row">
      <Paperclip size={15} />
      <div>
        <strong>{attachment.originalName}</strong>
        <small>
          {attachment.kind === 'image' ? '图片' : '文档'} · {attachment.path}
        </small>
      </div>
      <input
        aria-label={`${attachment.originalName} 备注`}
        placeholder="备注"
        value={attachment.note}
        onChange={(event) => void onUpdateNote(attachment.id, event.target.value)}
      />
      <button onClick={() => void onRemove(attachment.id)}>移除</button>
    </div>
  );
}

function ContextUsageMeter({ session }: { session: CodexSessionView }) {
  const percent = Math.min(100, Math.round((session.promptTokenEstimate / session.contextLengthTokens) * 100));

  return (
    <div
      className="context-meter"
      title={`估算：${formatTokenCount(session.promptTokenEstimate)} / ${formatContextLength(session.contextLengthTokens)}`}
    >
      <span>{percent}%</span>
      <div aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function StartupDocRow({
  docPath,
  label,
  onRemove,
  onView,
}: {
  docPath: string;
  label: '必读' | '可选';
  onRemove: (docPath: string) => Promise<void>;
  onView: (docPath: string) => Promise<void>;
}) {
  return (
    <div className="doc-row">
      <BookOpenCheck size={16} />
      <button className="doc-name-button" onClick={() => void onView(docPath)}>
        {docPath}
      </button>
      <em>{label}</em>
      <button className="doc-remove-button" onClick={() => void onRemove(docPath)}>
        移除
      </button>
    </div>
  );
}

function getProjectPreferences(config: ViewcodexConfig, projectPath: string | null) {
  const project = config.projects.find((entry) => entry.path === projectPath) ?? config.projects[0] ?? null;
  const fallbackModel = config.defaultModel ?? config.models[0] ?? fallbackConfig.models[0];
  const rememberedModel = project?.runConfig.model;
  const rememberedReasoningEffort = project?.runConfig.reasoningEffort;
  const rememberedContextLength = project?.runConfig.contextLengthTokens;

  return {
    model: rememberedModel && config.models.includes(rememberedModel) ? rememberedModel : fallbackModel,
    reasoningEffort:
      rememberedReasoningEffort && config.reasoningEfforts.includes(rememberedReasoningEffort)
        ? rememberedReasoningEffort
        : config.defaultReasoningEffort,
    contextLengthTokens:
      rememberedContextLength && config.contextLengthOptions.includes(rememberedContextLength)
        ? rememberedContextLength
        : config.defaultContextLengthTokens,
    skill: project?.runConfig.skill ?? '',
    commitAfterTask: project?.runConfig.commitAfterTask ?? config.commitAfterTask,
    pushAfterCommit: project?.runConfig.pushAfterCommit ?? false,
    taskMode: project?.runConfig.taskMode ?? 'standard',
    gitRepositoryPath: project?.runConfig.gitRepositoryPath ?? null,
    gitRemoteUrl: project?.runConfig.gitRemoteUrl ?? '',
    gitBranchMode: project?.runConfig.gitBranchMode ?? 'current',
    gitBranchName: project?.runConfig.gitBranchName ?? 'viewcodex-task',
    promptDraft: project?.promptDraft ?? '',
  };
}

function formatReasoningEffort(effort: string): string {
  const labels: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高',
  };

  return labels[effort] ?? effort;
}

function formatRoleName(role: CodexRole): string {
  const labels: Record<CodexRole, string> = {
    solo: 'Solo',
    planner: 'Planner',
    executor: 'Executor',
    reviewer: 'Reviewer',
  };

  return labels[role];
}

function formatTaskMode(taskMode: TaskMode): string {
  const labels: Record<TaskMode, string> = {
    quick: '快速',
    standard: '标准',
    deep: '深度',
  };

  return labels[taskMode];
}

function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${tokens / 1_000_000}M tokens`;
  }

  return `${Math.round(tokens / 1000)}K tokens`;
}

function formatTokenCount(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}K` : `${tokens}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function composePromptWithStartupContext(prompt: string, startupContext: string, promptLabel = '用户需求'): string {
  const trimmedPrompt = prompt.trim();
  const trimmedContext = startupContext.trim();

  if (!trimmedContext) {
    return trimmedPrompt;
  }

  return `${trimmedContext}\n\n---\n\n${promptLabel}：\n${trimmedPrompt || '请先阅读上述项目文档，等待我的下一步需求。'}`;
}

function buildTaskAttachmentContext(attachments: TaskAttachment[]): string {
  if (attachments.length === 0) {
    return '';
  }

  return [
    '## 本次任务附件',
    '以下文件已复制到当前项目目录，Codex 可以按路径读取；图片附件请结合用户备注判断使用方式。',
    ...attachments.map((attachment) =>
      [
        `- 路径：${attachment.path}`,
        `  类型：${attachment.kind === 'image' ? '图片' : '文档'}`,
        `  原始文件名：${attachment.originalName}`,
        `  用户备注：${attachment.note.trim() || '无'}`,
      ].join('\n'),
    ),
  ].join('\n');
}

function buildSessionHistoryDetail(entry: SessionHistoryEntry): string {
  return [
    `# 历史会话 ${entry.id}`,
    '',
    `- 项目：${entry.projectPath}`,
    `- 角色：${formatRoleName(entry.role as CodexRole)}`,
    `- 模型：${entry.model || '未知'}`,
    `- Skill：${entry.skill || '不使用'}`,
    `- 开始：${formatDateTime(entry.startedAt)}`,
    `- 结束：${formatDateTime(entry.endedAt)}`,
    `- 退出码：${entry.exitCode ?? 'unknown'}`,
    '',
    entry.promptPreview.trim() ? `## 输入\n\n${entry.promptPreview.trim()}` : '',
    entry.transcriptTail.trim() ? `## 终端尾部记录\n\n\`\`\`text\n${entry.transcriptTail.trim()}\n\`\`\`` : '',
  ].filter(Boolean).join('\n');
}

function buildSessionHistoryContext(entry: SessionHistoryEntry): string {
  return [
    '## 要继续的历史会话',
    `- 会话 ID：${entry.id}`,
    `- 角色：${formatRoleName(entry.role as CodexRole)}`,
    `- 模型：${entry.model || '未知'}`,
    `- Skill：${entry.skill || '不使用'}`,
    `- 开始：${entry.startedAt}`,
    `- 结束：${entry.endedAt}`,
    `- 退出码：${entry.exitCode ?? 'unknown'}`,
    '',
    entry.promptPreview.trim() ? `### 历史输入\n\n${entry.promptPreview.trim()}` : '',
    entry.transcriptTail.trim() ? `### 历史终端尾部记录\n\n\`\`\`text\n${entry.transcriptTail.trim()}\n\`\`\`` : '',
  ].filter(Boolean).join('\n');
}

function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

function getTeamRolePrompt(role: Exclude<CodexRole, 'solo'>, prompts: TeamRolePrompts): string {
  return prompts[role] || fallbackConfig.teamRolePrompts[role];
}

function cleanTerminalOutput(output: string): string {
  return output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim();
}

function compactOutputForForward(output: string, maxLines: number): string {
  const cleanOutput = cleanTerminalOutput(output);
  const lines = cleanOutput
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const compactLines = lines.slice(-maxLines);

  return compactLines.join('\n');
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  if (totalMinutes < 1) {
    return '<1m';
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function toErrorMessage(caughtError: unknown): string {
  return caughtError instanceof Error ? caughtError.message : '发生未知错误';
}

function useTerminalMount(
  terminal: Terminal | null,
  fitAddon: FitAddon,
  active: boolean,
  sessionId: string,
  sidebarCollapsed: boolean,
) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!terminal || !element) {
      return;
    }

    if (element.childElementCount === 0) {
      terminal.open(element);
    }

    let frame: number | null = null;
    let lastCols = 0;
    let lastRows = 0;

    const fitTerminal = () => {
      if (!active) {
        return;
      }

      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          if (terminal.cols !== lastCols || terminal.rows !== lastRows) {
            lastCols = terminal.cols;
            lastRows = terminal.rows;
            void window.viewcodex?.resizeTerminal(sessionId, terminal.cols, terminal.rows);
          }
        } catch {
          // xterm can throw while the element is hidden or not measurable.
        }
      });
    };

    const observer = new ResizeObserver(fitTerminal);
    observer.observe(element);
    fitTerminal();

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  }, [active, element, fitAddon, sessionId, sidebarCollapsed, terminal]);

  return setElement;
}

function createTerminal() {
  const terminal = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    rows: 18,
    theme: {
      background: '#171814',
      foreground: '#f5f1e8',
      cursor: '#f5f1e8',
    },
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  return { terminal, fitAddon };
}
