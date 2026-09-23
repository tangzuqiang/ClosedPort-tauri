import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ApiSurface, HostMutation, ScanFolderOptions, ScriptStreamEvent } from '../../shared/types';

const listeners = <T>(event: string, callback: (payload: T) => void): (() => void) => {
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  void listen<T>(event, ({ payload }) => callback(payload)).then((fn) => {
    if (disposed) fn(); else unlisten = fn;
  });
  return () => { disposed = true; unlisten?.(); };
};

export const tauriApi: ApiSurface = {
  checkUpdate: () => invoke('check_update'),
  installUpdate: () => invoke('install_update'),
  appVersion: () => invoke('app_version'),
  listPorts: () => invoke('list_ports'),
  listProcesses: () => invoke('list_processes'),
  scanFolder: (options: ScanFolderOptions) => invoke('scan_folder', { options }),
  scanFolderEx: (options: ScanFolderOptions) => invoke('scan_folder_ex', { options }),
  killProcess: (pid, force = true) => invoke('kill_process', { pid, force }),
  killProcesses: (pids, force = true) => invoke('kill_processes', { pids, force }),
  getSystemInfo: () => invoke('get_system_info'),
  getSystemMemory: () => invoke('get_system_memory'),
  toggleFloating: () => invoke('toggle_floating'),
  pickFolder: () => invoke('pick_folder'),
  revealInFolder: (filePath) => invoke('reveal_in_folder', { filePath }),
  spawnTestPorts: (count) => invoke('spawn_test_ports', { count }),
  listStartups: () => invoke('list_startups'),
  setStartupEnabled: (id, enabled) => invoke('set_startup_enabled', { id, enabled }),
  updateStartup: (id, command) => invoke('update_startup', { id, command }),
  deleteStartup: (id) => invoke('delete_startup', { id }),
  listHostProfiles: () => invoke('list_host_profiles'),
  createHostProfile: (name) => invoke('create_host_profile', { name }),
  renameHostProfile: (id, name) => invoke('rename_host_profile', { id, name }),
  deleteHostProfile: (id) => invoke('delete_host_profile', { id }),
  activateHostProfile: (id) => invoke('activate_host_profile', { id }),
  listHosts: (profileId) => invoke('list_hosts', { profileId }),
  saveHost: (profileId: string, id: string | null, input: HostMutation) => invoke('save_host', { profileId, id, input }),
  saveHosts: (profileId: string, inputs: HostMutation[]) => invoke('save_hosts', { profileId, inputs }),
  deleteHost: (profileId, id) => invoke('delete_host', { profileId, id }),
  createTerminal: () => invoke('create_terminal'),
  writeTerminal: (id, data) => { void invoke('write_terminal', { id, data }); },
  resizeTerminal: (id, cols, rows) => { void invoke('resize_terminal', { id, cols, rows }); },
  closeTerminal: (id) => { void invoke('close_terminal', { id }); },
  onTerminalData: (callback) => listeners<{ id: string; data: string }>('terminal-data', (p) => callback(p.id, p.data)),
  onTerminalExit: (callback) => listeners<{ id: string; exitCode: number }>('terminal-exit', (p) => callback(p.id, p.exitCode)),
  onTerminalToggle: (callback) => listeners('terminal-toggle', callback),
  writeClipboardText: (text) => { void invoke('write_clipboard_text', { text }); },
  listScripts: () => invoke('list_scripts'),
  saveScript: (id, name, command) => invoke('save_script', { id, name, command }),
  deleteScript: (id) => invoke('delete_script', { id }),
  executeScript: (id) => invoke('execute_script', { id }),
  stopScript: (executionId) => { void invoke('stop_script', { executionId }); },
  onScriptEvent: (callback) => listeners<ScriptStreamEvent>('script-event', callback),
  resolveDroppedPath: (file: File) => (file as File & { path?: string }).path ?? ''
};

window.closedport = tauriApi;
