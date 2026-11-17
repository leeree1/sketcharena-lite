import { NextFunction, Request, Response } from 'express';

/** Błąd z kodem HTTP, który serwer zamienia na odpowiedź JSON */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Opakowuje asynchroniczną obsługę trasy, żeby błędy trafiały do middleware błędów */
export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

