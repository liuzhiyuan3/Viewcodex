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

export type DetectedGitConfig = {
  repositoryPath: string | null;
  remoteUrl: string;
  currentBranch: string | null;
};

export type HealthCheckItem = {
  ok: boolean;
  label: string;
  detail: string;
};

export type HealthCheckResult = {
  codex: HealthCheckItem;
  git: HealthCheckItem;
  gptConfig: HealthCheckItem;
  skills: HealthCheckItem;
  path: HealthCheckItem;
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

export type GptConfigFile = {
  path: string;
  content: string;
  exists: boolean;
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

export type StartupDocContextResult = {
  taskMode: TaskMode;
  context: string;
  tokenEstimate: number;
  docs: StartupDocReadResult[];
  handoff: SessionHandoffDoc | null;
};

export type SessionHandoffDoc = {
  path: string;
  exists: boolean;
  content: string | null;
  createdAt: string | null;
};

export type StartupCheckResult = {
  projectExists: boolean;
  codexAvailable: boolean;
  docs: StartupDocReadResult[];
  ok: boolean;
  errors: string[];
};

export type TerminalStartOptions = {
  projectPath: string;
  model: string;
  reasoningEffort: string;
  skill: string;
  prompt: string;
  commitAfterTask: boolean;
  pushAfterCommit: boolean;
  gitRepositoryPath: string | null;
  gitRemoteUrl: string;
  gitBranchMode: GitBranchMode;
  gitBranchName: string;
  role?: CodexRole;
};

export type CodexRole = 'solo' | 'planner' | 'executor' | 'reviewer';

export type TerminalSession = {
  id: string;
  command: string;
};

export type TerminalRuntimeSession = TerminalSession & {
  projectPath: string;
  startedAt: string;
  role: CodexRole;
  commitAfterTask: boolean;
  pushAfterCommit: boolean;
};

export type ViewcodexApi = {
  version: string;
  loadConfig: () => Promise<ViewcodexConfig>;
  listSkills: () => Promise<SkillOption[]>;
  selectProject: () => Promise<ViewcodexConfig>;
  setSelectedProject: (projectPath: string) => Promise<ViewcodexConfig>;
  setCommitAfterTask: (commitAfterTask: boolean) => Promise<ViewcodexConfig>;
  setCodexCliPath: (codexCliPath: string) => Promise<ViewcodexConfig>;
  addModel: (model: string) => Promise<ViewcodexConfig>;
  removeModel: (model: string) => Promise<ViewcodexConfig>;
  addPromptMemory: (title: string, content: string) => Promise<ViewcodexConfig>;
  updatePromptMemory: (id: string, title: string, content: string) => Promise<ViewcodexConfig>;
  removePromptMemory: (id: string) => Promise<ViewcodexConfig>;
  selectTaskAttachments: (projectPath: string) => Promise<ViewcodexConfig>;
  updateTaskAttachmentNote: (id: string, note: string) => Promise<ViewcodexConfig>;
  removeTaskAttachment: (id: string) => Promise<ViewcodexConfig>;
  clearTaskAttachments: (projectPath?: string) => Promise<ViewcodexConfig>;
  readGptConfig: () => Promise<GptConfigFile>;
  writeGptConfig: (content: string) => Promise<GptConfigFile>;
  setProjectPromptDraft: (projectPath: string, promptDraft: string) => Promise<ViewcodexConfig>;
  setProjectRunConfig: (
    projectPath: string,
    runConfig: Partial<ProjectRunConfig>,
  ) => Promise<ViewcodexConfig>;
  detectGitConfig: (projectPath: string) => Promise<DetectedGitConfig>;
  checkHealth: () => Promise<HealthCheckResult>;
  setTeamRolePrompt: (role: keyof TeamRolePrompts, prompt: string) => Promise<ViewcodexConfig>;
  selectStartupDocs: (projectPath: string, required: boolean) => Promise<ViewcodexConfig>;
  createStartupDoc: (projectPath: string, inputName: string, required: boolean) => Promise<ViewcodexConfig>;
  createStartupDocWithDialog: (
    projectPath: string,
    inputName: string,
    required: boolean,
  ) => Promise<ViewcodexConfig>;
  removeStartupDoc: (projectPath: string, docPath: string) => Promise<ViewcodexConfig>;
  readStartupDoc: (projectPath: string, docPath: string) => Promise<StartupDocReadResult>;
  writeStartupDoc: (projectPath: string, docPath: string, content: string) => Promise<void>;
  readStartupDocs: (projectPath: string) => Promise<StartupDocReadResult[]>;
  getStartupDocContext: (
    projectPath: string,
    taskMode: TaskMode,
    consumeHandoff?: boolean,
  ) => Promise<StartupDocContextResult>;
  readSessionHandoff: (projectPath: string) => Promise<SessionHandoffDoc>;
  checkStartup: (projectPath: string) => Promise<StartupCheckResult>;
  listTerminals: () => Promise<TerminalRuntimeSession[]>;
  clearSessionHistory: (projectPath?: string) => Promise<ViewcodexConfig>;
  startTerminal: (options: TerminalStartOptions) => Promise<TerminalSession>;
  writeTerminal: (sessionId: string, data: string) => Promise<void>;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<void>;
  killTerminal: (sessionId: string) => Promise<void>;
  onTerminalData: (handler: (sessionId: string, data: string) => void) => () => void;
  onTerminalExit: (handler: (sessionId: string, exitCode: number | null) => void) => () => void;
};
