// Ustawienia serwera. Wartości można nadpisać zmiennymi środowiskowymi.
export const config = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || 'postgres://sketcharena:sketcharena@localhost:5432/sketcharena',
  jwtSecret: process.env.JWT_SECRET || 'zmien-mnie-w-produkcji',
  chooseWordMs: Number(process.env.CHOOSE_WORD_MS) || 15000,   // czas rysującego na wybór hasła
  turnEndMs: Number(process.env.TURN_END_MS) || 4000,          // pauza z podsumowaniem tury
  minPlayers: 2,
};

