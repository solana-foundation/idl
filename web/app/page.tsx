'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';

type SearchMode = 'current' | 'latest' | 'history';

type Cluster = 'mainnet-beta' | 'devnet';

const CLUSTERS: { id: Cluster; label: string }[] = [
  { id: 'mainnet-beta', label: 'mainnet' },
  { id: 'devnet', label: 'devnet' },
];

type IdlVersion = {
  type: 'pmp' | 'anchor';
  version: string | null;
  slot: string;
  time: string | null;
  activeFrom: { slot: string; time: string | null };
  activeTo: { slot: string; time: string | null } | 'current';
  content: string;
};

type HistoryResponse = {
  programId: string;
  pmpAddress: string;
  anchorAddress: string;
  pmp: IdlVersion[];
  anchor: IdlVersion[];
  error?: string;
};

type CurrentIdlResponse = {
  programId: string;
  type: 'pmp' | 'anchor';
  idl: unknown;
};

type LatestSnapshot = {
  type: 'pmp' | 'anchor';
  version: string | null;
  slot: string | null;
  time: string | null;
  activeFrom: { slot: string; time: string | null } | null;
  activeTo: 'current';
  content: string;
};

type LatestResponse = {
  programId: string;
  pmpAddress: string;
  anchorAddress: string;
  pmp: LatestSnapshot[];
  anchor: LatestSnapshot[];
};

function downloadJson(content: string, filename: string) {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    formatted = content;
  }
  const blob = new Blob([formatted], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadUnknownIdl(idl: unknown, filename: string) {
  const text =
    typeof idl === 'string' ? idl : JSON.stringify(idl, null, 2);
  downloadJson(text, filename);
}

function CopyableAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable (insecure origin, denied perms). The
      // address is still rendered in full so the user can mouse-select instead.
    }
  }, [address]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Click to copy'}
      aria-label={`Copy address ${address}`}
      className={`text-xs font-mono px-2 py-0.5 rounded transition-colors cursor-pointer break-all text-left ${
        copied
          ? 'text-emerald-300 bg-emerald-950/50'
          : 'text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800'
      }`}
    >
      {address}
      {copied && <span className="ml-1.5 text-emerald-400">✓</span>}
    </button>
  );
}

function ActiveRange({ v }: { v: IdlVersion }) {
  const to = v.activeTo === 'current' ? 'current' : `slot ${v.activeTo.slot}`;
  const toTime = v.activeTo !== 'current' ? v.activeTo.time : null;
  return (
    <span className="text-zinc-400 text-sm">
      slot {v.activeFrom.slot}
      {v.activeFrom.time && <span className="text-zinc-500"> ({v.activeFrom.time})</span>}
      <span className="mx-1.5 text-zinc-600">&rarr;</span>
      {v.activeTo === 'current' ? (
        <span className="text-emerald-400">current</span>
      ) : (
        <>
          {to}
          {toTime && <span className="text-zinc-500"> ({toTime})</span>}
        </>
      )}
    </span>
  );
}

