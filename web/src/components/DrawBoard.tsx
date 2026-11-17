import { forwardRef, ReactNode, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Stroke } from '../types';
import { Button } from './ui';

export interface BoardHandle { applyStroke(s: Stroke): void; undo(): void; clear(): void; replay(list: Stroke[]): void }
const W = 800, H = 600;                       // rozdzielczość płótna; współrzędne w komunikatach są znormalizowane do 0–1
const COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#92400e'];
const WIDTHS = [4, 10, 20];

function paint(ctx: CanvasRenderingContext2D, s: Stroke, from: number) {
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const p = s.points;
  if (p.length === 1 && from === 0) { ctx.beginPath(); ctx.arc(p[0][0] * W, p[0][1] * H, s.width / 2, 0, Math.PI * 2); ctx.fill(); return; }
  const start = Math.max(0, from - 1);
  ctx.beginPath(); ctx.moveTo(p[start][0] * W, p[start][1] * H);
  for (let i = start + 1; i < p.length; i++) ctx.lineTo(p[i][0] * W, p[i][1] * H);
  ctx.stroke();
}

interface Props { canDraw: boolean; onStroke: (s: Stroke) => void; onUndo: () => void; onClear: () => void; children?: ReactNode }

/** Płótno HTML5 z rysowaniem wektorowym: punkty trafiają do serwera w paczkach co ok. 40 ms */
const DrawBoard = forwardRef<BoardHandle, Props>(function DrawBoard({ canDraw, onStroke, onUndo, onClear, children }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[0]);
  const drawing = useRef<{ id: string; color: string; width: number; buffer: [number, number][] } | null>(null);
  const cb = useRef({ onStroke, onUndo, onClear }); cb.current = { onStroke, onUndo, onClear };

  const ctx = () => canvas.current!.getContext('2d')!;
  const redraw = () => { const c = ctx(); c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H); strokes.current.forEach((s) => paint(c, s, 0)); };
  const apply = (s: Stroke) => {
    const list = strokes.current, last = list[list.length - 1];
    if (last && last.id === s.id) { const from = last.points.length; last.points.push(...s.points); paint(ctx(), last, from); }
    else { const n = { ...s, points: [...s.points] }; list.push(n); paint(ctx(), n, 0); }
  };
  useEffect(() => { redraw(); }, []);
  useImperativeHandle(ref, () => ({
    applyStroke: apply,
    undo() { strokes.current.pop(); redraw(); },
    clear() { strokes.current = []; redraw(); },
    replay(list) { strokes.current = list.map((s) => ({ ...s, points: [...s.points] })); redraw(); },
  }));

  const flush = () => {
    const d = drawing.current;
    if (d && d.buffer.length) { cb.current.onStroke({ id: d.id, color: d.color, width: d.width, points: d.buffer }); d.buffer = []; }
  };
  useEffect(() => {
    if (!canDraw) { drawing.current = null; return; }
    const t = setInterval(flush, 40);
    return () => { clearInterval(t); flush(); };
  }, [canDraw]);

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const down = (e: React.PointerEvent) => {
    if (!canDraw) return;
    canvas.current!.setPointerCapture(e.pointerId);
    const p = pos(e), id = Math.random().toString(36).slice(2, 10);
    drawing.current = { id, color, width, buffer: [p] };
    apply({ id, color, width, points: [p] });
  };
  const move = (e: React.PointerEvent) => {
    const d = drawing.current; if (!d) return;
    const p = pos(e), last = d.buffer[d.buffer.length - 1] ?? strokes.current[strokes.current.length - 1]?.points.slice(-1)[0];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002) return;
    d.buffer.push(p); apply({ id: d.id, color: d.color, width: d.width, points: [p] });
  };
  const up = () => { flush(); drawing.current = null; };

  return (
    <div>
      <div className="relative">
        <canvas ref={canvas} width={W} height={H} style={{ aspectRatio: '4 / 3' }} className={`w-full rounded-xl border border-slate-200 bg-white shadow-inner ${canDraw ? 'board' : 'board-readonly'}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} aria-label="Płótno do rysowania" />
        {children}
      </div>
      {canDraw && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2" role="toolbar" aria-label="Narzędzia rysowania">
          <div className="flex gap-1">{COLORS.map((c) => <button key={c} onClick={() => setColor(c)} aria-label={`Kolor ${c}`} aria-pressed={color === c} className={`h-7 w-7 rounded-full border-2 ${color === c ? 'border-slate-900 ring-2 ring-indigo-300' : 'border-white shadow'}`} style={{ background: c }} />)}
            <button onClick={() => setColor('#ffffff')} aria-label="Gumka" aria-pressed={color === '#ffffff'} title="Gumka" className={`h-7 rounded-full border-2 bg-white px-2 text-xs font-semibold ${color === '#ffffff' ? 'border-slate-900 ring-2 ring-indigo-300' : 'border-slate-300'}`}>Gumka</button></div>
          <div className="flex items-center gap-1 border-l border-slate-200 pl-2">{WIDTHS.map((w) => <button key={w} onClick={() => setWidth(w)} aria-label={`Grubość ${w}`} aria-pressed={width === w} className={`grid h-8 w-8 place-items-center rounded-lg ${width === w ? 'bg-indigo-100' : 'hover:bg-slate-100'}`}><span className="rounded-full bg-slate-800" style={{ width: Math.max(4, w / 1.5), height: Math.max(4, w / 1.5) }} /></button>)}</div>
          <div className="ml-auto flex gap-1.5"><Button size="sm" variant="secondary" onClick={() => { strokes.current.pop(); redraw(); cb.current.onUndo(); }}>↶ Cofnij</Button><Button size="sm" variant="secondary" onClick={() => { strokes.current = []; redraw(); cb.current.onClear(); }}>Wyczyść</Button></div>
        </div>
      )}
    </div>
  );
});
export default DrawBoard;
