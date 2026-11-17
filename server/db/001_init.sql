-- SketchArena — schemat bazy danych (PostgreSQL 16)
-- Migracja 001: struktura początkowa (MVP)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ---------- typy wyliczeniowe ----------
CREATE TYPE user_role        AS ENUM ('GUEST', 'PLAYER', 'MODERATOR', 'ADMIN');
CREATE TYPE article_type     AS ENUM ('RULES', 'DRAWING_TIPS', 'FAQ', 'GLOSSARY');
CREATE TYPE report_status    AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');
CREATE TYPE proposal_status  AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE session_status   AS ENUM ('IN_PROGRESS', 'FINISHED', 'ABORTED');
CREATE TYPE message_author   AS ENUM ('USER', 'BOT');

-- ---------- użytkownicy i blokady ----------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      varchar(32)  NOT NULL UNIQUE,
  email         varchar(254) UNIQUE,                 -- NULL dla gości
  password_hash varchar(100),                        -- NULL dla gości
  role          user_role    NOT NULL DEFAULT 'GUEST',
  elo_rating    integer      NOT NULL DEFAULT 1000,
  games_played  integer      NOT NULL DEFAULT 0,
  games_won     integer      NOT NULL DEFAULT 0,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  last_seen_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT users_registered_has_credentials
    CHECK (role = 'GUEST' OR (email IS NOT NULL AND password_hash IS NOT NULL))
);
CREATE INDEX idx_users_elo ON users (elo_rating DESC) WHERE role <> 'GUEST';
CREATE UNIQUE INDEX uq_users_username_ci ON users (lower(username));   -- pseudonim unikalny bez względu na wielkość liter
CREATE UNIQUE INDEX uq_users_email_ci    ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE user_bans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by  uuid         NOT NULL REFERENCES users(id),
  reason     text         NOT NULL,
  created_at timestamptz  NOT NULL DEFAULT now(),
  expires_at timestamptz  NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX idx_bans_user_active ON user_bans (user_id, expires_at);

-- ---------- baza wiedzy i słowniki ----------
CREATE TABLE difficulty_levels (
  code        varchar(10) PRIMARY KEY,               -- EASY | MEDIUM | HARD
  label       varchar(30)  NOT NULL,
  multiplier  numeric(3,1) NOT NULL CHECK (multiplier > 0),
  sort_order  smallint     NOT NULL
);

CREATE TABLE categories (
  id        serial PRIMARY KEY,
  slug      varchar(40) NOT NULL UNIQUE,
  name      varchar(60) NOT NULL,
  keywords  text[]      NOT NULL DEFAULT '{}'        -- słowa kluczowe dla chatbota
);

CREATE TABLE words (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word             varchar(60)  NOT NULL UNIQUE,
  difficulty_code  varchar(10)  NOT NULL REFERENCES difficulty_levels(code),
  category_id      integer REFERENCES categories(id) ON DELETE SET NULL,
  hint_description text         NOT NULL,            -- podpowiedź semantyczna
  is_active        boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_words_pool ON words (difficulty_code, category_id) WHERE is_active;

CREATE TABLE word_proposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_by      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word             varchar(60) NOT NULL,
  difficulty_code  varchar(10) NOT NULL REFERENCES difficulty_levels(code),
  category_id      integer REFERENCES categories(id) ON DELETE SET NULL,
  hint_description text        NOT NULL,
  status           proposal_status NOT NULL DEFAULT 'PENDING',
  reviewed_by      uuid REFERENCES users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proposals_status ON word_proposals (status);

CREATE TABLE knowledge_articles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        varchar(80)  NOT NULL UNIQUE,
  title       varchar(160) NOT NULL,
  content     text         NOT NULL,
  type        article_type NOT NULL,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  is_published boolean     NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  -- wyszukiwanie bez rozróżniania polskich znaków: translate() jest funkcją IMMUTABLE
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', translate(coalesce(title, ''),   'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ')), 'A') ||
    setweight(to_tsvector('simple', translate(coalesce(content, ''), 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ')), 'B')
  ) STORED
);
CREATE INDEX idx_articles_fts ON knowledge_articles USING GIN (search_vector);

-- ---------- pokoje i rozgrywka ----------
CREATE TABLE rooms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               varchar(6)  NOT NULL UNIQUE,
  host_id            uuid        NOT NULL REFERENCES users(id),
  difficulty_code    varchar(10) NOT NULL REFERENCES difficulty_levels(code),
  category_id        integer REFERENCES categories(id) ON DELETE SET NULL,
  max_players        smallint    NOT NULL CHECK (max_players BETWEEN 2 AND 12),
  round_time_seconds smallint    NOT NULL CHECK (round_time_seconds BETWEEN 20 AND 180),
  rounds             smallint    NOT NULL CHECK (rounds BETWEEN 1 AND 10),
  is_private         boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz
);

CREATE TABLE game_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  status         session_status NOT NULL DEFAULT 'IN_PROGRESS',
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  winner_user_id uuid REFERENCES users(id)
);
CREATE INDEX idx_sessions_room ON game_sessions (room_id);

CREATE TABLE game_players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  final_score integer NOT NULL DEFAULT 0,
  final_rank  smallint,
  elo_before  integer,
  elo_after   integer,
  UNIQUE (session_id, user_id)
);
CREATE INDEX idx_game_players_user ON game_players (user_id);

CREATE TABLE game_turns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number     smallint NOT NULL,
  drawer_user_id  uuid NOT NULL REFERENCES users(id),
  word_id         uuid NOT NULL REFERENCES words(id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  UNIQUE (session_id, turn_number)
);

CREATE TABLE guesses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id        uuid NOT NULL REFERENCES game_turns(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id),
  guessed_text   varchar(100) NOT NULL,
  is_correct     boolean NOT NULL DEFAULT false,
  points_awarded integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_guesses_turn ON guesses (turn_id);

-- ---------- moderacja ----------
CREATE TABLE moderation_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id          uuid REFERENCES rooms(id) ON DELETE SET NULL,
  reason           text NOT NULL,
  status           report_status NOT NULL DEFAULT 'PENDING',
  handled_by       uuid REFERENCES users(id),
  resolution_note  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  handled_at       timestamptz
);
CREATE INDEX idx_reports_status ON moderation_reports (status, created_at);

-- ---------- chatbot i ustawienia ----------
CREATE TABLE chatbot_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author     message_author NOT NULL,
  content    text NOT NULL,
  intent     varchar(30),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_user_time ON chatbot_messages (user_id, created_at DESC);

CREATE TABLE system_settings (
  key        varchar(60) PRIMARY KEY,
  value      text        NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

