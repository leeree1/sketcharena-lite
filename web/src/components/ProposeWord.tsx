import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../App';
import { Category, Difficulty, DIFFICULTY_LABEL } from '../types';
import { Button, inputCls, Label, Modal } from './ui';

/** Okno, w którym zarejestrowany gracz proponuje nowe hasło do gry (trafia do moderatorów) */
export default function ProposeWord({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [cats, setCats] = useState<Category[]>([]);
  const [form, setForm] = useState({ word: '', difficulty: 'EASY' as Difficulty, categoryId: '', hint: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ categories: Category[] }>('GET', '/kb/categories').then((r) => setCats(r.categories)).catch(() => undefined); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('POST', '/moderation/proposals', { ...form, categoryId: form.categoryId ? Number(form.categoryId) : null });
      toast('Dziękujemy! Propozycja trafiła do moderatorów.', 'success');
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Nie udało się wysłać propozycji.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Zaproponuj nowe hasło" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div><Label htmlFor="p-word">Hasło</Label><input id="p-word" className={inputCls} value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} minLength={2} maxLength={60} required autoFocus /></div>
        <div><Label htmlFor="p-diff">Poziom trudności</Label>
          <select id="p-diff" className={inputCls} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}>
            {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}</select></div>
        <div><Label htmlFor="p-cat">Kategoria</Label>
          <select id="p-cat" className={inputCls} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">(bez kategorii)</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><Label htmlFor="p-hint">Podpowiedź słowna (opis, bez podawania hasła)</Label><input id="p-hint" className={inputCls} value={form.hint} onChange={(e) => setForm({ ...form, hint: e.target.value })} minLength={3} maxLength={300} required /></div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Anuluj</Button><Button type="submit" disabled={busy}>Wyślij propozycję</Button></div>
      </form>
    </Modal>
  );
}
