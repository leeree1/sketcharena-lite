import { ReactNode, useEffect } from 'react';
import { Difficulty, DIFFICULTY_LABEL } from '../types';

export const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';

type BtnProps = { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'; disabled?: boolean; className?: string; title?: string; size?: 'sm' | 'md' };
export function Button({ children, onClick, type = 'button', variant = 'primary', disabled, className = '', title, size = 'md' }: BtnProps) {
  const v = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-500',
    success: 'bg-emerald-600 text-white hover:bg-emerald-500',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }[variant];
  const s = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm';
  return <button type={type} title={title} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${s} ${v} ${className}`}>{children}</button>;
}

export const Card = ({ children, className = '', title, action, fill }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; fill?: boolean }) => (
  <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${fill ? 'flex flex-col overflow-hidden' : ''} ${className}`}>
    {title && <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-bold text-slate-800">{title}</h2>{action}</header>}
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : 'p-4'}>{children}</div>
  </section>
);

const diffCls: Record<Difficulty, string> = { EASY: 'bg-emerald-100 text-emerald-800', MEDIUM: 'bg-amber-100 text-amber-800', HARD: 'bg-rose-100 text-rose-800' };
export const DifficultyBadge = ({ d }: { d: Difficulty }) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${diffCls[d]}`}>{DIFFICULTY_LABEL[d]}</span>;
export const Badge = ({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'indigo' | 'amber' | 'rose' | 'emerald' }) => {
  const t = { slate: 'bg-slate-100 text-slate-700', indigo: 'bg-indigo-100 text-indigo-700', amber: 'bg-amber-100 text-amber-800', rose: 'bg-rose-100 text-rose-700', emerald: 'bg-emerald-100 text-emerald-700' }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
};

export function Modal({ children, onClose, title, wide }: { children: ReactNode; onClose?: () => void; title?: string; wide?: boolean }) {
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`pop max-h-[90vh] w-full overflow-auto rounded-2xl bg-white p-5 shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        {title && <h2 className="mb-3 text-lg font-bold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export const Spinner = () => <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" role="status" aria-label="Ładowanie" />;
export const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">{children}</p>;
export const Label = ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-slate-600">{children}</label>;

/** Prosty renderer treści artykułów: nagłówki „## ”, listy „- ” i pogrubienia **tekst** */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length} className="my-2 list-disc space-y-1 pl-5">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; } };
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) { list.push(line.slice(2)); continue; }
    flush();
    if (line.startsWith('## ')) blocks.push(<h3 key={blocks.length} className="mt-4 mb-1 text-base font-bold text-slate-900">{line.slice(3)}</h3>);
    else if (line.trim()) blocks.push(<p key={blocks.length} className="my-2">{inline(line)}</p>);
  }
  flush();
  return <div className="text-sm leading-relaxed text-slate-700">{blocks}</div>;
}
