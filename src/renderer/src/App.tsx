import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type {
  PortEntry,
  ProcessEntry,
  StartupEntry,
  StartupSource,
  HostEntry,
  ScriptCommand,
  ScriptStreamEvent,
  SystemInfo,
  SystemMemoryInfo,
  UpdateInfo
} from '../../shared/types';
import { LanguageContext, useT } from './i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

type SortKey =
  | 'localPort'
  | 'protocol'
  | 'state'
  | 'pid'
  | 'processName'
  | 'processPath'
  | 'parentName';

interface SortSpec {
  key: SortKey;
  asc: boolean;
}

type ViewMode = 'flat' | 'grouped';
type GroupSortKey = 'name' | 'ports' | 'pids';

const App: React.FC = () => {
  const [tab, setTab] = useState<'ports' | 'folder' | 'processes' | 'startup' | 'hosts' | 'scripts'>(
    'ports'
  );
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const t = useT();
  const { lang, setLang } = React.useContext(LanguageContext);

  useEffect(() => {
    window.closedport
      .getSystemInfo()
      .then(setSystemInfo)
      .catch(() => setSystemInfo(null));
  }, []);

  useEffect(
    () => window.closedport.onTerminalToggle(() => setTerminalOpen((open) => !open)),
    []
  );

  const checkForUpdate = useCallback(async (showResult = true) => {
    setCheckingUpdate(true);
    if (showResult) setUpdateStatus('');
    try {
      const info = await window.closedport.checkUpdate();
      setUpdateInfo(info);
      if (showResult) {
        setUpdateStatus(info.available
          ? (lang === 'zh' ? `发现新版本 ${info.latest}` : `Version ${info.latest} is available`)
          : (lang === 'zh' ? `已是最新版本 ${info.current}` : `Up to date (${info.current})`));
      }
    } catch (error) {
      if (showResult) setUpdateStatus(String(error));
    } finally {
      setCheckingUpdate(false);
    }
  }, [lang]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void checkForUpdate(false); }, 1200);
    return () => window.clearTimeout(timer);
  }, [checkForUpdate]);

  const applyUpdate = useCallback(async () => {
    setInstallingUpdate(true);
    setUpdateStatus(lang === 'zh' ? '正在下载并校验安装包…' : 'Downloading and verifying installer…');
    try {
      setUpdateStatus(await window.closedport.installUpdate());
    } catch (error) {
      setUpdateStatus(String(error));
      setInstallingUpdate(false);
    }
  }, [lang]);

  // Block the browser default for any dragover/drop that escapes the
  // folder drop-zone. Without this, dropping a file outside the
  // designated panel would cause Electron to navigate the renderer
  // away to file:///... — visually identical to the app crashing.
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      // Only suppress when the payload looks like files; leave plain
      // text drags (selection, etc.) alone.
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
      }
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">ClosedPort</span>
        <div className="lang-switch" role="group" aria-label="Language">
          <button
            className={lang === 'en' ? 'lang-active' : ''}
            onClick={() => setLang('en')}
          >
            {t('lang.en')}
          </button>
          <button
            className={lang === 'zh' ? 'lang-active' : ''}
            onClick={() => setLang('zh')}
          >
            {t('lang.zh')}
          </button>
        </div>
        <div className="tabs">
          <div
            className={`tab ${tab === 'ports' ? 'active' : ''}`}
            onClick={() => setTab('ports')}
          >
            {t('tab.ports')}
          </div>
          <div
            className={`tab ${tab === 'folder' ? 'active' : ''}`}
            onClick={() => setTab('folder')}
          >
            {t('tab.folder')}{' '}
            {systemInfo?.platform !== 'win32' && t('tab.folder.winOnly')}
          </div>
          <div
            className={`tab ${tab === 'processes' ? 'active' : ''}`}
            onClick={() => setTab('processes')}
          >
            {t('tab.processes')}
          </div>
          <div
            className={`tab ${tab === 'startup' ? 'active' : ''}`}
            onClick={() => setTab('startup')}
          >
            {t('tab.startup')}{' '}
            {systemInfo?.platform !== 'win32' && t('tab.startup.winOnly')}
          </div>
          <div className={`tab ${tab === 'hosts' ? 'active' : ''}`} onClick={() => setTab('hosts')}>
            {t('tab.hosts')}
          </div>
          <div className={`tab ${tab === 'scripts' ? 'active' : ''}`} onClick={() => setTab('scripts')}>
            {t('tab.scripts')}
          </div>
        </div>
        <div className="spacer" />
        {systemInfo && (
          <>
            <span className="badge">{systemInfo.platform}</span>
            <span className={`badge ${systemInfo.isAdmin ? 'ok' : 'warn'}`}>
              {systemInfo.isAdmin ? t('common.elevated') : t('common.standard')}
            </span>
          </>
        )}
        <button onClick={() => window.closedport.toggleFloating()}>
          {t('common.floating')}
        </button>
        {systemInfo?.platform === 'win32' && (
          <button title="Ctrl+F12" onClick={() => setTerminalOpen((open) => !open)}>
            {t('terminal.title')}
          </button>
        )}
        <button className={updateInfo?.available ? 'update-available' : ''} onClick={() => setUpdateOpen(true)}>
          {lang === 'zh' ? '关于 / 更新' : 'About / Update'}{updateInfo?.available ? ' •' : ''}
        </button>
      </header>

      {updateOpen && (
        <div className="update-overlay" onMouseDown={(event) => event.target === event.currentTarget && setUpdateOpen(false)}>
          <section className="update-dialog" role="dialog" aria-modal="true">
            <div className="update-dialog-title">
              <strong>{lang === 'zh' ? '关于与更新' : 'About & Update'}</strong>
              <button onClick={() => setUpdateOpen(false)}>×</button>
            </div>
            <div className="update-version">ClosedPort {updateInfo?.current ?? '0.3.0'}</div>
            {updateInfo?.available && <div className="update-new">{lang === 'zh' ? '最新版本' : 'Latest'}: {updateInfo.latest}</div>}
            {updateInfo?.notes && <p>{updateInfo.notes}</p>}
            {updateStatus && <p className="update-status">{updateStatus}</p>}
            <div className="update-actions">
              <button disabled={checkingUpdate || installingUpdate} onClick={() => void checkForUpdate(true)}>
                {checkingUpdate ? (lang === 'zh' ? '检查中…' : 'Checking…') : (lang === 'zh' ? '检查更新' : 'Check for updates')}
              </button>
              <button disabled={!updateInfo?.available || installingUpdate} onClick={() => void applyUpdate()}>
                {installingUpdate ? (lang === 'zh' ? '正在更新…' : 'Updating…') : (lang === 'zh' ? '立即更新' : 'Update now')}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Both views are kept mounted so toggling tabs doesn't reset
          filters / sort / expanded groups / scan results. We just hide
          the inactive one with display:none. */}
      <div
        className="tab-pane"
        style={{
          display: tab === 'ports' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0
        }}
      >
        <PortsView systemInfo={systemInfo} />
      </div>
      <div
        className="tab-pane"
        style={{
          display: tab === 'folder' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0
        }}
      >
        <FolderView systemInfo={systemInfo} />
      </div>
      <div
        className="tab-pane"
        style={{
          display: tab === 'processes' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0
        }}
      >
        <ProcessesView />
      </div>
      <div
        className="tab-pane"
        style={{
          display: tab === 'startup' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0
        }}
      >
        <StartupView systemInfo={systemInfo} />
      </div>
      <div className="tab-pane" style={{ display: tab === 'hosts' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <HostsView systemInfo={systemInfo} />
      </div>
      <div className="tab-pane" style={{ display: tab === 'scripts' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <ScriptsView />
      </div>
      {systemInfo?.platform === 'win32' && (
        <TerminalPanel visible={terminalOpen} onHide={() => setTerminalOpen(false)} />
      )}
    </div>
  );
};

const PortsView: React.FC<{ systemInfo: SystemInfo | null }> = ({
  systemInfo
}) => {
  const t = useT();
  const [rows, setRows] = useState<PortEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortSpec>({ key: 'localPort', asc: true });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('flat');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [groupSort, setGroupSort] = useState<{
    key: GroupSortKey;
    asc: boolean;
  }>({ key: 'name', asc: true });
  // Track PIDs we created via the "Spawn test ports" diagnostic so we can
  // visually highlight them in the list (orange badge / striped row). The
  // set persists across refreshes and is only cleared when the user clicks
  // "Clear test markers" or successfully kills them.
  const [spawnedPids, setSpawnedPids] = useState<Set<number>>(new Set());
  const [spawnedPorts, setSpawnedPorts] = useState<Set<number>>(new Set());
  // Authoritative pid -> port map for spawned test holders. Used by
  // dropSpawnedFor so we don't have to reverse-lookup against `rows`,
  // which could already be stale after a manual refresh between confirm
  // and kill.
  const [spawnedPidToPort, setSpawnedPidToPort] = useState<Map<number, number>>(
    new Map()
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.closedport.listPorts();
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // PID-recycle guard: after each refresh, verify that every spawned
  // (pid, port) pair we still believe in is actually present in `rows`.
  // If a holder has died and Windows has handed its PID to an unrelated
  // process, that unrelated process will not also be sitting on our
  // recorded port, so we drop the marker. This means a recycled PID
  // can no longer inherit the orange TEST highlight (or, more
  // critically, the renderer's "this is one of our throw-away children"
  // semantics that downstream Kill / Kill Group rely on).
  useEffect(() => {
    if (spawnedPidToPort.size === 0) return;
    const stillValid = new Map<number, number>();
    for (const [pid, port] of spawnedPidToPort) {
      const matched = rows.some((r) => r.pid === pid && r.localPort === port);
      if (matched) stillValid.set(pid, port);
    }
    if (stillValid.size === spawnedPidToPort.size) return;
    setSpawnedPidToPort(stillValid);
    setSpawnedPids(new Set(stillValid.keys()));
    setSpawnedPorts(new Set(stillValid.values()));
  }, [rows, spawnedPidToPort]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter((r) => {
        return (
          String(r.localPort).includes(q) ||
          String(r.pid).includes(q) ||
          (r.processName || '').toLowerCase().includes(q) ||
          (r.processPath || '').toLowerCase().includes(q) ||
          (r.protocol || '').toLowerCase().includes(q) ||
          (r.state || '').toLowerCase().includes(q) ||
          (r.parentName || '').toLowerCase().includes(q)
        );
      });
    }
    const { key, asc } = sort;
    list = [...list].sort((a, b) => {
      // Always float spawned-test rows to the top so the user can see and
      // verify the kill flow without scrolling. This wins over any column
      // sort.
      const aTest =
        spawnedPids.has(a.pid) || spawnedPorts.has(a.localPort) ? 1 : 0;
      const bTest =
        spawnedPids.has(b.pid) || spawnedPorts.has(b.localPort) ? 1 : 0;
      if (aTest !== bTest) return bTest - aTest;
      const va = a[key];
      const vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return asc ? va - vb : vb - va;
      }
      return asc
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return list;
  }, [rows, filter, sort, spawnedPids, spawnedPorts]);

  // Aggregate filtered rows by processName (or "Unknown") for the grouped view.
  // Each group exposes the unique pids it owns and the count of port records.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        path?: string;
        pids: Set<number>;
        items: PortEntry[];
      }
    >();
    for (const r of filtered) {
      const key = r.processName || 'Unknown';
      let g = map.get(key);
      if (!g) {
        g = { key, name: key, path: r.processPath, pids: new Set(), items: [] };
        map.set(key, g);
      }
      if (!g.path && r.processPath) g.path = r.processPath;
      if (r.pid > 0) g.pids.add(r.pid);
      g.items.push(r);
    }
    const all = Array.from(map.values());
    // Pull "Unknown" bucket aside so it always renders at the bottom,
    // regardless of how many ports/pids it aggregates.
    const unknown = all.filter((g) => g.name === 'Unknown');
    const named = all.filter((g) => g.name !== 'Unknown');
    named.sort((a, b) => {
      const dir = groupSort.asc ? 1 : -1;
      if (groupSort.key === 'ports') {
        if (a.items.length !== b.items.length) {
          return (a.items.length - b.items.length) * dir;
        }
        return a.name.localeCompare(b.name) * dir;
      }
      if (groupSort.key === 'pids') {
        if (a.pids.size !== b.pids.size) {
          return (a.pids.size - b.pids.size) * dir;
        }
        return a.name.localeCompare(b.name) * dir;
      }
      // name (case-insensitive)
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir;
    });
    return [...named, ...unknown];
  }, [filtered, groupSort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, asc: !prev.asc } : { key, asc: true }
    );
  };

  const toggleSelect = (pid: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dropSpawnedFor = (pids: number[]) => {
    if (pids.length === 0) return;
    const pidSet = new Set(pids);
    // Resolve ports via the authoritative spawn-time map (avoids reverse
    // lookup against possibly-stale `rows`).
    const portsBeingKilled = new Set<number>();
    for (const pid of pids) {
      const port = spawnedPidToPort.get(pid);
      if (typeof port === 'number') portsBeingKilled.add(port);
    }
    setSpawnedPids((prev) => {
      const next = new Set(prev);
      for (const p of pids) next.delete(p);
      return next;
    });
    setSpawnedPorts((prev) => {
      const next = new Set(prev);
      for (const port of portsBeingKilled) next.delete(port);
      return next;
    });
    setSpawnedPidToPort((prev) => {
      const next = new Map(prev);
      for (const p of pidSet) next.delete(p);
      return next;
    });
  };

  const killOne = async (pid: number) => {
    if (!confirm(t('ports.killOneConfirm').replace('{pid}', String(pid)))) return;
    const res = await window.closedport.killProcess(pid, true);
    if (!res.success) {
      alert(`${t('ports.failed')} ${pid}: ${res.message}`);
    } else {
      dropSpawnedFor([pid]);
    }
    await refresh();
  };

  const killSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(t('ports.killManyConfirm').replace('{n}', String(selected.size)))) return;
    const pids = Array.from(selected);
    const results = await window.closedport.killProcesses(pids, true);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `${t('ports.failed')} ${failed.map((f) => `${f.pid}: ${f.message}`).join('\n')}`
      );
    }
    const succeededPids = results.filter((r) => r.success).map((r) => r.pid);
    dropSpawnedFor(succeededPids);
    setSelected(new Set());
    await refresh();
  };

  const killGroup = async (pids: number[]) => {
    if (pids.length === 0) return;
    if (!confirm(t('ports.killGroupConfirm').replace('{n}', String(pids.length)))) return;
    const results = await window.closedport.killProcesses(pids, true);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `${t('ports.failed')} ${failed.map((f) => `${f.pid}: ${f.message}`).join('\n')}`
      );
    }
    const succeededPids = results.filter((r) => r.success).map((r) => r.pid);
    dropSpawnedFor(succeededPids);
    await refresh();
  };

  const clearTestMarkers = () => {
    setSpawnedPids(new Set());
    setSpawnedPorts(new Set());
    setSpawnedPidToPort(new Map());
  };

  const spawnTestPorts = async () => {
    try {
      const spawned = await window.closedport.spawnTestPorts(5);
      if (spawned.length === 0) {
        alert(t('ports.testSpawnedNone'));
      } else {
        setSpawnedPids((prev) => {
          const next = new Set(prev);
          spawned.forEach((s) => next.add(s.pid));
          return next;
        });
        setSpawnedPorts((prev) => {
          const next = new Set(prev);
          spawned.forEach((s) => next.add(s.port));
          return next;
        });
        setSpawnedPidToPort((prev) => {
          const next = new Map(prev);
          spawned.forEach((s) => next.set(s.pid, s.port));
          return next;
        });
        // Auto-switch to Flat and clear filter so the highlighted rows
        // are immediately visible without being filtered out.
        setViewMode('flat');
        setFilter('');
      }
      await refresh();
    } catch (err) {
      alert(`${t('ports.testSpawnedFailed')} ${(err as Error)?.message ?? err}`);
    }
  };

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          placeholder={t('ports.filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 380 }}
        />
        <div className="view-switch">
          <button
            className={viewMode === 'flat' ? 'primary' : 'ghost'}
            onClick={() => setViewMode('flat')}
          >
            {t('ports.view.flat')}
          </button>
          <button
            className={viewMode === 'grouped' ? 'primary' : 'ghost'}
            onClick={() => setViewMode('grouped')}
          >
            {t('ports.view.groupExe')}
          </button>
        </div>
        <button onClick={refresh} disabled={loading}>
          {loading ? t('common.refreshing') : t('common.refresh')}
        </button>
        <button
          className="danger"
          onClick={killSelected}
          disabled={selected.size === 0}
        >
          {t('ports.killSelected')} ({selected.size})
        </button>
        {systemInfo?.devToolsEnabled && (
          <button
            className="test"
            onClick={spawnTestPorts}
            title={t('ports.spawnTestTitle')}
          >
            {t('ports.spawnTest')}
          </button>
        )}
        {(spawnedPids.size > 0 || spawnedPorts.size > 0) && (
          <button
            className="ghost"
            onClick={clearTestMarkers}
            title={t('ports.clearTestMarkersTitle')}
          >
            {t('ports.clearTestMarkers')} ({spawnedPids.size})
          </button>
        )}
        <div className="spacer" />
        <span className="badge">
          {viewMode === 'flat'
            ? `${filtered.length} ${t('ports.entries')}`
            : `${groups.length} ${t('ports.appsSlash')} / ${filtered.length} ${t('ports.entries')}`}
        </span>
      </div>

      {error && <div className="banner">{error}</div>}

      <div className="content">
        {filtered.length === 0 && !loading ? (
          <div className="empty">{t('ports.empty')}</div>
        ) : viewMode === 'flat' ? (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th onClick={() => toggleSort('protocol')}>{t('ports.col.proto')}</th>
                <th onClick={() => toggleSort('localPort')}>{t('ports.col.local')}</th>
                <th>{t('ports.col.remote')}</th>
                <th onClick={() => toggleSort('state')}>{t('ports.col.state')}</th>
                <th onClick={() => toggleSort('pid')}>{t('ports.col.pid')}</th>
                <th onClick={() => toggleSort('processName')}>{t('ports.col.process')}</th>
                <th onClick={() => toggleSort('parentName')} title={t('ports.col.startedBy')}>
                  {t('ports.col.startedBy')}
                </th>
                <th onClick={() => toggleSort('processPath')}>{t('ports.col.path')}</th>
                <th>{t('ports.col.user')}</th>
                <th style={{ width: 140 }}>{t('ports.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isTest =
                  spawnedPids.has(r.pid) || spawnedPorts.has(r.localPort);
                const cls = [
                  selected.has(r.pid) ? 'selected' : '',
                  isTest ? 'test-port' : ''
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr
                    key={`${r.protocol}-${r.localAddress}-${r.localPort}-${r.pid}`}
                    className={cls}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r.pid)}
                        onChange={() => toggleSelect(r.pid)}
                      />
                    </td>
                    <td>{r.protocol}</td>
                    <td className="mono">
                      {r.localAddress}:{r.localPort}
                      {isTest && (
                        <span className="test-tag" title={t('ports.testTag')}>
                          TEST
                        </span>
                      )}
                    </td>
                    <td className="mono">
                      {r.remoteAddress
                        ? `${r.remoteAddress}:${r.remotePort ?? ''}`
                        : '—'}
                    </td>
                    <td>{r.state || '—'}</td>
                    <td className="mono">{r.pid || '—'}</td>
                    <td title={r.processName}>{r.processName || '—'}</td>
                    <td
                      className="mono"
                      title={
                        r.parentName
                          ? `${r.parentName} (pid ${r.parentPid})`
                          : r.parentPid
                            ? `pid ${r.parentPid}`
                            : ''
                      }
                    >
                      {r.parentName
                        ? `${r.parentName} (${r.parentPid})`
                        : r.parentPid
                          ? `pid ${r.parentPid}`
                          : '—'}
                    </td>
                    <td className="mono" title={r.processPath}>
                      {r.processPath || '—'}
                    </td>
                    <td>{r.user || '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="ghost"
                          disabled={!r.processPath}
                          onClick={() =>
                            r.processPath &&
                            window.closedport.revealInFolder(r.processPath)
                          }
                          title={t('ports.openTitle')}
                        >
                          {t('common.open')}
                        </button>
                        <button
                          className="danger"
                          disabled={!r.pid}
                          onClick={() => killOne(r.pid)}
                        >
                          {t('common.kill')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="group-list">
            <div className="group-sort-bar">
              <span className="group-sort-label">{t('ports.sortBy')}</span>
              {(['name', 'ports', 'pids'] as GroupSortKey[]).map((k) => {
                const active = groupSort.key === k;
                const arrow = active ? (groupSort.asc ? ' ↑' : ' ↓') : '';
                return (
                  <button
                    key={k}
                    className={active ? 'primary' : 'ghost'}
                    onClick={() =>
                      setGroupSort((prev) =>
                        prev.key === k
                          ? { key: k, asc: !prev.asc }
                          : { key: k, asc: k === 'name' }
                      )
                    }
                  >
                    {k === 'name'
                      ? t('ports.sort.name')
                      : k === 'ports'
                        ? t('ports.sort.ports')
                        : t('ports.sort.pids')}
                    {arrow}
                  </button>
                );
              })}
            </div>
            {groups.map((g) => {
              const isOpen = expanded.has(g.key);
              const groupHasTest =
                g.items.some(
                  (r) =>
                    spawnedPids.has(r.pid) || spawnedPorts.has(r.localPort)
                );
              return (
                <div
                  className={`group${groupHasTest ? ' test-group' : ''}`}
                  key={g.key}
                >
                  <div
                    className="group-header"
                    onClick={() => toggleExpand(g.key)}
                  >
                    <span className="group-toggle">
                      {isOpen ? '−' : '+'}
                    </span>
                    <span className="group-name" title={g.path}>
                      {g.name}
                    </span>
                    <span className="badge">{g.items.length} {t('ports.ports')}</span>
                    <span className="badge">{g.pids.size} {t('ports.pids')}</span>
                    <span className="group-path mono" title={g.path}>
                      {g.path || ''}
                    </span>
                    <div className="spacer" />
                    <button
                      className="ghost"
                      disabled={!g.path}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (g.path) window.closedport.revealInFolder(g.path);
                      }}
                    >
                      {t('common.open')}
                    </button>
                    <button
                      className="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        killGroup(Array.from(g.pids));
                      }}
                    >
                      {t('ports.killGroup')}
                    </button>
                  </div>
                  {isOpen && (
                    <table className="table compact">
                      <thead>
                        <tr>
                          <th>{t('ports.col.proto')}</th>
                          <th>{t('ports.col.local')}</th>
                          <th>{t('ports.col.state')}</th>
                          <th>{t('ports.col.pid')}</th>
                          <th>{t('ports.col.startedBy')}</th>
                          <th style={{ width: 100 }}>{t('ports.col.action')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((r) => {
                          const isTest =
                            spawnedPids.has(r.pid) ||
                            spawnedPorts.has(r.localPort);
                          return (
                            <tr
                              key={`${g.key}-${r.protocol}-${r.localAddress}-${r.localPort}-${r.pid}`}
                              className={isTest ? 'test-port' : ''}
                            >
                              <td>{r.protocol}</td>
                              <td className="mono">
                                {r.localAddress}:{r.localPort}
                                {isTest && (
                                  <span
                                    className="test-tag"
                                    title={t('ports.testTag')}
                                  >
                                    TEST
                                  </span>
                                )}
                              </td>
                              <td>{r.state || '—'}</td>
                              <td className="mono">{r.pid || '—'}</td>
                              <td className="mono">
                                {r.parentName
                                  ? `${r.parentName} (${r.parentPid})`
                                  : r.parentPid
                                    ? `pid ${r.parentPid}`
                                    : '—'}
                              </td>
                              <td>
                                <button
                                  className="danger"
                                  disabled={!r.pid}
                                  onClick={() => killOne(r.pid)}
                                >
                                  {t('common.kill')}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};

const FolderView: React.FC<{ systemInfo: SystemInfo | null }> = ({
  systemInfo
}) => {
  const t = useT();
  const [folder, setFolder] = useState('');
  const [rows, setRows] = useState<
    Array<{
      pid: number;
      processName: string;
      processPath?: string;
      handleType: string;
      resourcePath: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMeta, setLastMeta] = useState<{
    backend: 'handle.exe' | 'restart-manager' | 'unsupported';
    scannedFileCount?: number;
    folderExists: boolean;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const isWin = systemInfo?.platform === 'win32';

  const pick = async () => {
    const p = await window.closedport.pickFolder();
    if (p) setFolder(p);
  };

  const scan = useCallback(
    async (target?: string) => {
      const folderPath = (target ?? folder).trim();
      if (!folderPath) return;
      setLoading(true);
      setError(null);
      try {
        const res = await window.closedport.scanFolderEx({ folderPath });
        setRows(res.entries);
        setLastMeta(res.meta);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLastMeta(null);
      } finally {
        setLoading(false);
      }
    },
    [folder]
  );

  // Drag-and-drop: accept exactly one folder (or one file -- we'll
  // resolve to its parent directory) and trigger an immediate scan.
  //
  // Drag events fire on every nested child element (table cells, buttons,
  // even text nodes), and any time the cursor crosses a child boundary
  // the browser fires dragleave on the parent followed by dragenter on
  // the new child. A naive depth-counter approach is fragile: combined
  // with `pointer-events: none` toggling on children, the counter and
  // the class state get out of sync and the UI flickers. Instead we look
  // at `relatedTarget` -- the element the cursor is moving TO. If it's
  // still inside our wrapper, the leave is bogus and we ignore it.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const onDragEnter = (e: React.DragEvent) => {
    if (!isWin) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!isWin) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    // Both preventDefault AND a non-'none' dropEffect are required for
    // the cursor to show the copy/accept icon AND for `drop` to fire at
    // all on Chromium. Setting it on every dragover is intentional --
    // some platforms reset it between events.
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!isWin) return;
    // Ignore leaves that are really "the cursor moved from one child to
    // another inside this wrapper". Only react when relatedTarget is null
    // (left the window entirely) or sits outside our wrapper.
    const next = e.relatedTarget as Node | null;
    if (next && wrapperRef.current?.contains(next)) return;
    setIsDragOver(false);
  };
  const onDrop = async (e: React.DragEvent) => {
    if (!isWin) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const resolved = window.closedport.resolveDroppedPath(file);
    if (!resolved) {
      setError(t('folder.dropResolveFail'));
      return;
    }
    // If the user dropped a file, scan its parent directory; the user's
    // intent is almost always "who's holding things in this folder?".
    let target = resolved;
    try {
      // We can't statSync from the renderer; rely on File.type/empty
      // string heuristic: directories come through with empty `type`
      // AND some browsers report size 0. Safer: ask main via a quick
      // existsSync proxy -- but we don't have one. Use a simple rule:
      // if the path has an extension, treat as file; else folder.
      const looksLikeFile = /\.[^\\/]+$/.test(resolved);
      if (looksLikeFile) {
        const sep = resolved.includes('\\') ? '\\' : '/';
        const idx = resolved.lastIndexOf(sep);
        if (idx > 0) target = resolved.slice(0, idx);
      }
    } catch {
      /* fall back to resolved */
    }
    setFolder(target);
    await scan(target);
  };

  const killOne = async (pid: number) => {
    if (!confirm(t('folder.killOneConfirm').replace('{pid}', String(pid)))) return;
    const res = await window.closedport.killProcess(pid, true);
    if (!res.success) alert(`${t('ports.failed')} ${res.message}`);
    await scan();
  };

  const uniquePids = Array.from(new Set(rows.map((r) => r.pid)));

  const killAll = async () => {
    if (uniquePids.length === 0) return;
    if (!confirm(t('folder.killManyConfirm').replace('{n}', String(uniquePids.length)))) return;
    const results = await window.closedport.killProcesses(uniquePids, true);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `${t('ports.failed')} ${failed.map((f) => `${f.pid}: ${f.message}`).join('\n')}`
      );
    }
    await scan();
  };

  return (
    <div
      ref={wrapperRef}
      className={`folder-view${isDragOver ? ' is-dragover' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="toolbar">
        <div className="path-input">
          <input
            type="text"
            placeholder={
              isWin
                ? t('folder.placeholder.win')
                : t('folder.placeholder.other')
            }
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
          <button onClick={pick}>{t('common.browse')}</button>
        </div>
        <button
          className="primary"
          disabled={!folder || loading || !isWin}
          onClick={() => scan()}
        >
          {loading ? t('folder.scanning') : t('folder.scan')}
        </button>
        <button
          className="danger"
          disabled={uniquePids.length === 0}
          onClick={killAll}
        >
          {t('folder.killAll')} ({uniquePids.length})
        </button>
      </div>

      {!isWin && (
        <div className="banner">
          {t('folder.notWin')}
        </div>
      )}

      {isWin && systemInfo && !systemInfo.handleAvailable && (
        <div className="banner">
          <strong>{t('folder.limited.intro')}</strong>{' '}
          {t('folder.limited.body')}
        </div>
      )}

      {error && <div className="banner">{error}</div>}

      <div className="content">
        {rows.length === 0 && !loading ? (
          <div className="empty">
            {!folder ? (
              isWin
                ? t('folder.emptyPick.win')
                : t('folder.emptyPick.other')
            ) : lastMeta && !lastMeta.folderExists ? (
              <>
                <div>{t('folder.notExist')}</div>
                <div className="mono" style={{ marginTop: 6 }}>{folder}</div>
              </>
            ) : lastMeta && lastMeta.backend === 'restart-manager' ? (
              <>
                <div>
                  {t('folder.rmScanned')}{' '}
                  <strong>{lastMeta.scannedFileCount ?? 0}</strong>{' '}
                  {t('folder.rmFiles')}
                </div>
                <div style={{ marginTop: 8, opacity: 0.75 }}>
                  {t('folder.rmCaveat')}
                </div>
              </>
            ) : lastMeta && lastMeta.backend === 'handle.exe' ? (
              <>{t('folder.noneHandleExe')}</>
            ) : (
              t('folder.noneGeneric')
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('folder.col.pid')}</th>
                <th>{t('folder.col.process')}</th>
                <th>{t('folder.col.path')}</th>
                <th>{t('folder.col.handleType')}</th>
                <th>{t('folder.col.resource')}</th>
                <th style={{ width: 140 }}>{t('folder.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.pid}-${r.resourcePath}-${i}`}>
                  <td className="mono">{r.pid}</td>
                  <td>{r.processName}</td>
                  <td className="mono" title={r.processPath}>
                    {r.processPath || '—'}
                  </td>
                  <td>{r.handleType}</td>
                  <td className="mono" title={r.resourcePath}>
                    {r.resourcePath}
                  </td>
                  <td>
                    <button className="danger" onClick={() => killOne(r.pid)}>
                      {t('common.kill')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isDragOver && isWin && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <div className="drop-overlay-title">{t('folder.dropTitle')}</div>
            <div className="drop-overlay-sub">
              {t('folder.dropSub')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------- Processes Tab ----------------

type ProcSortKey =
  | 'pid'
  | 'name'
  | 'user'
  | 'cpuPercent'
  | 'rssBytes'
  | 'privateBytes'
  | 'virtualBytes'
  | 'uptimeSeconds'
  | 'threadCount';

type RefreshInterval = 'off' | '5s' | '10s' | '30s';
const REFRESH_MS: Record<RefreshInterval, number> = {
  off: 0,
  '5s': 5000,
  '10s': 10000,
  '30s': 30000
};

type ProcView = 'flat' | 'grouped' | 'tree';

interface ProcGroup {
  name: string;
  items: ProcessEntry[];
  totalRss: number;
  totalCpu: number;
}

interface TreeNode {
  entry: ProcessEntry;
  children: TreeNode[];
  depth: number;
}

/**
 * Processes tab. Three view modes share one data fetch and one selection
 * set, so the user can flip between Flat / Grouped / Tree without losing
 * what they've checked.
 *
 *  - Flat:    sortable table, one row per process. Per-row checkbox.
 *  - Grouped: collapses processes that share a name (e.g. all 18
 *             "chrome.exe" worker processes), shows aggregate RSS + CPU.
 *             Group header has a checkbox that selects every child.
 *  - Tree:    parent-child tree built from ppid. Orphans (parent not in
 *             the snapshot, e.g. Windows session manager) are pinned to
 *             the top as roots.
 *
 * Kill flow:
 *  - Per-row Kill button: always available, asks once.
 *  - Top "Kill Selected (N)": works off the checkbox selection in the
 *    current view. No regex required.
 *  - Regex field: only adds visual highlighting + a convenience "Select
 *    matched" button that *adds* matched rows to the selection. The
 *    selection then drives Kill Selected like normal. Bad regex shows
 *    an inline red border but never breaks the table.
 */
const ProcessesView: React.FC = () => {
  const tr = useT();
  const [rows, setRows] = useState<ProcessEntry[]>([]);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [backend, setBackend] = useState<string>('');
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [regexText, setRegexText] = useState('');
  const [sort, setSort] = useState<{ key: ProcSortKey; asc: boolean }>({
    key: 'rssBytes',
    asc: false
  });
  const [interval, setIntervalKey] = useState<RefreshInterval>('off');
  const [view, setView] = useState<ProcView>('flat');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [memory, setMemory] = useState<SystemMemoryInfo | null>(null);

  const refreshMemory = useCallback(async () => {
    try {
      const m = await window.closedport.getSystemMemory();
      setMemory(m);
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.closedport.listProcesses();
      setRows(res.entries);
      setCapturedAt(res.capturedAt);
      setBackend(res.backend);
      setWarning(res.warning || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshMemory();
  }, [refresh, refreshMemory]);

  // Auto-refresh. Chained setTimeout (not setInterval) so a slow
  // PowerShell snapshot under load doesn't stack queued ticks.
  useEffect(() => {
    const ms = REFRESH_MS[interval];
    if (ms === 0) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      await refresh();
      await refreshMemory();
      if (cancelled) return;
      t = setTimeout(tick, ms);
    };
    t = setTimeout(tick, ms);
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [interval, refresh, refreshMemory]);

  const { regex, regexInvalid } = useMemo(() => {
    const s = regexText.trim();
    if (!s) return { regex: null as RegExp | null, regexInvalid: false };
    try {
      return { regex: new RegExp(s, 'i'), regexInvalid: false };
    } catch {
      return { regex: null as RegExp | null, regexInvalid: true };
    }
  }, [regexText]);

  // Text filter then sort. Filter runs against pid / name / user / path.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter(
        (r) =>
          String(r.pid).includes(q) ||
          r.name.toLowerCase().includes(q) ||
          (r.user || '').toLowerCase().includes(q) ||
          (r.path || '').toLowerCase().includes(q)
      );
    }
    const { key, asc } = sort;
    list = [...list].sort((a, b) => {
      const va = (a as unknown as Record<string, unknown>)[key];
      const vb = (b as unknown as Record<string, unknown>)[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return asc ? va - vb : vb - va;
      }
      return asc
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return list;
  }, [rows, filter, sort]);

  const matchedPids = useMemo(() => {
    if (!regex) return new Set<number>();
    const out = new Set<number>();
    for (const r of filtered) {
      const hay = `${r.name} ${r.path || ''} ${r.commandLine || ''}`;
      if (regex.test(hay)) out.add(r.pid);
    }
    return out;
  }, [filtered, regex]);

  // Group by process name. Within each group we keep the same sort order
  // the user picked. Group order itself is by total RSS descending --
  // that's what users want when hunting memory hogs by app.
  const grouped = useMemo<ProcGroup[]>(() => {
    const map = new Map<string, ProcGroup>();
    for (const r of filtered) {
      const key = r.name || 'unknown';
      let g = map.get(key);
      if (!g) {
        g = { name: key, items: [], totalRss: 0, totalCpu: 0 };
        map.set(key, g);
      }
      g.items.push(r);
      g.totalRss += r.rssBytes;
      g.totalCpu += r.cpuPercent;
    }
    return Array.from(map.values()).sort((a, b) => b.totalRss - a.totalRss);
  }, [filtered]);

  // Tree: roots are processes whose parentPid is missing or points to a
  // pid that is NOT in the current snapshot. Then we depth-first walk
  // children. Cycles can't exist in a real OS process table, but we still
  // guard by tracking visited pids -- a stale ppid could in theory let
  // two pids loop on each other.
  const tree = useMemo<TreeNode[]>(() => {
    const byPid = new Map<number, ProcessEntry>();
    for (const r of rows) byPid.set(r.pid, r);
    const childrenOf = new Map<number, ProcessEntry[]>();
    for (const r of rows) {
      const ppid = r.parentPid;
      if (ppid && byPid.has(ppid) && ppid !== r.pid) {
        const arr = childrenOf.get(ppid) || [];
        arr.push(r);
        childrenOf.set(ppid, arr);
      }
    }
    const rootEntries = rows.filter(
      (r) => !r.parentPid || !byPid.has(r.parentPid) || r.parentPid === r.pid
    );
    // Apply the text filter to the tree by keeping any node that matches
    // OR whose subtree contains a match. This way searching for "node"
    // still shows you the cmd.exe -> node.exe -> child chain.
    const q = filter.trim().toLowerCase();
    const matches = (r: ProcessEntry): boolean => {
      if (!q) return true;
      return (
        String(r.pid).includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.user || '').toLowerCase().includes(q) ||
        (r.path || '').toLowerCase().includes(q)
      );
    };
    const visited = new Set<number>();
    const build = (e: ProcessEntry, depth: number): TreeNode | null => {
      if (visited.has(e.pid)) return null;
      visited.add(e.pid);
      const kids = (childrenOf.get(e.pid) || [])
        .map((c) => build(c, depth + 1))
        .filter((n): n is TreeNode => n !== null);
      const selfMatch = matches(e);
      if (!selfMatch && kids.length === 0) return null;
      return { entry: e, children: kids, depth };
    };
    const nodes = rootEntries
      .sort((a, b) => b.rssBytes - a.rssBytes)
      .map((r) => build(r, 0))
      .filter((n): n is TreeNode => n !== null);
    return nodes;
  }, [rows, filter]);

  const flattenTree = useCallback((nodes: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    const walk = (n: TreeNode) => {
      out.push(n);
      if (expanded.has(`tree-${n.entry.pid}`) || expanded.has('tree-all')) {
        for (const c of n.children) walk(c);
      }
    };
    nodes.forEach(walk);
    return out;
  }, [expanded]);

  const toggleSort = (key: ProcSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, asc: !prev.asc }
        : {
            key,
            asc: !(
              key === 'cpuPercent' ||
              key === 'rssBytes' ||
              key === 'privateBytes' ||
              key === 'virtualBytes' ||
              key === 'uptimeSeconds' ||
              key === 'threadCount'
            )
          }
    );
  };

  const toggleSelect = (pid: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const togglePids = (pids: number[], wantSelect: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of pids) {
        if (wantSelect) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAllTree = () => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add('tree-all');
      return next;
    });
  };
  const collapseAllTree = () => {
    setExpanded(new Set());
  };

  const allVisiblePids = useMemo<number[]>(() => {
    if (view === 'tree') return flattenTree(tree).map((n) => n.entry.pid);
    return filtered.map((r) => r.pid);
  }, [view, tree, flattenTree, filtered]);

  const allChecked =
    allVisiblePids.length > 0 &&
    allVisiblePids.every((p) => selected.has(p));

  const toggleSelectAll = () => {
    togglePids(allVisiblePids, !allChecked);
  };

  const selectMatched = () => {
    if (matchedPids.size === 0) return;
    togglePids(Array.from(matchedPids), true);
  };

  const clearSelection = () => setSelected(new Set());

  const killOne = async (pid: number) => {
    if (!confirm(tr('proc.killOneConfirm').replace('{pid}', String(pid)))) return;
    const res = await window.closedport.killProcess(pid, true);
    if (!res.success) alert(`${tr('ports.failed')} ${pid}: ${res.message}`);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(pid);
      return next;
    });
    await refresh();
  };

  const killSelected = async () => {
    const pids = Array.from(selected);
    if (pids.length === 0) return;
    if (!confirm(tr('proc.killSelectedConfirm').replace('{n}', String(pids.length))))
      return;
    const results = await window.closedport.killProcesses(pids, true);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `${tr('ports.failed')}\n${failed
          .slice(0, 10)
          .map((f) => `${f.pid}: ${f.message}`)
          .join('\n')}${failed.length > 10 ? `\n(+${failed.length - 10} more)` : ''}`
      );
    }
    clearSelection();
    await refresh();
  };

  const killGroup = async (pids: number[]) => {
    if (pids.length === 0) return;
    if (!confirm(tr('proc.killGroupConfirm').replace('{n}', String(pids.length)))) return;
    const results = await window.closedport.killProcesses(pids, true);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `${tr('ports.failed')}\n${failed.map((f) => `${f.pid}: ${f.message}`).join('\n')}`
      );
    }
    await refresh();
  };

  return (
    <>
      <MemoryBar mem={memory} />
      <div className="toolbar">
        <input
          type="search"
          placeholder={tr('proc.filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <input
          type="text"
          placeholder={tr('proc.regexPlaceholder')}
          value={regexText}
          onChange={(e) => setRegexText(e.target.value)}
          className={`proc-regex${regexInvalid ? ' invalid' : ''}`}
          title={regexInvalid ? tr('proc.regexInvalid') : tr('proc.regexTitle')}
          style={{ maxWidth: 300 }}
        />
        <button
          className={matchedPids.size > 0 ? 'primary' : 'ghost'}
          onClick={selectMatched}
          disabled={matchedPids.size === 0}
          title={tr('proc.regexTitle')}
        >
          {tr('proc.selectMatched')} ({matchedPids.size})
        </button>
        <div className="view-switch">
          <button
            className={view === 'flat' ? 'primary' : 'ghost'}
            onClick={() => setView('flat')}
          >
            {tr('proc.view.flat')}
          </button>
          <button
            className={view === 'grouped' ? 'primary' : 'ghost'}
            onClick={() => setView('grouped')}
          >
            {tr('proc.view.group')}
          </button>
          <button
            className={view === 'tree' ? 'primary' : 'ghost'}
            onClick={() => setView('tree')}
          >
            {tr('proc.view.tree')}
          </button>
        </div>
        <button onClick={refresh} disabled={loading}>
          {loading ? tr('common.refreshing') : tr('common.refresh')}
        </button>
        <select
          value={interval}
          onChange={(e) => setIntervalKey(e.target.value as RefreshInterval)}
          title={tr('common.auto')}
        >
          <option value="off">{tr('proc.autoOff')}</option>
          <option value="5s">{tr('proc.auto5s')}</option>
          <option value="10s">{tr('proc.auto10s')}</option>
          <option value="30s">{tr('proc.auto30s')}</option>
        </select>
        <button
          className={selected.size > 0 ? 'danger' : 'ghost'}
          onClick={killSelected}
          disabled={selected.size === 0}
        >
          {tr('proc.killSelected')} ({selected.size})
        </button>
        {selected.size > 0 && (
          <button className="ghost" onClick={clearSelection}>
            {tr('common.clear')}
          </button>
        )}
        <div className="spacer" />
        <span className="badge">{filtered.length} {tr('proc.entries')}</span>
        {backend && <span className="badge" title={tr('proc.backend')}>{backend}</span>}
        {capturedAt && (
          <span className="badge" title={new Date(capturedAt).toISOString()}>
            {new Date(capturedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="toolbar subtle">
        <span className="hint">
          {tr('proc.memHintIntro')} <strong>RSS</strong> — {tr('proc.rssHint')} ·{' '}
          <strong>Private</strong> — {tr('proc.privateHint')} ·{' '}
          <strong>Virtual</strong> — {tr('proc.virtualHint')}.{' '}
          {tr('proc.memHintTail')}
        </span>
      </div>

      {loading && rows.length > 0 && (
        <div className="proc-progress" role="progressbar" aria-label="Refreshing processes">
          <div className="proc-progress-bar" />
        </div>
      )}
      {warning && <div className="banner">{warning}</div>}
      {error && <div className="banner">{error}</div>}

      <div className="content">
        {loading && rows.length === 0 ? (
          <div className="proc-loading">
            <div className="spinner" aria-hidden="true" />
            <div className="proc-loading-text">
              <strong>{tr('proc.loading.title')}</strong>
              <span className="hint">
                {tr('proc.loading.hint')}
              </span>
            </div>
            <table className="table proc-table proc-skeleton" aria-hidden="true">
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={12}>
                      <div className="skeleton-row" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : filtered.length === 0 && !loading ? (
          <div className="empty">{tr('proc.empty')}</div>
        ) : view === 'flat' ? (
          <table className="table proc-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleSelectAll}
                    title={allChecked ? 'Deselect all visible' : 'Select all visible'}
                  />
                </th>
                <th onClick={() => toggleSort('pid')}>{tr('proc.col.pid')}</th>
                <th onClick={() => toggleSort('name')}>{tr('proc.col.name')}</th>
                <th onClick={() => toggleSort('user')}>{tr('proc.col.user')}</th>
                <th
                  onClick={() => toggleSort('cpuPercent')}
                  title="Average CPU% since the process started. >100% means multi-core load."
                >
                  {tr('proc.col.cpu')}
                </th>
                <th
                  onClick={() => toggleSort('rssBytes')}
                  title={tr('proc.rssHint')}
                >
                  {tr('proc.col.rss')}
                </th>
                <th
                  onClick={() => toggleSort('privateBytes')}
                  title={tr('proc.privateHint')}
                >
                  {tr('proc.col.private')}
                </th>
                <th
                  onClick={() => toggleSort('virtualBytes')}
                  title={tr('proc.virtualHint')}
                >
                  {tr('proc.col.virtual')}
                </th>
                <th onClick={() => toggleSort('threadCount')} title="Threads">
                  {tr('proc.col.thr')}
                </th>
                <th onClick={() => toggleSort('uptimeSeconds')}>{tr('proc.col.uptime')}</th>
                <th>{tr('proc.col.path')}</th>
                <th style={{ width: 130 }}>{tr('proc.col.action')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isMatch = matchedPids.has(r.pid);
                const isSel = selected.has(r.pid);
                const cls = [
                  isMatch ? 'proc-match' : '',
                  isSel ? 'selected' : ''
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr key={r.pid} className={cls || undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleSelect(r.pid)}
                      />
                    </td>
                    <td className="mono">{r.pid}</td>
                    <td title={r.commandLine || r.name}>{r.name}</td>
                    <td>{r.user || '—'}</td>
                    <td className="mono">{r.cpuPercent.toFixed(1)}</td>
                    <td className="mono" title={`${r.rssBytes} bytes`}>
                      {formatBytes(r.rssBytes)}
                    </td>
                    <td className="mono" title={`${r.privateBytes} bytes`}>
                      {formatBytes(r.privateBytes)}
                    </td>
                    <td className="mono" title={`${r.virtualBytes} bytes`}>
                      {formatBytes(r.virtualBytes)}
                    </td>
                    <td className="mono">
                      {r.threadCount >= 0 ? r.threadCount : '—'}
                    </td>
                    <td className="mono">
                      {r.uptimeSeconds >= 0
                        ? formatDuration(r.uptimeSeconds)
                        : '—'}
                    </td>
                    <td className="mono" title={r.path}>
                      {r.path ? truncatePath(r.path) : '—'}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="ghost"
                          disabled={!r.path}
                          title={tr('startup.openTitle')}
                          onClick={() =>
                            r.path && window.closedport.revealInFolder(r.path)
                          }
                        >
                          {tr('common.open')}
                        </button>
                        <button className="danger" onClick={() => killOne(r.pid)}>
                          {tr('common.kill')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : view === 'grouped' ? (
          <div className="group-list">
            {grouped.map((g) => {
              const key = `group-${g.name}`;
              const isOpen = expanded.has(key);
              const groupPids = g.items.map((i) => i.pid);
              const groupAllSel = groupPids.every((p) => selected.has(p));
              const groupSomeSel =
                !groupAllSel && groupPids.some((p) => selected.has(p));
              return (
                <div className="group" key={key}>
                  <div
                    className="group-header"
                    onClick={() => toggleExpand(key)}
                  >
                    <input
                      type="checkbox"
                      checked={groupAllSel}
                      ref={(el) => {
                        if (el) el.indeterminate = groupSomeSel;
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => togglePids(groupPids, !groupAllSel)}
                    />
                    <span className="group-toggle">{isOpen ? '−' : '+'}</span>
                    <span className="group-name">{g.name}</span>
                    <span className="badge">{g.items.length} {tr('proc.procs')}</span>
                    <span className="badge" title={tr('proc.totalRss')}>
                      {formatBytes(g.totalRss)} RSS
                    </span>
                    <span className="badge" title={tr('proc.sumCpu')}>
                      {g.totalCpu.toFixed(1)}% CPU
                    </span>
                    <div className="spacer" />
                    <button
                      className="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        killGroup(groupPids);
                      }}
                    >
                      {tr('proc.killGroup')} ({g.items.length})
                    </button>
                  </div>
                  {isOpen && (
                    <table className="table compact proc-table">
                      <thead>
                        <tr>
                          <th style={{ width: 28 }}></th>
                          <th>{tr('proc.col.pid')}</th>
                          <th>{tr('proc.col.user')}</th>
                          <th>{tr('proc.col.cpu')}</th>
                          <th>{tr('proc.col.rss')}</th>
                          <th>{tr('proc.col.private')}</th>
                          <th>{tr('proc.col.uptime')}</th>
                          <th>{tr('proc.col.path')}</th>
                          <th style={{ width: 130 }}>{tr('proc.col.action')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items
                          .slice()
                          .sort((a, b) => b.rssBytes - a.rssBytes)
                          .map((r) => {
                            const isSel = selected.has(r.pid);
                            return (
                              <tr
                                key={r.pid}
                                className={isSel ? 'selected' : undefined}
                              >
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={isSel}
                                    onChange={() => toggleSelect(r.pid)}
                                  />
                                </td>
                                <td className="mono">{r.pid}</td>
                                <td>{r.user || '—'}</td>
                                <td className="mono">
                                  {r.cpuPercent.toFixed(1)}
                                </td>
                                <td className="mono">
                                  {formatBytes(r.rssBytes)}
                                </td>
                                <td className="mono">
                                  {formatBytes(r.privateBytes)}
                                </td>
                                <td className="mono">
                                  {r.uptimeSeconds >= 0
                                    ? formatDuration(r.uptimeSeconds)
                                    : '—'}
                                </td>
                                <td className="mono" title={r.path}>
                                  {r.path ? truncatePath(r.path) : '—'}
                                </td>
                                <td>
                                  <div className="row-actions">
                                    <button
                                      className="ghost"
                                      disabled={!r.path}
                                      title={tr('startup.openTitle')}
                                      onClick={() =>
                                        r.path &&
                                        window.closedport.revealInFolder(r.path)
                                      }
                                    >
                                      {tr('common.open')}
                                    </button>
                                    <button
                                      className="danger"
                                      onClick={() => killOne(r.pid)}
                                    >
                                      {tr('common.kill')}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          // Tree view
          <>
            <div className="toolbar subtle">
              <button className="ghost" onClick={expandAllTree}>
                {tr('proc.expandAll')}
              </button>
              <button className="ghost" onClick={collapseAllTree}>
                {tr('proc.collapseAll')}
              </button>
              <span className="hint">
                {tr('proc.treeHint')}
              </span>
            </div>
            <table className="table proc-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>{tr('proc.col.namePid')}</th>
                  <th>{tr('proc.col.user')}</th>
                  <th>{tr('proc.col.cpu')}</th>
                  <th>{tr('proc.col.rss')}</th>
                  <th>{tr('proc.col.private')}</th>
                  <th>{tr('proc.col.thr')}</th>
                  <th>{tr('proc.col.uptime')}</th>
                  <th>{tr('proc.col.path')}</th>
                  <th style={{ width: 130 }}>{tr('proc.col.action')}</th>
                </tr>
              </thead>
              <tbody>
                {flattenTree(tree).map((n) => {
                  const r = n.entry;
                  const hasKids = n.children.length > 0;
                  const isOpen =
                    expanded.has('tree-all') ||
                    expanded.has(`tree-${r.pid}`);
                  const isSel = selected.has(r.pid);
                  const isMatch = matchedPids.has(r.pid);
                  const cls = [
                    isSel ? 'selected' : '',
                    isMatch ? 'proc-match' : ''
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <tr key={r.pid} className={cls || undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleSelect(r.pid)}
                        />
                      </td>
                      <td
                        style={{ paddingLeft: 6 + n.depth * 18 }}
                        title={r.commandLine || r.name}
                      >
                        {hasKids ? (
                          <button
                            className="tree-toggle"
                            onClick={() =>
                              toggleExpand(`tree-${r.pid}`)
                            }
                            aria-label={isOpen ? 'Collapse' : 'Expand'}
                          >
                            {isOpen ? '−' : '+'}
                          </button>
                        ) : (
                          <span className="tree-toggle leaf">·</span>
                        )}
                        <span className="mono">{r.name}</span>{' '}
                        <span className="tree-pid mono">({r.pid})</span>
                      </td>
                      <td>{r.user || '—'}</td>
                      <td className="mono">{r.cpuPercent.toFixed(1)}</td>
                      <td className="mono">{formatBytes(r.rssBytes)}</td>
                      <td className="mono">{formatBytes(r.privateBytes)}</td>
                      <td className="mono">
                        {r.threadCount >= 0 ? r.threadCount : '—'}
                      </td>
                      <td className="mono">
                        {r.uptimeSeconds >= 0
                          ? formatDuration(r.uptimeSeconds)
                          : '—'}
                      </td>
                      <td className="mono" title={r.path}>
                        {r.path ? truncatePath(r.path) : '—'}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="ghost"
                            disabled={!r.path}
                            title={tr('startup.openTitle')}
                            onClick={() =>
                              r.path &&
                              window.closedport.revealInFolder(r.path)
                            }
                          >
                            {tr('common.open')}
                          </button>
                          <button
                            className="danger"
                            onClick={() => killOne(r.pid)}
                          >
                            {tr('common.kill')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function truncatePath(p: string): string {
  if (p.length <= 48) return p;
  return `…${p.slice(p.length - 47)}`;
}

function formatMemSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  const gb = n / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

const MemoryBar: React.FC<{ mem: SystemMemoryInfo | null }> = ({ mem }) => {
  const tr = useT();
  if (!mem) {
    return (
      <div className="mem-bar-wrap">
        <div className="mem-bar mem-bar-loading" aria-busy="true">
          <span className="hint">{tr('mem.loading')}</span>
        </div>
      </div>
    );
  }
  const total = Math.max(mem.totalBytes, 1);
  const used = Math.max(mem.usedBytes, 0);
  const compressed = Math.max(mem.compressedBytes, 0);
  const cached = Math.max(mem.cachedBytes, 0);
  const usedCore = Math.max(used - compressed, 0);
  const free = Math.max(total - usedCore - compressed - cached, 0);
  const pct = (n: number) => `${(n / total) * 100}%`;
  const usedPercent = Math.round((used / total) * 100);
  const swapTotal = Math.max(mem.swapTotalBytes, 0);
  const swapUsed = Math.max(mem.swapUsedBytes, 0);
  const swapPct =
    swapTotal > 0 ? `${(swapUsed / swapTotal) * 100}%` : '0%';
  return (
    <div className="mem-bar-wrap">
      <div className="mem-bar">
        {usedCore > 0 && (
          <div
            className="mem-seg used"
            style={{ width: pct(usedCore) }}
            title={`${tr('mem.used')}: ${formatMemSize(usedCore)}`}
          />
        )}
        {compressed > 0 && (
          <div
            className="mem-seg compressed"
            style={{ width: pct(compressed) }}
            title={`${tr('mem.compressed')}: ${formatMemSize(compressed)}`}
          />
        )}
        {cached > 0 && (
          <div
            className="mem-seg cached"
            style={{ width: pct(cached) }}
            title={`${tr('mem.cached')}: ${formatMemSize(cached)}`}
          />
        )}
        {free > 0 && (
          <div
            className="mem-seg free"
            style={{ width: pct(free) }}
            title={`${tr('mem.free')}: ${formatMemSize(free)}`}
          />
        )}
      </div>
      {swapTotal > 0 && (
        <div className="mem-swap-row">
          <span className="mem-swap-label">{tr('mem.swap')}</span>
          <div className="mem-bar swap">
            <div
              className="mem-seg swap-used"
              style={{ width: swapPct }}
              title={`${tr('mem.swap')}: ${formatMemSize(swapUsed)} / ${formatMemSize(swapTotal)}`}
            />
          </div>
        </div>
      )}
      <div className="mem-stats">
        <span>
          {tr('mem.total')}: {formatMemSize(mem.totalBytes)}
        </span>
        <span className="sep">·</span>
        <span>
          {tr('mem.used')}: {formatMemSize(used)} ({usedPercent}%)
        </span>
        <span className="sep">·</span>
        <span>
          {tr('mem.available')}: {formatMemSize(mem.availableBytes)}
        </span>
        {compressed > 0 && (
          <>
            <span className="sep">·</span>
            <span>
              {tr('mem.compressed')}: {formatMemSize(compressed)}
            </span>
          </>
        )}
        <span className="sep">·</span>
        <span>
          {tr('mem.cached')}: {formatMemSize(cached)}
        </span>
        {swapTotal > 0 && (
          <>
            <span className="sep">·</span>
            <span>
              {tr('mem.swap')}: {formatMemSize(swapUsed)} / {formatMemSize(swapTotal)}
            </span>
          </>
        )}
        {mem.warning && (
          <>
            <span className="sep">·</span>
            <span className="mem-warning" title={mem.warning}>
              !
            </span>
          </>
        )}
      </div>
    </div>
  );
};

// ---------------- Startups Tab (Windows) ----------------

const STARTUP_SOURCES: Array<StartupSource | 'all'> = [
  'all',
  'registry',
  'folder',
  'task',
  'service',
  'browser'
];

const StartupView: React.FC<{ systemInfo: SystemInfo | null }> = ({
  systemInfo
}) => {
  const t = useT();
  const [rows, setRows] = useState<StartupEntry[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [source, setSource] = useState<StartupSource | 'all'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const isWin = systemInfo?.platform === 'win32';
  const isAdmin = !!systemInfo?.isAdmin;

  const refresh = useCallback(async () => {
    if (!isWin) return;
    setLoading(true);
    try {
      const res = await window.closedport.listStartups();
      setRows(res.entries || []);
      setWarnings(res.warnings || []);
    } catch (e) {
      setWarnings([(e as Error).message || String(e)]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isWin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (source !== 'all' && r.source !== source) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q) ||
        r.command.toLowerCase().includes(q) ||
        (r.publisher || '').toLowerCase().includes(q) ||
        r.source.includes(q)
      );
    });
  }, [rows, filter, source]);

  const sourceLabel = (s: StartupSource | 'all') =>
    t(`startup.source.${s}`);

  const canMutate = (r: StartupEntry) => {
    if (r.protected) return false;
    if (r.needsAdmin && !isAdmin) return false;
    return true;
  };

  const onToggle = async (r: StartupEntry) => {
    if (!canMutate(r)) {
      alert(
        r.protected
          ? t('startup.protected')
          : t('startup.needsAdmin')
      );
      return;
    }
    setBusyId(r.id);
    try {
      const res = await window.closedport.setStartupEnabled(r.id, !r.enabled);
      if (!res.success) {
        alert(`${t('startup.toggleFailed')} ${res.message || ''}`);
      } else {
        await refresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const onEdit = async (r: StartupEntry) => {
    if (!r.canEdit || !canMutate(r)) return;
    const next = window.prompt(t('startup.editPrompt'), r.command);
    if (next == null) return;
    if (next === r.command) return;
    setBusyId(r.id);
    try {
      const res = await window.closedport.updateStartup(r.id, next);
      if (!res.success) {
        alert(`${t('startup.updateFailed')} ${res.message || ''}`);
      } else {
        await refresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (r: StartupEntry) => {
    if (!r.canDelete || !canMutate(r)) return;
    const msg = t('startup.deleteConfirm').replace('{name}', r.name);
    if (!window.confirm(msg)) return;
    setBusyId(r.id);
    try {
      const res = await window.closedport.deleteStartup(r.id);
      if (!res.success) {
        alert(`${t('startup.deleteFailed')} ${res.message || ''}`);
      } else {
        if (r.source === 'browser' && res.message) {
          alert(t('startup.browserRestartHint'));
        }
        await refresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  if (!isWin) {
    return <div className="empty">{t('startup.winOnly')}</div>;
  }

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          placeholder={t('startup.filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 360 }}
        />
        <div className="view-switch">
          {STARTUP_SOURCES.map((s) => (
            <button
              key={s}
              className={source === s ? 'primary' : 'ghost'}
              onClick={() => setSource(s)}
            >
              {sourceLabel(s)}
            </button>
          ))}
        </div>
        <button onClick={refresh} disabled={loading}>
          {loading ? t('common.refreshing') : t('common.refresh')}
        </button>
        <div className="spacer" />
        <span className="badge">
          {filtered.length} {t('startup.entries')}
        </span>
        {!isAdmin && (
          <span className="badge warn" title={t('startup.needsAdmin')}>
            {t('common.standard')}
          </span>
        )}
      </div>
      {warnings.length > 0 && (
        <div className="banner warn">
          {warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}
      <div className="content">
        {loading && rows.length === 0 ? (
          <div className="empty">{t('startup.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="empty">{t('startup.empty')}</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 52 }}>{t('startup.col.enabled')}</th>
                <th>{t('startup.col.name')}</th>
                <th style={{ width: 110 }}>{t('startup.col.source')}</th>
                <th>{t('startup.col.location')}</th>
                <th>{t('startup.col.command')}</th>
                <th style={{ width: 120 }}>{t('startup.col.publisher')}</th>
                <th style={{ width: 200 }}>{t('startup.col.action')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const mutateOk = canMutate(r);
                const busy = busyId === r.id;
                return (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={busy || !mutateOk}
                        title={
                          r.protected
                            ? t('startup.protected')
                            : r.needsAdmin && !isAdmin
                              ? t('startup.needsAdmin')
                              : r.enabled
                                ? t('common.enable')
                                : t('common.disable')
                        }
                        onChange={() => onToggle(r)}
                      />
                    </td>
                    <td title={r.name}>
                      {r.name}
                      {r.protected ? (
                        <span className="badge warn" style={{ marginLeft: 6 }}>
                          !
                        </span>
                      ) : null}
                    </td>
                    <td>{sourceLabel(r.source)}</td>
                    <td className="mono" title={r.location}>
                      {truncatePath(r.location)}
                    </td>
                    <td className="mono" title={r.command}>
                      {truncatePath(r.command)}
                    </td>
                    <td title={r.publisher}>{r.publisher || '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="ghost"
                          disabled={!r.revealPath || busy}
                          title={t('startup.openTitle')}
                          onClick={() =>
                            r.revealPath &&
                            window.closedport.revealInFolder(r.revealPath)
                          }
                        >
                          {t('common.open')}
                        </button>
                        <button
                          className="ghost"
                          disabled={!r.canEdit || !mutateOk || busy}
                          onClick={() => onEdit(r)}
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          className="danger"
                          disabled={!r.canDelete || !mutateOk || busy}
                          onClick={() => onDelete(r)}
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

interface TerminalSessionView { id: string; title: string; exited?: boolean; }

const TerminalView: React.FC<{ session: TerminalSessionView; active: boolean }> = ({ session, active }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 13,
      theme: { background: '#0f1115', foreground: '#e6e9ef', cursor: '#4f8cff' },
      scrollback: 5000
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const copyShortcut = event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'c';
      if (copyShortcut && terminal.hasSelection()) {
        window.closedport.writeClipboardText(terminal.getSelection());
        terminal.clearSelection();
        return false;
      }
      // Ctrl+Shift+C is copy-only: never forward it as terminal input.
      if (copyShortcut && event.shiftKey) return false;
      return true;
    });
    terminalRef.current = terminal;
    fitRef.current = fit;
    const input = terminal.onData((data) => window.closedport.writeTerminal(session.id, data));
    const removeData = window.closedport.onTerminalData((id, data) => {
      if (id === session.id) terminal.write(data);
    });
    const removeExit = window.closedport.onTerminalExit((id, code) => {
      if (id === session.id) terminal.writeln(`\r\n[PowerShell exited: ${code}]`);
    });
    const resize = () => {
      if (!containerRef.current?.offsetParent) return;
      try {
        fit.fit();
        window.closedport.resizeTerminal(session.id, terminal.cols, terminal.rows);
      } catch { /* panel may be transitioning */ }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);
    requestAnimationFrame(() => { resize(); window.closedport.writeTerminal(session.id, '\r'); });
    return () => {
      observer.disconnect(); input.dispose(); removeData(); removeExit(); terminal.dispose();
      window.closedport.closeTerminal(session.id);
    };
  }, [session.id]);

  useEffect(() => {
    if (active) requestAnimationFrame(() => {
      try { fitRef.current?.fit(); terminalRef.current?.focus(); } catch { /* hidden */ }
    });
  }, [active]);

  return <div ref={containerRef} className="terminal-screen" style={{ display: active ? 'block' : 'none' }} />;
};

const TerminalPanel: React.FC<{ visible: boolean; onHide: () => void }> = ({ visible, onHide }) => {
  const t = useT();
  const [sessions, setSessions] = useState<TerminalSessionView[]>([]);
  const [activeId, setActiveId] = useState('');
  const sequence = useRef(0);
  const adding = useRef(false);

  const addSession = useCallback(async () => {
    if (adding.current) return;
    adding.current = true;
    try {
      const id = await window.closedport.createTerminal();
      const session = { id, title: `PowerShell ${++sequence.current}` };
      setSessions((current) => [...current, session]);
      setActiveId(id);
    } finally { adding.current = false; }
  }, []);

  useEffect(() => {
    if (visible && sessions.length === 0) void addSession();
  }, [visible, sessions.length, addSession]);

  const closeSession = (id: string) => {
    setSessions((current) => {
      const index = current.findIndex((item) => item.id === id);
      const next = current.filter((item) => item.id !== id);
      if (activeId === id) setActiveId(next[Math.min(index, next.length - 1)]?.id || '');
      return next;
    });
  };

  return <section className="terminal-panel" style={{ display: visible ? 'flex' : 'none' }}>
    <div className="terminal-tabs">
      <span className="terminal-panel-title">{t('terminal.title')}</span>
      {sessions.map((session) => <button key={session.id} className={activeId === session.id ? 'terminal-tab active' : 'terminal-tab'} onClick={() => setActiveId(session.id)}>
        {session.title}<span className="terminal-tab-close" onClick={(event) => { event.stopPropagation(); closeSession(session.id); }}>×</span>
      </button>)}
      <button className="ghost terminal-add" title={t('terminal.new')} onClick={() => void addSession()}>＋</button>
      <div className="spacer" />
      <button className="ghost" title={t('terminal.hide')} onClick={onHide}>⌄</button>
    </div>
    <div className="terminal-body">
      {sessions.map((session) => <TerminalView key={session.id} session={session} active={session.id === activeId} />)}
    </div>
  </section>;
};

const EMPTY_HOST = { address: '', hostnames: '', comment: '', enabled: true };

const HostsView: React.FC<{ systemInfo: SystemInfo | null }> = ({ systemInfo }) => {
  const t = useT();
  const [rows, setRows] = useState<HostEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [hostsPath, setHostsPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState(EMPTY_HOST);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await window.closedport.listHosts();
      setRows(result.entries); setHostsPath(result.path);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return !q ? rows : rows.filter((r) =>
      r.address.toLowerCase().includes(q) || r.hostnames.some((h) => h.toLowerCase().includes(q)) || r.comment.toLowerCase().includes(q));
  }, [rows, filter]);

  const openForm = (row?: HostEntry) => {
    setEditingId(row ? row.id : null);
    setForm(row ? { address: row.address, hostnames: row.hostnames.join(' '), comment: row.comment, enabled: row.enabled } : EMPTY_HOST);
  };
  const save = async () => {
    const result = await window.closedport.saveHost(editingId ?? null, {
      address: form.address,
      hostnames: form.hostnames.trim().split(/[\s,]+/).filter(Boolean),
      comment: form.comment,
      enabled: form.enabled
    });
    if (!result.success) { setError(result.message || t('hosts.saveFailed')); return; }
    setEditingId(undefined); await refresh();
  };
  const toggle = async (row: HostEntry) => {
    const result = await window.closedport.saveHost(row.id, { ...row, enabled: !row.enabled });
    if (!result.success) setError(result.message || t('hosts.saveFailed')); else await refresh();
  };
  const saveBulk = async () => {
    const inputs = [];
    const sourceLines = bulkText.split(/\r?\n/);
    for (let index = 0; index < sourceLines.length; index++) {
      let line = sourceLines[index].trim();
      if (!line || (line.startsWith('#') && !line.startsWith('# closedport-disabled '))) continue;
      let enabled = true;
      if (line.startsWith('# closedport-disabled ')) {
        enabled = false;
        line = line.slice('# closedport-disabled '.length).trim();
      }
      const commentAt = line.indexOf('#');
      const comment = commentAt >= 0 ? line.slice(commentAt + 1).trim() : '';
      const columns = (commentAt >= 0 ? line.slice(0, commentAt) : line).trim().split(/\s+/);
      if (columns.length < 2) {
        setError(t('hosts.bulkLineError').replace('{line}', String(index + 1)));
        return;
      }
      inputs.push({ address: columns[0], hostnames: columns.slice(1), comment, enabled });
    }
    if (inputs.length === 0) { setError(t('hosts.bulkEmpty')); return; }
    const result = await window.closedport.saveHosts(inputs);
    if (!result.success) { setError(result.message || t('hosts.saveFailed')); return; }
    setBulkText(''); setBulkOpen(false); await refresh();
  };
  const remove = async (row: HostEntry) => {
    if (!confirm(t('hosts.deleteConfirm').replace('{host}', row.hostnames.join(' ')))) return;
    const result = await window.closedport.deleteHost(row.id);
    if (!result.success) setError(result.message || t('hosts.deleteFailed')); else await refresh();
  };

  return <>
    <div className="toolbar">
      <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('hosts.filter')} style={{ maxWidth: 360 }} />
      <button className="primary" onClick={() => openForm()}>{t('hosts.add')}</button>
      <button onClick={() => { setBulkOpen(true); setEditingId(undefined); }}>{t('hosts.bulkAdd')}</button>
      <button onClick={refresh} disabled={loading}>{loading ? t('common.refreshing') : t('common.refresh')}</button>
      <div className="spacer" />
      <span className="badge" title={hostsPath}>{filtered.length} {t('hosts.entries')}</span>
      {!systemInfo?.isAdmin && <span className="badge warn" title={t('hosts.adminHint')}>{t('common.standard')}</span>}
    </div>
    {error && <div className="banner warn">{error}<button className="ghost" onClick={() => setError('')}>×</button></div>}
    {editingId !== undefined && <div className="host-editor">
      <strong>{editingId === null ? t('hosts.addTitle') : t('hosts.editTitle')}</strong>
      <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={t('hosts.addressPlaceholder')} />
      <input type="text" value={form.hostnames} onChange={(e) => setForm({ ...form, hostnames: e.target.value })} placeholder={t('hosts.namesPlaceholder')} />
      <input type="text" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder={t('hosts.commentPlaceholder')} />
      <label><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> {t('common.enable')}</label>
      <button className="primary" onClick={save}>{t('common.apply')}</button>
      <button onClick={() => setEditingId(undefined)}>{t('common.cancel')}</button>
    </div>}
    {bulkOpen && <div className="host-bulk-editor">
      <div className="host-bulk-heading">
        <strong>{t('hosts.bulkTitle')}</strong>
        <span>{t('hosts.bulkHint')}</span>
      </div>
      <textarea autoFocus value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={'127.0.0.1 example.local\n192.168.1.10 api.local api # development'} />
      <div className="host-bulk-actions">
        <span>{bulkText.split(/\r?\n/).filter((line) => line.trim() && !/^\s*#(?! closedport-disabled )/.test(line)).length} {t('hosts.bulkLines')}</span>
        <div className="spacer" />
        <button className="primary" onClick={() => void saveBulk()}>{t('hosts.bulkImport')}</button>
        <button onClick={() => setBulkOpen(false)}>{t('common.cancel')}</button>
      </div>
    </div>}
    <div className="content">
      {loading && !rows.length ? <div className="empty">{t('common.loading')}…</div> : !filtered.length ? <div className="empty">{t('hosts.empty')}</div> :
      <table className="table"><thead><tr><th style={{width: 65}}>{t('hosts.col.enabled')}</th><th style={{width: 180}}>{t('hosts.col.address')}</th><th>{t('hosts.col.names')}</th><th>{t('hosts.col.comment')}</th><th style={{width: 170}}>{t('hosts.col.action')}</th></tr></thead>
      <tbody>{filtered.map((row) => <tr key={row.id} className={!row.enabled ? 'host-disabled' : ''}>
        <td><input type="checkbox" checked={row.enabled} onChange={() => void toggle(row)} /></td>
        <td className="mono">{row.address}</td><td className="mono" title={row.hostnames.join(' ')}>{row.hostnames.join(' ')}</td><td title={row.comment}>{row.comment || '—'}</td>
        <td><div className="row-actions"><button className="ghost" onClick={() => openForm(row)}>{t('common.edit')}</button><button className="danger" onClick={() => void remove(row)}>{t('common.delete')}</button></div></td>
      </tr>)}</tbody></table>}
    </div>
  </>;
};

const ScriptsView: React.FC = () => {
  const t = useT();
  const [scripts, setScripts] = useState<ScriptCommand[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ id: string | null; name: string; command: string } | null>(null);
  const [running, setRunning] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<Record<string, ScriptStreamEvent[]>>({});
  const [executionNames, setExecutionNames] = useState<Record<string, string>>({});
  const [selectedExecution, setSelectedExecution] = useState('');
  const finishedExecutions = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setScripts(await window.closedport.listScripts()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => window.closedport.onScriptEvent((event) => {
    setLogs((current) => ({
      ...current,
      [event.executionId]: [...(current[event.executionId] || []), event].slice(-1000)
    }));
    if (event.type === 'exit' || event.type === 'error') {
      finishedExecutions.current.add(event.executionId);
      setRunning((current) => {
        const next = { ...current };
        if (next[event.scriptId] === event.executionId) delete next[event.scriptId];
        return next;
      });
    }
  }), []);

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? scripts.filter((item) => item.name.toLowerCase().includes(query) || item.command.toLowerCase().includes(query)) : scripts;
  }, [scripts, filter]);

  const save = async () => {
    if (!form) return;
    const result = await window.closedport.saveScript(form.id, form.name, form.command);
    if (!result.success) { setError(result.message || t('scripts.saveFailed')); return; }
    setForm(null); await refresh();
  };
  const remove = async (script: ScriptCommand) => {
    if (!confirm(t('scripts.deleteConfirm').replace('{name}', script.name))) return;
    const result = await window.closedport.deleteScript(script.id);
    if (!result.success) setError(result.message || t('scripts.deleteFailed')); else await refresh();
  };
  const execute = async (script: ScriptCommand) => {
    setError('');
    const result = await window.closedport.executeScript(script.id);
    if (!result.success || !result.executionId) { setError(result.message || t('scripts.executeFailed')); return; }
    const executionId = result.executionId;
    if (!finishedExecutions.current.has(executionId)) {
      setRunning((current) => ({ ...current, [script.id]: executionId }));
    }
    setExecutionNames((current) => ({ ...current, [executionId]: script.name }));
    setLogs((current) => ({ ...current, [executionId]: current[executionId] || [] }));
    setSelectedExecution(executionId);
  };
  const stop = (scriptId: string) => {
    const executionId = running[scriptId];
    if (executionId) window.closedport.stopScript(executionId);
  };
  const events = logs[selectedExecution] || [];

  return <div className="scripts-view">
    <div className="toolbar">
      <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('scripts.filter')} style={{ maxWidth: 360 }} />
      <button className="primary" onClick={() => setForm({ id: null, name: '', command: '' })}>{t('scripts.add')}</button>
      <button onClick={() => void refresh()} disabled={loading}>{loading ? t('common.refreshing') : t('common.refresh')}</button>
      <div className="spacer" /><span className="badge">{filtered.length} {t('scripts.entries')}</span>
    </div>
    {error && <div className="banner warn">{error}<button className="ghost" onClick={() => setError('')}>×</button></div>}
    {form && <div className="script-editor">
      <strong>{form.id ? t('scripts.editTitle') : t('scripts.addTitle')}</strong>
      <input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={t('scripts.namePlaceholder')} />
      <textarea value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} placeholder={t('scripts.commandPlaceholder')} />
      <div className="script-editor-actions"><div className="spacer" /><button className="primary" onClick={() => void save()}>{t('common.apply')}</button><button onClick={() => setForm(null)}>{t('common.cancel')}</button></div>
    </div>}
    <div className="scripts-layout">
      <div className="scripts-list content">
        {!filtered.length ? <div className="empty">{t('scripts.empty')}</div> : <table className="table"><thead><tr>
          <th>{t('scripts.col.name')}</th><th>{t('scripts.col.command')}</th><th style={{ width: 230 }}>{t('scripts.col.action')}</th>
        </tr></thead><tbody>{filtered.map((script) => {
          const executionId = running[script.id];
          return <tr key={script.id}>
            <td>{script.name}</td><td className="mono" title={script.command}>{script.command}</td>
            <td><div className="row-actions">
              {executionId ? <button className="danger" onClick={() => stop(script.id)}>{t('scripts.stop')}</button> : <button className="primary" onClick={() => void execute(script)}>{t('scripts.execute')}</button>}
              <button className="ghost" onClick={() => setForm({ id: script.id, name: script.name, command: script.command })}>{t('common.edit')}</button>
              <button className="danger" disabled={!!executionId} onClick={() => void remove(script)}>{t('common.delete')}</button>
            </div></td>
          </tr>;
        })}</tbody></table>}
      </div>
      <section className="script-output">
        <div className="script-output-header">
          <strong>{t('scripts.output')}</strong>
          <select value={selectedExecution} onChange={(event) => setSelectedExecution(event.target.value)}>
            <option value="">{t('scripts.selectRun')}</option>
            {Object.keys(logs).reverse().map((id) => <option key={id} value={id}>{executionNames[id] || id.slice(0, 8)}</option>)}
          </select>
          <div className="spacer" />
          <button className="ghost" disabled={!selectedExecution} onClick={() => selectedExecution && setLogs((current) => ({ ...current, [selectedExecution]: [] }))}>{t('common.clear')}</button>
        </div>
        <div className="script-output-log">
          {!selectedExecution ? <div className="empty">{t('scripts.noOutput')}</div> : events.map((event, index) => <div key={`${event.timestamp}-${index}`} className={`script-event ${event.type}`}>
            <span className="script-event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
            <span className="script-event-type">{event.type === 'sse' ? `SSE:${event.event || 'message'}` : event.type}</span>
            <pre>{event.type === 'exit' ? `${t('scripts.exitCode')}: ${event.exitCode}` : event.data}</pre>
          </div>)}
        </div>
      </section>
    </div>
  </div>;
};

export default App;
