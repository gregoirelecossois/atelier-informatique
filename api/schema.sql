-- Schéma de la base « Atelier informatique ».
-- Rejouable sans risque : tout est en « if not exists », outils/atl.mjs l'applique
-- à chaque démarrage d'initialisation.
--
-- Données conservées, et rien d'autre (principe de minimisation, RGPD art. 5.1.c) :
-- prénom, nom, classe, identifiant, empreinte du mot de passe, progression de jeu.
-- Pas de date de naissance, pas d'adresse, pas d'e-mail élève, pas d'INE, aucun
-- champ de commentaire libre — c'est là que se logent les données sensibles par accident.

create table if not exists classes (
  id     serial primary key,
  nom    text not null unique,
  ordre  int  not null default 0
);

create table if not exists comptes (
  id                 serial primary key,
  identifiant        text not null unique,
  prenom             text not null,
  nom                text not null,
  classe_id          int  references classes(id) on delete set null,
  role               text not null default 'eleve' check (role in ('eleve','prof')),
  mdp                text not null,
  doit_changer_mdp   boolean not null default false,
  actif              boolean not null default true,
  cree_le            timestamptz not null default now(),
  derniere_connexion timestamptz
);
create index if not exists comptes_classe_idx on comptes(classe_id);

create table if not exists progressions (
  compte_id int primary key references comptes(id) on delete cascade,
  donnees   jsonb not null default '{}'::jsonb,
  version   int   not null default 0,
  maj_le    timestamptz not null default now()
);

-- `jeton` stocke l'empreinte SHA-256 du jeton, jamais le jeton lui-même : une copie
-- de la base ne donne aucune session utilisable.
create table if not exists sessions (
  jeton     text primary key,
  compte_id int not null references comptes(id) on delete cascade,
  cree_le   timestamptz not null default now(),
  vue_le    timestamptz not null default now(),
  expire_le timestamptz not null
);
create index if not exists sessions_compte_idx on sessions(compte_id);
create index if not exists sessions_expire_idx on sessions(expire_le);

-- Journal des actions sensibles. Sert à la phase 2 (tableau de bord) mais la table
-- existe dès maintenant : une trace qu'on ajoute après coup ne raconte pas le passé.
create table if not exists journal (
  id       bigserial primary key,
  ts       timestamptz not null default now(),
  acteur   text,
  action   text not null,
  cible    text,
  details  jsonb
);
create index if not exists journal_ts_idx on journal(ts desc);

-- Présence « en direct » du tableau de bord enseignant. Une ligne par élève, écrasée à
-- chaque battement (toutes les 45 s tant que l'onglet est visible). On garde volontairement
-- le DERNIER état seulement : savoir où en est un élève maintenant sert à l'aider tout de
-- suite ; conserver la trace de ses allées et venues serait une collecte sans finalité.
create table if not exists presence (
  compte_id int primary key references comptes(id) on delete cascade,
  atelier   text,
  niveau    int,
  mission   int,
  vu_le     timestamptz not null default now()
);
create index if not exists presence_vu_idx on presence(vu_le desc);
