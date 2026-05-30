const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewcodex', {
  version: '0.1.0',
  loadConfig: () => ipcRenderer.invoke('config:load'),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  selectProject: () => ipcRenderer.invoke('project:select'),
  setSelectedProject: (projectPath) => ipcRenderer.invoke('project:set-selected', projectPath),
  setCommitAfterTask: (commitAfterTask) =>
    ipcRenderer.invoke('config:set-commit-after-task', commitAfterTask),
  addModel: (model) => ipcRenderer.invoke('config:add-model', model),
  removeModel: (model) => ipcRenderer.invoke('config:remove-model', model),
  addPromptMemory: (title, content) => ipcRenderer.invoke('config:add-prompt-memory', title, content),
  updatePromptMemory: (id, title, content) =>
    ipcRenderer.invoke('config:update-prompt-memory', id, title, content),
  removePromptMemory: (id) => ipcRenderer.invoke('config:remove-prompt-memory', id),
  readGptConfig: () => ipcRenderer.invoke('gpt-config:read'),
  writeGptConfig: (content) => ipcRenderer.invoke('gpt-config:write', content),
  setProjectPromptDraft: (projectPath, promptDraft) =>
    ipcRenderer.invoke('project:set-prompt-draft', projectPath, promptDraft),
  setProjectRunConfig: (projectPath, runConfig) =>
    ipcRenderer.invoke('project:set-run-config', projectPath, runConfig),
  detectGitConfig: (projectPath) => ipcRenderer.invoke('git:detect', projectPath),
  checkHealth: () => ipcRenderer.invoke('health:check'),
  setTeamRolePrompt: (role, prompt) => ipcRenderer.invoke('config:set-team-role-prompt', role, prompt),
  selectStartupDocs: (projectPath, required) => ipcRenderer.invoke('docs:select', projectPath, required),
  createStartupDoc: (projectPath, inputName, required) =>
    ipcRenderer.invoke('docs:create', projectPath, inputName, required),
  createStartupDocWithDialog: (projectPath, inputName, required) =>
    ipcRenderer.invoke('docs:create-with-dialog', projectPath, inputName, required),
  removeStartupDoc: (projectPath, docPath) => ipcRenderer.invoke('docs:remove', projectPath, docPath),
  readStartupDoc: (projectPath, docPath) => ipcRenderer.invoke('docs:read-one', projectPath, docPath),
  writeStartupDoc: (projectPath, docPath, content) =>
    ipcRenderer.invoke('docs:write-one', projectPath, docPath, content),
  readStartupDocs: (projectPath) => ipcRenderer.invoke('docs:read', projectPath),
  getStartupDocContext: (projectPath, taskMode, consumeHandoff) =>
    ipcRenderer.invoke('docs:context', projectPath, taskMode, consumeHandoff),
  readSessionHandoff: (projectPath) => ipcRenderer.invoke('handoff:read', projectPath),
  checkStartup: (projectPath) => ipcRenderer.invoke('startup:check', projectPath),
  listTerminals: () => ipcRenderer.invoke('terminal:list'),
  startTerminal: (options) => ipcRenderer.invoke('terminal:start', options),
  writeTerminal: (sessionId, data) => ipcRenderer.invoke('terminal:write', sessionId, data),
  resizeTerminal: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  killTerminal: (sessionId) => ipcRenderer.invoke('terminal:kill', sessionId),
  onTerminalData: (handler) => {
    const listener = (_event, sessionId, data) => {
      handler(sessionId, data);
    };
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onTerminalExit: (handler) => {
    const listener = (_event, sessionId, exitCode) => {
      handler(sessionId, exitCode);
    };
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.removeListener('terminal:exit', listener);
  },
});
