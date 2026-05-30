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

export type StartupDocContextResult = {
  taskMode: TaskMode;
  context: string;
  tokenEstimate: number;
  docs: StartupDocReadResult[];
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
};

export type ViewcodexApi = {
  version: string;
  loadConfig: () => Promise<ViewcodexConfig>;
  listSkills: () => Promise<SkillOption[]>;
  selectProject: () => Promise<ViewcodexConfig>;
  setSelectedProject: (projectPath: string) => Promise<ViewcodexConfig>;
  setCommitAfterTask: (commitAfterTask: boolean) => Promise<ViewcodexConfig>;
  addModel: (model: string) => Promise<ViewcodexConfig>;
  removeModel: (model: string) => Promise<ViewcodexConfig>;
  addPromptMemory: (title: string, content: string) => Promise<ViewcodexConfig>;
  updatePromptMemory: (id: string, title: string, content: string) => Promise<ViewcodexConfig>;
  removePromptMemory: (id: string) => Promise<ViewcodexConfig>;
  readGptConfig: () => Promise<GptConfigFile>;
  writeGptConfig: (content: string) => Promise<GptConfigFile>;
  setProjectPromptDraft: (projectPath: string, promptDraft: string) => Promise<ViewcodexConfig>;
  setProjectRunConfig: (
    projectPath: string,
    runConfig: Partial<ProjectRunConfig>,
  ) => Promise<ViewcodexConfig>;
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
  getStartupDocContext: (projectPath: string, taskMode: TaskMode) => Promise<StartupDocContextResult>;
  checkStartup: (projectPath: string) => Promise<StartupCheckResult>;
  listTerminals: () => Promise<TerminalRuntimeSession[]>;
  startTerminal: (options: TerminalStartOptions) => Promise<TerminalSession>;
  writeTerminal: (sessionId: string, data: string) => Promise<void>;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<void>;
  killTerminal: (sessionId: string) => Promise<void>;
  onTerminalData: (handler: (sessionId: string, data: string) => void) => () => void;
  onTerminalExit: (handler: (sessionId: string, exitCode: number | null) => void) => () => void;
};
