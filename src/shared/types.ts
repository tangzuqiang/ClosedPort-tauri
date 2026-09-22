export type Protocol = 'TCP' | 'UDP' | 'TCP6' | 'UDP6';

export interface PortEntry {
  protocol: Protocol;
  localAddress: string;
  localPort: number;
  remoteAddress?: string;
  remotePort?: number;
  state?: string;
  pid: number;
  processName?: string;
  processPath?: string;
  user?: string;
  commandLine?: string;
  parentPid?: number;
  parentName?: string;
}

export interface FolderHandleEntry {
  pid: number;
  processName: string;
  processPath?: string;
  handleType: string;
  resourcePath: string;
}

export interface FolderScanMeta {
  /** Which detection backend produced the result. */
  backend: 'handle.exe' | 'restart-manager' | 'unsupported';
  /** Number of files passed to RestartManager (fallback path only). */
  scannedFileCount?: number;
  /** False when the path is missing / not a directory. */
  folderExists: boolean;
}

export interface FolderScanResult {
  entries: FolderHandleEntry[];
  meta: FolderScanMeta;
}

export interface KillResult {
  pid: number;
  success: boolean;
  message?: string;
}

export interface SystemInfo {
  platform: 'win32' | 'darwin' | 'linux';
  isAdmin: boolean;
  handleAvailable: boolean;
  /**
   * True when the "Spawn test ports" diagnostic action is available.
   * Windows-only; always false on macOS / Linux.
   */
  devToolsEnabled: boolean;
}

export interface SystemMemoryInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  availableBytes: number;
  cachedBytes: number;
  compressedBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  capturedAt: number;
  backend: 'win32' | 'darwin' | 'linux' | 'unsupported';
  warning?: string;
}

export interface SpawnedTestPort {
  pid: number;
  port: number;
  /**
   * Random per-spawn token. Used by the renderer to highlight TEST rows
   * by (pid + token) rather than pid alone, so a recycled OS PID picked
   * up by an unrelated process after our holder dies cannot inherit
   * the orange highlight or the "Kill" affordance.
   */
  token: string;
}

export interface ListPortsOptions {
  refresh?: boolean;
}

/**
 * One row in the Processes tab. Memory figures are all in BYTES so the
 * renderer can format consistently. We deliberately surface three memory
 * dimensions because users repeatedly ask for different ones:
 *   - rss      : "real" physical footprint (Working Set on Windows,
 *                Resident Set Size on macOS / Linux). Matches Task Manager's
 *                "Memory (active private working set)" column closely.
 *   - privateBytes : private commit (Windows: PrivateMemorySize64; mac/linux:
 *                approximated from RSS - shared, fall back to RSS if the
 *                kernel doesn't expose it cheaply). What users mean when they
 *                say "memory this process actually owns".
 *   - virtualBytes : virtual address space reservation. Useful for spotting
 *                JIT / sandbox / GPU process bloat. Usually much larger than
 *                physical and never freed.
 *
 * `cpuPercent` is per-process CPU usage averaged over a short window. On
 * Windows we use `Get-Process .CPU` (total CPU seconds) sampled twice; on
 * Unix we read `%CPU` from `ps`. May be 0 when sampling hasn't started yet.
 */
export interface ProcessEntry {
  pid: number;
  parentPid?: number;
  name: string;
  path?: string;
  user?: string;
  commandLine?: string;
  rssBytes: number;
  privateBytes: number;
  virtualBytes: number;
  cpuPercent: number;
  /** Seconds since process started. -1 when unknown. */
  uptimeSeconds: number;
  /** Number of threads in the process. -1 when unknown. */
  threadCount: number;
}

export interface ListProcessesOptions {
  /**
   * Reserved for future "give me a cheap, partial refresh" mode. Today
   * the list is always a fresh full snapshot.
   */
  refresh?: boolean;
}

export interface ProcessListResult {
  entries: ProcessEntry[];
  /** Wall-clock when the snapshot was taken (epoch ms). */
  capturedAt: number;
  /**
   * Identifies the backend used. Useful for the UI to show a tooltip
   * like "values come from `ps -axo` on this machine".
   */
  backend: 'powershell' | 'ps' | 'ps+proc' | 'unsupported';
  /** Optional human-readable error if the backend partially failed. */
  warning?: string;
}

export interface ScanFolderOptions {
  folderPath: string;
  recursive?: boolean;
}

/** Windows startup-item source buckets shown in the Startups tab. */
export type StartupSource =
  | 'registry'
  | 'folder'
  | 'task'
  | 'service'
  | 'browser';

