import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import type {
  PortEntry,
  ProcessEntry,
  SystemMemoryInfo
} from '../../shared/types';
import {
  LanguageContext,
  LanguageProvider,
  useT
} from './i18n';

type FloatingTab = 'ports' | 'procs';

const TOP_PROCS = 8;

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  // Keep one decimal for sub-100 values, none above so the line stays short
  // in the narrow mini-panel.
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

const FloatingPanel: React.FC = () => {
  const t = useT();
  const { lang, setLang } = React.useContext(LanguageContext);
  const [tab, setTab] = useState<FloatingTab>('ports');
  const [rows, setRows] = useState<PortEntry[]>([]);
  const [procs, setProcs] = useState<ProcessEntry[]>([]);
  const [memory, setMemory] = useState<SystemMemoryInfo | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Track mount state + in-flight refreshes so 5s auto-refresh ticks that
  // arrive while a slow query is still running don't pile up (Windows on
  // low-end machines can take >5s for the netstat + tasklist + powershell
  // pipeline). Also guards against StrictMode's mount/unmount/mount cycle
  // calling setState after unmount.
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      // Fan out the three IPC calls in parallel: ports, processes, and
      // system memory. Each backend snapshot is independent. We tolerate
      // individual failures so a single slow path (e.g. `ps` on a
      // pressured machine) doesn't blank out the panel.
      const [portsRes, procsRes, memRes] = await Promise.allSettled([
        window.closedport.listPorts(),
        window.closedport.listProcesses(),
        window.closedport.getSystemMemory()
      ]);
      if (!mountedRef.current) return;
      if (portsRes.status === 'fulfilled') setRows(portsRes.value);
      if (procsRes.status === 'fulfilled') setProcs(procsRes.value.entries);
      if (memRes.status === 'fulfilled') setMemory(memRes.value);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    // Use a self-rescheduling timer instead of setInterval so we always
    // wait for the previous refresh to settle before queuing the next.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      timer = setTimeout(tick, 5000);
    };
    timer = setTimeout(tick, 5000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [autoRefresh, refresh]);

  const filteredPorts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter(
        (r) =>
          String(r.localPort).includes(q) ||
          (r.processName || '').toLowerCase().includes(q) ||
          String(r.pid).includes(q)
      );
    }
    return [...list].sort((a, b) => a.localPort - b.localPort);
  }, [rows, filter]);

  // Top-N processes by RSS so the user immediately sees the biggest memory
  // consumers without paging. Filter still applies (by pid / name / user)
  // so a quick "chrome" filter narrows both views consistently.
  const filteredProcs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = procs;
    if (q) {
      list = list.filter(
        (r) =>
          String(r.pid).includes(q) ||
          r.name.toLowerCase().includes(q) ||
          (r.user || '').toLowerCase().includes(q)
      );
    }
    return [...list]
      .sort((a, b) => b.rssBytes - a.rssBytes)
      .slice(0, TOP_PROCS);
  }, [procs, filter]);

  const killOne = async (pid: number) => {
    if (!confirm(t('proc.killOneConfirm').replace('{pid}', String(pid)))) return;
    const res = await window.closedport.killProcess(pid, true);
    if (!res.success) alert(`${t('ports.failed')} ${res.message}`);
    await refresh();
  };

  const memSummary = useMemo(() => {
    if (!memory || memory.totalBytes <= 0) return '';
    const pct = Math.round((memory.usedBytes / memory.totalBytes) * 100);
    return `${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)} (${pct}%)`;
  }, [memory]);

  return (
    <div className="floating" role="region" aria-label="ClosedPort floating panel">
      <div className="floating-header">
        ClosedPort
        <div className="lang-switch floating-lang" role="group" aria-label="Language">
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
        <div className="actions">
          <button
            className="ghost"
            title="Auto refresh (5s)"
            aria-pressed={autoRefresh}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            {autoRefresh ? t('floating.pause') : t('floating.resume')}
          </button>
          <button
            className="ghost"
            onClick={refresh}
            title={t('floating.refresh')}
            aria-busy={loading}
            disabled={loading}
          >
            {loading ? '…' : t('floating.refresh')}
          </button>
          <button
            className="ghost"
            onClick={() => window.closedport.toggleFloating()}
            title={t('floating.hide')}
          >
            {t('floating.hide')}
          </button>
        </div>
      </div>

      {/* Tab bar: switches the list section between Ports and Top Processes.
          Both share the same filter input below so a single keyword like
          "node" narrows ports AND processes at once. */}
      <div className="floating-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'ports'}
          className={tab === 'ports' ? 'active' : ''}
          onClick={() => setTab('ports')}
        >
          {t('floating.tab.ports')}
          <span className="floating-tab-count">{filteredPorts.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'procs'}
          className={tab === 'procs' ? 'active' : ''}
          onClick={() => setTab('procs')}
          title={t('floating.procs.sub')
            .replace('{n}', String(procs.length))
            .replace('{mem}', memSummary || '—')}
        >
          {t('floating.tab.procs')}
          <span className="floating-tab-count">{TOP_PROCS}</span>
        </button>
      </div>

      <div className="floating-search">
        <input
          type="search"
          placeholder={t('floating.placeholder')}
          aria-label="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* Processes tab also exposes a tiny memory summary line so the user
          gets the "is this machine pressured?" answer at a glance. */}
      {tab === 'procs' && memSummary && (
        <div className="floating-procs-sub" title={memSummary}>
          {t('floating.procs.sub')
            .replace('{n}', String(procs.length))
            .replace('{mem}', memSummary)}
        </div>
      )}

      <div className="floating-list" role="list">
        {tab === 'ports' ? (
          filteredPorts.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>
              {loading ? t('floating.loading') : t('floating.empty')}
            </div>
          ) : (
            filteredPorts.map((r) => (
              <div
                className="floating-item"
                role="listitem"
                key={`${r.protocol}-${r.localAddress}-${r.localPort}-${r.pid}`}
              >
                <div className="info">
                  <div className="top">
                    <span className="badge">{r.protocol}</span>
                    <span className="name">:{r.localPort}</span>
                  </div>
                  <div className="sub" title={r.processPath}>
                    {r.processName || '—'} · pid {r.pid}
                    {r.parentName ? ` · by ${r.parentName}` : ''}
                  </div>
                </div>
                <button
                  className="danger"
                  onClick={() => killOne(r.pid)}
                  aria-label={`Kill ${r.processName || 'process'} pid ${r.pid} on port ${r.localPort}`}
                >
                  {t('common.kill')}
                </button>
              </div>
            ))
          )
        ) : filteredProcs.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            {loading ? t('floating.loading') : t('floating.procs.empty')}
          </div>
        ) : (
          filteredProcs.map((p) => (
            <div
              className="floating-item"
              role="listitem"
              key={`proc-${p.pid}`}
            >
              <div className="info">
                <div className="top">
                  <span className="badge">{formatBytes(p.rssBytes)}</span>
                  <span className="name" title={p.path}>
                    {p.name || '—'}
                  </span>
                </div>
                <div className="sub" title={p.path}>
                  pid {p.pid}
                  {p.user ? ` · ${p.user}` : ''}
                  {Number.isFinite(p.cpuPercent) && p.cpuPercent > 0
                    ? ` · CPU ${p.cpuPercent.toFixed(1)}%`
                    : ''}
                </div>
              </div>
              <button
                className="danger"
                onClick={() => killOne(p.pid)}
                aria-label={`Kill ${p.name || 'process'} pid ${p.pid}`}
              >
                {t('common.kill')}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <FloatingPanel />
    </LanguageProvider>
  </React.StrictMode>
);
