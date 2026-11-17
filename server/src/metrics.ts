// Metryki aplikacji dla Prometheusa. Prometheus co kilka sekund odpytuje adres /metrics i zapisuje liczby w czasie.
import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';

export const register = new Registry();
// Gotowe metryki procesu Node.js: pamięć, CPU, opóźnienie pętli zdarzeń, liczba otwartych uchwytów
collectDefaultMetrics({ register, prefix: 'sketcharena_' });

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];   // przedziały czasu w sekundach

// ---------- histogramy: ile trwały operacje ----------
export const httpRequestDuration = new Histogram({
  name: 'sketcharena_http_request_duration_seconds', help: 'Czas obsługi żądań HTTP',
  labelNames: ['method', 'route', 'status'], buckets: DURATION_BUCKETS, registers: [register],
});
export const dbQueryDuration = new Histogram({
  name: 'sketcharena_db_query_duration_seconds', help: 'Czas zapytań do bazy PostgreSQL',
  labelNames: ['operation'], buckets: DURATION_BUCKETS, registers: [register],
});

// ---------- liczniki: ile razy coś się wydarzyło (tylko rosną) ----------
const counter = (name: string, help: string, labelNames: string[] = []) => new Counter({ name: `sketcharena_${name}`, help, labelNames, registers: [register] });
export const socketEventsTotal = counter('socket_events_total', 'Zdarzenia WebSocket odebrane od graczy', ['event']);
export const socketErrorsTotal = counter('socket_errors_total', 'Zdarzenia WebSocket zakończone błędem', ['event']);
export const authTotal = counter('auth_total', 'Wejścia do gry: gość, rejestracja, logowanie', ['action', 'result']);
export const gamesStartedTotal = counter('games_started_total', 'Rozpoczęte mecze');
export const gamesFinishedTotal = counter('games_finished_total', 'Zakończone mecze');
export const gamesAbortedTotal = counter('games_aborted_total', 'Przerwane mecze');
export const moderationActionsTotal = counter('moderation_actions_total', 'Zgłoszenia, blokady i propozycje haseł', ['action']);

// ---------- wskaźniki: aktualna wartość (rośnie i maleje) ----------
// Skąd brać liczby, ustawiamy z zewnątrz (server.ts), żeby ten plik nie zależał od reszty aplikacji
let sources = { rooms: () => ({ rooms: 0, inGame: 0 }), sockets: () => 0 };
export function registerMetricSources(s: typeof sources) { sources = s; }

new Gauge({
  name: 'sketcharena_players_online', help: 'Aktualnie połączeni gracze (połączenia WebSocket)', registers: [register],
  collect() { this.set(sources.sockets()); },                  // collect() jest wywoływane przy każdym odpytaniu /metrics
});
new Gauge({
  name: 'sketcharena_rooms', help: 'Pokoje gry według stanu', labelNames: ['state'], registers: [register],
  collect() { const r = sources.rooms(); this.set({ state: 'lobby' }, r.rooms - r.inGame); this.set({ state: 'in_game' }, r.inGame); },
});

/** Middleware Express: mierzy czas każdego żądania HTTP i zapisuje go z etykietami metoda, trasa, status */
export function httpMetrics(req: Request, res: Response, next: NextFunction) {
  const stop = httpRequestDuration.startTimer();
  res.on('finish', () => {
    // trasa w postaci wzorca (np. /api/moderation/reports/:id), a nie prawdziwego adresu: dzięki temu etykiet jest mało
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    stop({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}

/** Odpowiedź na GET /metrics w formacie tekstowym Prometheusa */
export async function metricsHandler(_req: Request, res: Response) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}