export interface StartupEntry {
  /** Stable id used by setEnabled / update / delete IPC. */
  id: string;
  name: string;
  source: StartupSource;
  /** Human-readable origin, e.g. HKCU\\...\\Run or Chrome / Default. */
  location: string;
  /** Command line, lnk target, task action, service PathName, or extension id. */
  command: string;
  enabled: boolean;
  /** Absolute path best suited for revealInFolder (exe / lnk / extension dir). */
  revealPath?: string;
  publisher?: string;
  canEdit: boolean;
  canDelete: boolean;
  needsAdmin: boolean;
  /** True for critical services that must not be disabled. */
  protected?: boolean;
}

export interface StartupListResult {
  entries: StartupEntry[];
  capturedAt: number;
  warnings: string[];
}

export interface StartupMutationResult {
  success: boolean;
  message?: string;
}

export interface HostEntry {
  id: string;
  address: string;
  hostnames: string[];
  comment: string;
  enabled: boolean;
}
export interface HostListResult { entries: HostEntry[]; path: string; capturedAt: number; }
export interface HostMutation { address: string; hostnames: string[]; comment: string; enabled: boolean; }
export interface HostMutationResult { success: boolean; message?: string; }

export interface ScriptCommand {
  id: string;
  name: string;
  command: string;
  createdAt: number;
  updatedAt: number;
}
export interface ScriptMutationResult { success: boolean; message?: string; executionId?: string; }
export interface ScriptStreamEvent {
  executionId: string;
  scriptId: string;
  type: 'sse' | 'stdout' | 'stderr' | 'error' | 'exit';
  data: string;
  timestamp: number;
  event?: string;
  id?: string;
  exitCode?: number;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  notes: string;
  url: string;
  available: boolean;
}

export interface ApiSurface {
  checkUpdate(): Promise<UpdateInfo>;
  installUpdate(): Promise<string>;
  appVersion(): Promise<string>;
  listPorts(options?: ListPortsOptions): Promise<PortEntry[]>;
  listProcesses(options?: ListProcessesOptions): Promise<ProcessListResult>;
  scanFolder(options: ScanFolderOptions): Promise<FolderHandleEntry[]>;
  scanFolderEx(options: ScanFolderOptions): Promise<FolderScanResult>;
  killProcess(pid: number, force?: boolean): Promise<KillResult>;
  killProcesses(pids: number[], force?: boolean): Promise<KillResult[]>;
  getSystemInfo(): Promise<SystemInfo>;
  getSystemMemory(): Promise<SystemMemoryInfo>;
  toggleFloating(): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  revealInFolder(filePath: string): Promise<void>;
  spawnTestPorts(count: number): Promise<SpawnedTestPort[]>;
  listStartups(): Promise<StartupListResult>;
  setStartupEnabled(id: string, enabled: boolean): Promise<StartupMutationResult>;
  updateStartup(id: string, command: string): Promise<StartupMutationResult>;
  deleteStartup(id: string): Promise<StartupMutationResult>;
  listHosts(): Promise<HostListResult>;
  saveHost(id: string | null, input: HostMutation): Promise<HostMutationResult>;
  saveHosts(inputs: HostMutation[]): Promise<HostMutationResult>;
  deleteHost(id: string): Promise<HostMutationResult>;
  createTerminal(): Promise<string>;
  writeTerminal(id: string, data: string): void;
  resizeTerminal(id: string, cols: number, rows: number): void;
  closeTerminal(id: string): void;
  onTerminalData(listener: (id: string, data: string) => void): () => void;
  onTerminalExit(listener: (id: string, exitCode: number) => void): () => void;
  onTerminalToggle(listener: () => void): () => void;
  writeClipboardText(text: string): void;
  listScripts(): Promise<ScriptCommand[]>;
  saveScript(id: string | null, name: string, command: string): Promise<ScriptMutationResult>;
  deleteScript(id: string): Promise<ScriptMutationResult>;
  executeScript(id: string): Promise<ScriptMutationResult>;
  stopScript(executionId: string): void;
  onScriptEvent(listener: (event: ScriptStreamEvent) => void): () => void;
  /**
   * Resolve a renderer-side {@link File} (typically from a drag-and-drop
   * payload) to its absolute filesystem path. Uses Electron's
   * `webUtils.getPathForFile`. Returns `''` when the File has no real
   * backing path (rare; e.g. clipboard image paste).
   */
  resolveDroppedPath(file: File): string;
}
