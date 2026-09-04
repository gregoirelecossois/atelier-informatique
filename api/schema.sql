-- Schéma de la base « Atelier informatique ».
-- Rejouable sans risque : tout est en « if not exists », db.migrer() l'applique à chaque
-- démarrage du serveur comme au démarrage de outils/atl.mjs.
--
-- Données conservées, et rien d'autre (principe de minimisation, RGPD art. 5.1.c) :
-- prénom, nom, classe, identifiant, empreinte du mot de passe, progression de jeu.
-- Pas de date de naissance, pas d'adresse, pas d'e-mail élève, pas d'INE, aucun
-- champ de commentaire libre — c'est là que se logent les données sensibles par accident.

-- L'ÉTABLISSEMENT EST LA FRONTIÈRE. Une seule instance peut servir plusieurs collèges ;
-- chacun est un monde clos. Un enseignant appartient à un établissement et un seul, et
-- ne voit jamais rien au-delà : ni un élève, ni une classe, ni une présence, ni un nom.
-- Ce n'est pas une préférence d'affichage, c'est la limite juridique du traitement —
-- chaque chef d'établissement est responsable des données de SES élèves, et l'instance
-- partagée fait de l'hébergeur son sous-traitant (RGPD art. 28), pour lui seul.
--
-- `actif` à faux ferme l'établissement sans rien effacer : plus personne ne s'y connecte,
-- les données restent le temps de les restituer puis d'être supprimées en fin de contrat.
create table if not exists etablissements (
  id      serial primary key,
  nom     text not null,
  ville   text not null default '',
  actif   boolean not null default true,
  cree_le timestamptz not null default now()
);
create unique index if not exists etablissements_nom_idx
  on etablissements(lower(nom), lower(ville));

create table if not exists classes (
  id               serial primary key,
  nom              text not null,
  ordre            int  not null default 0,
  etablissement_id int  not null references etablissements(id) on delete cascade
);

create table if not exists comptes (
  id                 serial primary key,
  identifiant        text not null unique,
  prenom             text not null,
  nom                text not null,
  classe_id          int  references classes(id) on delete set null,
  etablissement_id   int  references etablissements(id) on delete restrict,
  role               text not null default 'eleve',
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

-- Journal des actions sensibles. `etablissement_id` y est nullable et sans cascade
-- destructrice : une trace qui disparaît avec ce qu'elle documente ne trace rien. Il
-- sert à répondre « que s'est-il passé chez vous ? » à un chef d'établissement sans
-- lui montrer le journal des autres.
create table if not exists journal (
  id       bigserial primary key,
  ts       timestamptz not null default now(),
  acteur   text,
  action   text not null,
  cible    text,
  details  jsonb,
  etablissement_id int references etablissements(id) on delete set null
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

-- --------------------------------------------------------------------------
-- Passage d'une base mono-établissement à une base cloisonnée.
-- Ces trois blocs ne font rien sur une base déjà à jour, et rien non plus sur une
-- base neuve : ils n'existent que pour la reprise de l'existant.
-- --------------------------------------------------------------------------
alter table classes  add column if not exists etablissement_id int references etablissements(id) on delete cascade;
alter table comptes  add column if not exists etablissement_id int references etablissements(id) on delete restrict;
alter table journal  add column if not exists etablissement_id int references etablissements(id) on delete set null;

-- Reprise : les classes et les comptes d'avant le cloisonnement n'appartiennent à
-- personne. On les rattache au premier établissement — celui qui existe déjà si
-- l'administrateur l'a créé, sinon un établissement à renommer tout de suite :
--   node outils/atl.mjs etablissements
--   node outils/atl.mjs renommer <id> "Collège Jean Moulin" "Ville"
-- Les rattacher SILENCIEUSEMENT à un établissement est le seul choix sûr : la seule
-- autre issue serait de les laisser orphelins, donc invisibles de tous — une base qui
-- s'efface toute seule au premier démarrage.
do $$
declare e int;
begin
  if exists (select 1 from classes where etablissement_id is null)
     or exists (select 1 from comptes where etablissement_id is null and role <> 'admin') then
    select id into e from etablissements order by id limit 1;
    if e is null then
      insert into etablissements(nom) values ('Établissement à renommer') returning id into e;
      raise notice 'Reprise : établissement % créé, à renommer (atl.mjs renommer).', e;
    end if;
    update classes set etablissement_id = e where etablissement_id is null;
    update comptes set etablissement_id = e where etablissement_id is null and role <> 'admin';
  end if;
end $$;

-- Une classe SANS établissement n'a aucun sens : elle serait visible de tous ou de
-- personne. La contrainte est le garde-fou du cloisonnement, pas une décoration —
-- si elle refuse de s'appliquer, le serveur ne démarre pas, et c'est voulu.
alter table classes alter column etablissement_id set not null;

-- « 6eB » n'est unique QUE dans son établissement. Avec l'ancienne unicité globale,
-- deux collèges n'auraient pas pu avoir tous les deux une 6eB — et surtout, la
-- résolution d'une classe par son nom aurait renvoyé celle du voisin.
-- L'index porte sur lower(nom) : « 6eb » et « 6eB » sont la même classe, ce que la
-- recherche insensible à la casse de comptes.js supposait déjà.
alter table classes drop constraint if exists classes_nom_key;
create unique index if not exists classes_etab_nom_idx on classes(etablissement_id, lower(nom));
create index if not exists classes_etab_idx on classes(etablissement_id);
create index if not exists comptes_etab_idx on comptes(etablissement_id);
create index if not exists journal_etab_idx on journal(etablissement_id);

-- Trois rôles. « admin » gère les établissements et les comptes enseignants ; il
-- n'appartient à aucun établissement et ne voit aucun élève. C'est la seule exception
-- à la contrainte d'appartenance ci-dessous, et elle est explicite.
alter table comptes drop constraint if exists comptes_role_check;
alter table comptes add constraint comptes_role_check check (role in ('eleve','prof','admin'));
alter table comptes drop constraint if exists comptes_etablissement_check;
alter table comptes add constraint comptes_etablissement_check
  check (role = 'admin' or etablissement_id is not null);
