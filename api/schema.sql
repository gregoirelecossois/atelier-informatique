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

-- Projets MakeCode (makecode.html). Une ligne par projet, `id` étant l'identifiant que
-- MakeCode donne lui-même au projet. `donnees` est le projet compressé par le navigateur
-- (gzip puis base64, préfixe « gz: ») : le serveur le range sans l'ouvrir. Il n'a pas à
-- savoir ce qu'un élève a programmé — seulement à le lui rendre sur un autre poste.
--
-- ⚠ C'est la seule table qui contienne du TEXTE LIBRE écrit par l'élève : le nom du projet,
-- et ce qu'il fait afficher à sa carte. Même durée de vie que le compte (cascade), donc
-- même fin de vie (nouvelle année ou plafond de 60 mois) ; à mentionner au registre
-- et dans la mention d'information.
create table if not exists projets_makecode (
  compte_id int  not null references comptes(id) on delete cascade,
  id        text not null,
  donnees   text not null,
  maj_le    timestamptz not null default now(),
  primary key (compte_id, id)
);

-- Modèles MakeCode : un projet qu'un enseignant propose à une ou plusieurs classes.
-- L'élève le retrouve dans « Nouveau projet » et en part pour créer SA copie, rangée
-- ensuite dans projets_makecode comme n'importe quel projet. Rien n'est écrit chez
-- l'élève tant qu'il n'a pas choisi : un modèle publié ou corrigé n'écrase jamais
-- le travail commencé.
-- Un modèle appartient à l'ÉTABLISSEMENT, pas à son auteur : un collègue du même
-- collège le voit et le gère (même règle que les classes et les comptes). `auteur_id`
-- n'est qu'indicatif, et un compte enseignant supprimé laisse ses modèles en place.
-- `source` est l'identifiant MakeCode du projet de l'enseignant : republier le même
-- projet met le modèle à jour au lieu d'en créer un second.
-- Aucune donnée d'élève ici : c'est du contenu écrit par l'enseignant.
create table if not exists modeles_makecode (
  id               serial primary key,
  etablissement_id int  not null references etablissements(id) on delete cascade,
  auteur_id        int  references comptes(id) on delete set null,
  source           text not null,
  nom              text not null,
  donnees          text not null,
  maj_le           timestamptz not null default now(),
  unique (etablissement_id, source)
);

-- À quelles classes un modèle est proposé. Une classe supprimée disparaît d'ici toute
-- seule ; un modèle qui n'est plus proposé à aucune classe reste visible des
-- enseignants, qui peuvent le reproposer ou le retirer.
create table if not exists modeles_makecode_classes (
  modele_id int not null references modeles_makecode(id) on delete cascade,
  classe_id int not null references classes(id) on delete cascade,
  primary key (modele_id, classe_id)
);
create index if not exists modeles_makecode_classes_classe_idx on modeles_makecode_classes(classe_id);

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

-- Passage à l'année suivante (« 🎓 Nouvelle année » du tableau de bord). Les règles
-- vivent ICI, par établissement, et pas dans le navigateur : l'enseignant les règle une
-- fois, depuis n'importe quel poste, et un collègue du même collège retrouve les mêmes.
-- `passage` à null veut dire « réglages par défaut » (PASSAGE_DEFAUT de comptes.js) :
-- on ne recopie pas le défaut en base, pour qu'un défaut corrigé profite à tous ceux
-- qui n'y ont pas touché. `passage_le` date le dernier passage effectué — c'est lui qui
-- empêche de faire monter tout le monde de deux classes par un double clic.
alter table etablissements add column if not exists passage    jsonb;
alter table etablissements add column if not exists passage_le timestamptz;

-- ---------------------------------------------------------------------------
-- Travail à la maison (« devoirs »), SANS compte.
--
-- Une page d'exercices pour téléphone (dépôt le-pc, maison.html) où l'élève entre par
-- son prénom et sa classe, sans identifiant ni mot de passe : à la maison, un mot de
-- passe oublié est un devoir non fait. Ce n'est donc PAS un compte, et rien ici n'est
-- relié à `comptes` : une ligne par téléphone et par devoir, que l'élève écrase au fil
-- de son avancée.
--
-- Ce qui est gardé : le prénom tapé, la classe choisie dans la liste de l'établissement,
-- le nombre d'étapes faites et le score. Rien d'autre — ni nom, ni adresse IP, ni détail
-- des réponses. Le prénom n'est fait que de lettres : aucun champ libre.
--
-- `id` est tiré au hasard par le navigateur de l'élève et lui sert de clé de reprise.
-- `code_devoir` est le code que porte le lien distribué aux élèves : c'est lui, et pas
-- un numéro, qui rattache une ligne à son établissement — l'établissement reste la
-- frontière, y compris pour une page ouverte sans connexion.
alter table etablissements add column if not exists code_devoir text;
create unique index if not exists etablissements_code_devoir_idx on etablissements(code_devoir);

create table if not exists devoirs_passages (
  id               text primary key,
  etablissement_id int  not null references etablissements(id) on delete cascade,
  devoir           text not null,
  prenom           text not null,
  classe_id        int  references classes(id) on delete set null,
  etape            int  not null default 0,
  etapes           int  not null default 0,
  score            int  not null default 0,
  score_max        int  not null default 0,
  termine          boolean not null default false,
  debut_le         timestamptz not null default now(),
  maj_le           timestamptz not null default now()
);
create index if not exists devoirs_passages_etab_idx on devoirs_passages(etablissement_id, devoir);