function IdlTable({ versions, type }: { versions: IdlVersion[]; type: string }) {
  if (versions.length === 0) {
    return (
      <p className="text-zinc-500 text-sm italic">No {type} IDL found for this program.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-400 text-left">
            <th className="py-2 pr-4 font-medium">#</th>
            <th className="py-2 pr-4 font-medium">Version</th>
            <th className="py-2 pr-4 font-medium">Active range</th>
            <th className="py-2 font-medium text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v, i) => (
            <tr key={v.slot} className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition-colors">
              <td className="py-3 pr-4 text-zinc-500 tabular-nums">{i + 1}</td>
              <td className="py-3 pr-4">
                <span className="font-mono text-amber-400">
                  {v.version ? `v${v.version}` : '(no version)'}
                </span>
              </td>
              <td className="py-3 pr-4">
                <ActiveRange v={v} />
              </td>
              <td className="py-3 text-right">
                <button
                  type="button"
                  onClick={() => {
                    const suffix = v.version ? `_v${v.version}` : '';
                    downloadJson(v.content, `${v.slot}${suffix}.json`);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModeTabs({
  mode,
  onChange,
}: {
  mode: SearchMode;
  onChange: (m: SearchMode) => void;
}) {
  const tabs: { id: SearchMode; label: string; hint: string }[] = [
    { id: 'current', label: 'Current IDL', hint: 'GET /api/idl' },
    { id: 'latest', label: 'Latest both', hint: 'GET /api/latest' },
    { id: 'history', label: 'Full history', hint: 'GET /api/history' },
  ];
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
            mode === t.id
              ? 'bg-zinc-100 text-zinc-900 border-zinc-100'
              : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200'
          }`}
          title={t.hint}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ClusterTabs({
  cluster,
  onChange,
}: {
  cluster: Cluster;
  onChange: (c: Cluster) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg border border-zinc-800 bg-zinc-950">
      {CLUSTERS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
            cluster === c.id
              ? 'bg-zinc-100 text-zinc-900'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function CurrentIdlPanel({ data }: { data: CurrentIdlResponse }) {
  const display =
    typeof data.idl === 'string' ? data.idl : JSON.stringify(data.idl, null, 2);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-400">Resolved source</span>
        <span
          className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${
            data.type === 'pmp'
              ? 'bg-violet-950/60 text-violet-300 border border-violet-800/50'
              : 'bg-sky-950/60 text-sky-300 border border-sky-800/50'
          }`}
        >
          {data.type}
        </span>
        <code className="text-xs font-mono text-zinc-500 bg-zinc-900 px-2 py-1 rounded">{data.programId}</code>
      </div>
      <p className="text-zinc-500 text-xs">
        Same resolution as the CLI <code className="text-zinc-400">--current</code>: Program Metadata first (seed{' '}
        <code className="text-zinc-400">idl</code>), then Anchor.
      </p>
      <div className="relative rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="flex justify-end gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900/50">
          <button
            type="button"
            onClick={() => downloadUnknownIdl(data.idl, `idl-current-${data.programId.slice(0, 8)}.json`)}
            className="text-xs font-medium text-zinc-300 hover:text-white px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 cursor-pointer"
          >
            Download JSON
          </button>
        </div>
        <pre className="p-4 text-xs font-mono text-zinc-300 overflow-x-auto max-h-[min(70vh,520px)] overflow-y-auto whitespace-pre-wrap break-words">
          {display}
        </pre>
      </div>
    </div>
  );
}

function LatestTrackCard({
  title,
  address,
  rows,
  accent,
  fileSlug,
}: {
  title: string;
  address: string;
  rows: LatestSnapshot[];
  accent: 'violet' | 'sky';
  fileSlug: string;
}) {
  const ring = accent === 'violet' ? 'border-violet-900/40' : 'border-sky-900/40';
  const v = rows[0];
  return (
    <div className={`rounded-lg border ${ring} bg-zinc-950/80 p-4 space-y-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        {v && (
          <span className="font-mono text-amber-400 text-xs">{v.version ? `v${v.version}` : '(no version)'}</span>
        )}
      </div>
      <p className="text-[11px] font-mono text-zinc-500 break-all">{address}</p>
      {!v ? (
        <p className="text-zinc-500 text-sm italic">No on-chain IDL for this track.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          {v.slot && (
            <span>
              Last write slot <span className="text-zinc-300 tabular-nums">{v.slot}</span>
              {v.time && <span className="text-zinc-500"> ({v.time})</span>}
            </span>
          )}
          <button
            type="button"
            onClick={() => downloadJson(v.content, `idl-latest-${fileSlug}.json`)}
            className="ml-auto text-xs font-medium text-zinc-300 hover:text-white px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 cursor-pointer"
          >
            Download
          </button>
        </div>
      )}
    </div>
  );
}

function LatestPanel({ data }: { data: LatestResponse }) {
  return (
    <div className="space-y-4">
      <p className="text-zinc-500 text-xs">
        Fetches both PMP and Anchor IDL payloads in parallel (when present), with metadata account addresses.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <LatestTrackCard title="Program Metadata (PMP)" address={data.pmpAddress} rows={data.pmp} accent="violet" fileSlug="pmp" />
        <LatestTrackCard title="Anchor IDL" address={data.anchorAddress} rows={data.anchor} accent="sky" fileSlug="anchor" />
      </div>
    </div>
  );
}

export default function Home() {
  const [programId, setProgramId] = useState('');
  const [mode, setMode] = useState<SearchMode>('current');
  const [cluster, setCluster] = useState<Cluster>('mainnet-beta');
  const [loading, setLoading] = useState(false);
  const [currentData, setCurrentData] = useState<CurrentIdlResponse | null>(null);
  const [latestData, setLatestData] = useState<LatestResponse | null>(null);
  const [historyData, setHistoryData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearResults = useCallback(() => {
    setCurrentData(null);
    setLatestData(null);
    setHistoryData(null);
    setError(null);
  }, []);

  const search = useCallback(async () => {
    const id = programId.trim();
    if (!id) return;

    setLoading(true);
    clearResults();

    try {
      if (mode === 'current') {
        const res = await fetch(
          `/api/idl?programId=${encodeURIComponent(id)}&cluster=${cluster}`,
        );
        const json = (await res.json()) as CurrentIdlResponse & { error?: string };
        if (!res.ok) {
          setError(json.error ?? `HTTP ${res.status}`);
        } else {
          setCurrentData(json as CurrentIdlResponse);
        }
      } else if (mode === 'latest') {
        const res = await fetch(
          `/api/latest?programId=${encodeURIComponent(id)}&cluster=${cluster}`,
        );
        const json = (await res.json()) as LatestResponse & { error?: string };
        if (!res.ok) {
          setError(json.error ?? `HTTP ${res.status}`);
        } else {
          setLatestData(json as LatestResponse);
        }
      } else {
        const url = new URL('/api/history', window.location.origin);
        url.searchParams.set('programId', id);
        url.searchParams.set('cluster', cluster);
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? `HTTP ${res.status}`);
        } else {
          setHistoryData(json as HistoryResponse);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [programId, mode, cluster, clearResults]);

  const totalHistoryIdls = historyData ? historyData.pmp.length + historyData.anchor.length : 0;

  const loadingLabel =
    mode === 'current'
      ? 'Fetching current IDL…'
      : mode === 'latest'
        ? 'Fetching latest PMP and Anchor…'
        : 'Reconstructing IDL history from on-chain transactions…';

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">IDL Explorer</h1>
          <span className="text-xs text-zinc-500 border border-zinc-800 rounded px-1.5 py-0.5">Solana</span>
          <a
            href="https://github.com/solana-foundation/idl"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View source on GitHub"
            title="View source on GitHub"
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.93 10.93 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.63 1.59.24 2.76.12 3.05.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.05.78 2.12v3.14c0 .3.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
            </svg>
          </a>
          <div className="ml-auto flex items-center gap-4">
            <Link
              href="/docs"
              className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Docs
            </Link>
            <ClusterTabs
              cluster={cluster}
              onChange={(c) => {
                setCluster(c);
                clearResults();
              }}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10">
        <div className="mb-10">
          <p className="text-zinc-400 mb-4 text-sm leading-relaxed max-w-xl">
            {"Look up a program's IDL: quick "}
            <strong className="text-zinc-300">current</strong>
            {' fetch, '}
            <strong className="text-zinc-300">side-by-side latest</strong>
            {', or full '}
            <strong className="text-zinc-300">on-chain history</strong>
            {' (PMP and Anchor).'}
          </p>

          <ModeTabs
            mode={mode}
            onChange={(m) => {
              setMode(m);
              clearResults();
            }}
          />

          {mode === 'history' && (
            <div className="mb-4 px-3 py-2 bg-amber-950/30 border border-amber-900/40 rounded-lg text-amber-300/90 text-xs flex items-start gap-2">
              <svg
                viewBox="0 0 20 20"
                className="w-4 h-4 mt-0.5 shrink-0"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.66-1.146 2.367-1.146 3.029 0l6.28 10.875c.66 1.144-.165 2.58-1.515 2.58H3.72c-1.35 0-2.175-1.436-1.514-2.58L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
              <span>
                Full history walks every IDL-touching transaction. For programs with many
                upgrades this can take a minute or more — and may time out on the hosted
                deployment. For repeated use, the{' '}
                <a
                  href="https://github.com/solana-foundation/idl#cli"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-amber-200"
                >
                  CLI
                </a>{' '}
                with a private RPC is the reliable path.
              </span>
            </div>
          )}

          <div className="flex gap-3">
            <input
              type="text"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && search()}
              placeholder="Program address, e.g. TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
              className="flex-1 px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-colors"
            />
            <button
              type="button"
              onClick={search}
              disabled={loading || !programId.trim()}
              className="px-6 py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
                    <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  {mode === 'history' ? 'Scanning…' : 'Loading…'}
                </span>
              ) : (
                'Run'
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-8 px-4 py-3 bg-red-950/50 border border-red-900/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-20">
            <svg className="w-8 h-8 animate-spin mx-auto mb-4 text-zinc-500" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
              <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <p className="text-zinc-500 text-sm">{loadingLabel}</p>
            {mode === 'history' && (
              <p className="text-zinc-600 text-xs mt-1">
                Replaying every IDL transaction — large programs can take a minute or more.
              </p>
            )}
          </div>
        )}

        {currentData && !loading && mode === 'current' && <CurrentIdlPanel data={currentData} />}

        {latestData && !loading && mode === 'latest' && <LatestPanel data={latestData} />}

        {historyData && !loading && mode === 'history' && (
          <div className="space-y-10">
            <div className="flex items-baseline gap-3 mb-2">
              <p className="text-zinc-400 text-sm">
                Found <span className="text-white font-medium">{totalHistoryIdls}</span> distinct IDL version
                {totalHistoryIdls !== 1 ? 's' : ''} for
              </p>
              <code className="text-xs font-mono text-zinc-500 bg-zinc-900 px-2 py-1 rounded">
                {historyData.programId}
              </code>
            </div>

            <section>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <h2 className="text-base font-semibold">Anchor IDL</h2>
                <CopyableAddress address={historyData.anchorAddress} />
                {historyData.anchor.length > 0 && (
                  <span className="text-xs text-emerald-500 bg-emerald-950/50 px-2 py-0.5 rounded">
                    {historyData.anchor.length} version{historyData.anchor.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <IdlTable versions={historyData.anchor} type="Anchor" />
            </section>

            <section>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <h2 className="text-base font-semibold">Program Metadata (PMP)</h2>
                <CopyableAddress address={historyData.pmpAddress} />
                {historyData.pmp.length > 0 && (
                  <span className="text-xs text-emerald-500 bg-emerald-950/50 px-2 py-0.5 rounded">
                    {historyData.pmp.length} version{historyData.pmp.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <IdlTable versions={historyData.pmp} type="PMP" />
            </section>
          </div>
        )}
      </main>

      <footer className="border-t border-zinc-800 py-5 text-center text-zinc-600 text-xs space-y-1.5">
        <div>
          Current (<code className="text-zinc-500">/api/idl</code>), latest (
          <code className="text-zinc-500">/api/latest</code>), history (
          <code className="text-zinc-500">/api/history</code>)
          <span className="mx-2 text-zinc-700">·</span>
          <Link
            href="/docs"
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Docs
          </Link>
        </div>
        <div className="text-zinc-500">
          <a
            href="https://github.com/solana-foundation/idl-spec"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            IDL spec
          </a>
          <span className="mx-2 text-zinc-700">·</span>
          <a
            href="https://github.com/solana-foundation/idl"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            solana-foundation/idl
          </a>
          <span className="mx-2 text-zinc-700">·</span>
          <a
            href="https://github.com/codama-idl/codama"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Codama
          </a>
          <span className="text-zinc-600"> (client generation)</span>
        </div>
      </footer>
    </div>
  );
}
