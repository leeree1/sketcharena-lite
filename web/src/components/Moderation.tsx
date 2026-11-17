import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../App';
import { Ban, Proposal, Report } from '../types';
import { Badge, Button, Card, DifficultyBadge, Empty, inputCls, Label, Spinner } from './ui';

type Filter = 'PENDING' | 'RESOLVED' | 'DISMISSED';
const FILTERS: { id: Filter; label: string }[] = [{ id: 'PENDING', label: 'Oczekujące' }, { id: 'RESOLVED', label: 'Z blokadą' }, { id: 'DISMISSED', label: 'Oddalone' }];
const fmt = (iso: string) => new Date(iso).toLocaleString('pl-PL');

/** Panel moderatora: lista zgłoszeń graczy (oddal albo zablokuj) i aktywne blokady */
export default function Moderation() {
  const { toast } = useApp();
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [bans, setBans] = useState<Ban[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, b] = await Promise.all([
        api<{ reports: Report[] }>('GET', `/moderation/reports?status=${filter}`),
        api<{ bans: Ban[] }>('GET', '/moderation/bans'),
      ]);
      setReports(r.reports); setBans(b.bans);
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Nie udało się pobrać danych moderacji.', 'error'); }
  }, [filter, toast]);

  useEffect(() => { setReports(null); load(); }, [load]);

  const resolve = async (id: string, action: 'DISMISS' | 'BAN', hours: number, note: string) => {
    try {
      await api('POST', `/moderation/reports/${id}/resolve`, { action, hours, note });
      toast(action === 'BAN' ? 'Gracz został zablokowany.' : 'Zgłoszenie oddalone.', 'success');
      load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Nie udało się rozpatrzyć zgłoszenia.', 'error'); }
  };

  const revoke = async (id: string) => {
    try { await api('POST', `/moderation/bans/${id}/revoke`); toast('Blokada odwołana.', 'success'); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Nie udało się odwołać blokady.', 'error'); }
  };

  return (
    <div className="space-y-4">
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card title="Zgłoszenia graczy" action={
        <div className="flex gap-1">{FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${filter === f.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>{f.label}</button>))}
        </div>}>
        {reports === null ? <Spinner /> : reports.length === 0 ? <Empty>Brak zgłoszeń w tej kategorii.</Empty> : (
          <ul className="space-y-3">{reports.map((r) => <ReportRow key={r.id} report={r} onResolve={resolve} />)}</ul>
        )}
      </Card>

      <Card title="Aktywne blokady">
        {bans === null ? <Spinner /> : bans.length === 0 ? <Empty>Nikt nie jest zablokowany.</Empty> : (
          <ul className="space-y-2">{bans.map((b) => (
            <li key={b.id} className="rounded-xl bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><b className="truncate">{b.user_name}</b><Badge tone="rose">do {fmt(b.expires_at)}</Badge></div>
              <p className="mt-1 text-xs text-slate-600">{b.reason}</p>
              <p className="text-[11px] text-slate-400">nałożył(a): {b.banned_by_name}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => revoke(b.id)}>Odwołaj blokadę</Button>
            </li>))}
          </ul>
        )}
      </Card>
    </div>
    <Proposals />
    </div>
  );
}

function ReportRow({ report, onResolve }: { report: Report; onResolve: (id: string, action: 'DISMISS' | 'BAN', hours: number, note: string) => void }) {
  const [hours, setHours] = useState(24);
  const [note, setNote] = useState('');
  const pending = report.status === 'PENDING';
  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>{report.reported_name}</b><span className="text-slate-400">zgłoszony(a) przez</span><b>{report.reporter_name}</b>
        <span className="ml-auto text-xs text-slate-400">{fmt(report.created_at)}</span>
      </div>
      <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{report.reason}</p>
      {pending ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
          <div><Label htmlFor={`h-${report.id}`}>Blokada (godz.)</Label>
            <input id={`h-${report.id}`} type="number" min={1} max={720} className={inputCls} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></div>
          <div><Label htmlFor={`n-${report.id}`}>Uzasadnienie (opcjonalnie)</Label>
            <input id={`n-${report.id}`} className={inputCls} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. wulgarne słowa na czacie" /></div>
          <div className="flex gap-2 sm:col-span-2">
            <Button variant="danger" size="sm" onClick={() => onResolve(report.id, 'BAN', hours, note)}>Zablokuj gracza</Button>
            <Button variant="secondary" size="sm" onClick={() => onResolve(report.id, 'DISMISS', hours, note)}>Oddal zgłoszenie</Button>
          </div>
        </div>
      ) : report.resolution_note && <p className="mt-2 text-xs text-slate-500">Uzasadnienie: {report.resolution_note}</p>}
    </li>
  );
}

/** Propozycje nowych haseł od graczy: zatwierdzenie dodaje hasło do gry */
function Proposals() {
  const { toast } = useApp();
  const [list, setList] = useState<Proposal[] | null>(null);
  const load = useCallback(() => api<{ proposals: Proposal[] }>('GET', '/moderation/proposals').then((r) => setList(r.proposals))
    .catch((e) => toast(e instanceof ApiError ? e.message : 'Nie udało się pobrać propozycji.', 'error')), [toast]);
  useEffect(() => { load(); }, [load]);
  const review = async (id: string, action: 'APPROVE' | 'REJECT') => {
    try {
      await api('POST', `/moderation/proposals/${id}/review`, { action });
      toast(action === 'APPROVE' ? 'Hasło dodane do gry.' : 'Propozycja odrzucona.', 'success');
      load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Nie udało się rozpatrzyć propozycji.', 'error'); }
  };
  return (
    <Card title="Propozycje nowych haseł">
      {list === null ? <Spinner /> : list.length === 0 ? <Empty>Brak propozycji do rozpatrzenia.</Empty> : (
        <ul className="divide-y divide-slate-100">{list.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{p.word}</div><div className="truncate text-xs text-slate-500">{p.category_name ?? 'bez kategorii'} · {p.hint} · od {p.proposer_name}</div></div>
            <DifficultyBadge d={p.difficulty} />
            <Button size="sm" variant="success" onClick={() => review(p.id, 'APPROVE')}>Zatwierdź</Button>
            <Button size="sm" variant="secondary" onClick={() => review(p.id, 'REJECT')}>Odrzuć</Button>
          </li>))}
        </ul>
      )}
    </Card>
  );
}
