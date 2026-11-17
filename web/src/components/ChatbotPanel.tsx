import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../App';
import { BotReply } from '../types';
import { Button, Card, inputCls } from './ui';

interface Msg { id: number; from: 'user' | 'bot'; text: string; reply?: BotReply }
const SUGGESTIONS = ['Chcę zagrać w trudne hasła historyczne', 'Wytłumacz mi zasady punktacji', 'Jak rysować na tablecie?', 'Jakie są kategorie?'];

/** Okno rozmowy z chatbotem w lobby: odpowiedzi z bazy wiedzy, źródła i przycisk dołączenia do dobranego pokoju */
export default function ChatbotPanel() {
  const { user, openRoom, openArticle, toast } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, from: 'bot', text: `Cześć, ${user.username}! Jestem botem SketchArena. Zapytaj mnie o zasady albo napisz, w co chcesz zagrać — dobiorę pokój.` }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  const send = async (message: string) => {
    const m = message.trim();
    if (!m || busy) return;
    setMsgs((s) => [...s, { id: idRef.current++, from: 'user', text: m }]);
    setText(''); setBusy(true);
    try {
      const reply = await api<BotReply>('POST', '/chatbot/message', { message: m });
      setMsgs((s) => [...s, { id: idRef.current++, from: 'bot', text: reply.reply, reply }]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Chatbot jest chwilowo niedostępny.', 'error');
    } finally { setBusy(false); }
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(text); };

  return (
    <Card title={<span className="flex items-center gap-2"><span aria-hidden>🤖</span> Chatbot SketchArena</span>} fill className="h-[640px] lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {msgs.map((m) => (
            <div key={m.id} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`slide-in max-w-[88%] rounded-2xl px-3.5 py-2 text-sm ${m.from === 'user' ? 'rounded-br-sm bg-indigo-600 text-white' : 'rounded-bl-sm bg-slate-100 text-slate-800'}`}>
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.reply?.action && <Button size="sm" variant="success" className="mt-2" onClick={() => openRoom(m.reply!.action!.roomCode)}>{m.reply.action.label} →</Button>}
                {m.reply && m.reply.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-200 pt-2 text-xs text-slate-500">Źródło:
                    {m.reply.sources.map((s) => <button key={s.slug} onClick={() => openArticle(s.slug)} className="rounded-full bg-white px-2 py-0.5 font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50">{s.title}</button>)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex justify-start"><div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-500">Bot pisze…</div></div>}
          <div ref={end} />
        </div>
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => <button key={s} onClick={() => void send(s)} disabled={busy} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50">{s}</button>)}
          </div>
          <form onSubmit={onSubmit} className="flex gap-2">
            <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="Napisz do bota…" maxLength={500} aria-label="Wiadomość do chatbota" />
            <Button type="submit" disabled={busy || !text.trim()}>Wyślij</Button>
          </form>
        </div>
      </div>
    </Card>
  );
}
