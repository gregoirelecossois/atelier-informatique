/* Fabrication des mots de passe — les briques et l'arithmétique.
 *
 * Contrainte : 50 bits d'entropie au minimum (palier « mot de passe + restriction
 * d'accès » de la recommandation CNIL 2022-100), tout en restant recopiable et
 * mémorisable par un élève de 6e.
 *
 * Ces deux exigences tirent en sens inverse, et il n'y a pas d'échappatoire : 50 bits
 * d'information occupent au minimum ~11 caractères tirés au hasard, ou ~18 lettres si
 * on veut que ça se prononce. Le choix par défaut privilégie la mémorisation.
 *
 *   PRONONÇABLE (défaut) : bamito-renuka-vilose
 *     Consonne/voyelle en alternance stricte. 14 consonnes × 5 voyelles = 70 syllabes,
 *     soit 6,13 bits par syllabe ; 9 syllabes → 55,2 bits.
 *     Trois atouts pour des élèves : ça se prononce donc ça se retient ; il n'y a que
 *     des minuscules ; et la POSITION dit si la lettre est une consonne ou une voyelle,
 *     ce qui lève d'avance toute confusion de lecture sur une feuille imprimée.
 *
 *   COURT (--court) : k7fh-m2pq-vr
 *     11 caractères d'un alphabet de 31 sans glyphe ambigu → 54,5 bits.
 *     Deux fois plus court à taper, mais illisible à retenir : pour un adulte qui
 *     doit encore pouvoir le recopier à la main.
 *
 *   COFFRE (défaut pour --prof) : xQ7mBvK2pLnR4dHtWzYs
 *     20 caractères, minuscules, majuscules et chiffres → 119 bits.
 *     Le compte enseignant voit TOUTE la base : c'est le seul qui mérite d'être
 *     attaqué, et le seul dont le mot de passe ne coûte rien à rallonger puisqu'il
 *     vit dans un gestionnaire. Aucune raison d'y économiser des caractères — et
 *     accessoirement, les gestionnaires cessent de le signaler comme faible.
 */

/* Consonnes au son stable en français : ni c (ce/ca), ni g (ge/ga), ni h muet,
   ni q qui traîne son u, ni w/x/y. */
export const CONSONNES = 'bdfjklmnprstvz';   /* 14 */
export const VOYELLES = 'aeiou';             /*  5 */

/* Ni i, ni l, ni o, ni 0/1 : les confusions classiques quand on recopie un code. */
export const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   /* 31 */

/* Alphabet du compte enseignant : majuscules comprises. Aucune contrainte de lecture ni
   de mémorisation — ce mot de passe vit dans un gestionnaire, on le copie-colle. Pas de
   symbole en revanche : il finirait un jour dans une ligne de commande ou un .env, et
   les ennuis de quotage ne valent pas les 4 bits gagnés. */
export const ALPHABET_COFFRE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';   /* 62 */

export const SYLLABES_PAR_GROUPE = 3;   /* 3 syllabes = 6 lettres par groupe */
export const GROUPES = 3;               /* 3 groupes = 9 syllabes = 18 lettres */
export const LONGUEUR_COURT = 11;
export const LONGUEUR_COFFRE = 20;

/* Entropie exacte, en bits — affichée par « atl.mjs entropie » et citée dans le README
   et dans la fiche de registre : mieux vaut un chiffre calculé qu'un chiffre affirmé. */
export const BITS_PRONONCABLE = GROUPES * SYLLABES_PAR_GROUPE * Math.log2(CONSONNES.length * VOYELLES.length);
export const BITS_COURT = LONGUEUR_COURT * Math.log2(ALPHABET.length);
export const BITS_COFFRE = LONGUEUR_COFFRE * Math.log2(ALPHABET_COFFRE.length);

/* --------------------------------------------------------------------------
   Génération. Vit ici plutôt que dans l'outil en ligne de commande depuis que le
   tableau de bord enseignant crée lui aussi des comptes : deux générateurs, c'est
   deux politiques de mots de passe qui divergent le jour où l'une est corrigée.
   -------------------------------------------------------------------------- */
import crypto from 'node:crypto';

const tire = (s) => s[crypto.randomInt(s.length)];

export function generer(type) {
  if (type === 'coffre') {
    return Array.from({ length: LONGUEUR_COFFRE }, () => tire(ALPHABET_COFFRE)).join('');
  }
  if (type === 'court') {
    const c = Array.from({ length: LONGUEUR_COURT }, () => tire(ALPHABET));
    return `${c.slice(0, 4).join('')}-${c.slice(4, 8).join('')}-${c.slice(8).join('')}`;
  }
  const groupes = Array.from({ length: GROUPES }, () =>
    Array.from({ length: SYLLABES_PAR_GROUPE }, () => tire(CONSONNES) + tire(VOYELLES)).join(''));
  return groupes.join('-');
}

/* Qui reçoit quoi : l'enseignant voit toute la base et range son mot de passe dans un
   gestionnaire — aucune raison qu'il hérite d'un mot de passe taillé pour être recopié
   par un élève de 6e. `force` ('court' | 'prononcable') l'emporte sur le rôle. */
export function formePour(role, force) {
  if (force === 'court' || force === 'prononcable' || force === 'coffre') return force;
  return role === 'prof' ? 'coffre' : 'prononcable';
}

/* --------------------------------------------------------------------------
   Le mot de passe CHOISI PAR L'ÉLÈVE (première connexion)

   Le mot de passe fabriqué plus haut est TEMPORAIRE : il voyage sur une feuille
   imprimée, il passe entre les mains de l'enseignant, il traîne parfois dans un
   cahier. À sa première connexion, l'élève en choisit un que personne d'autre ne
   connaît — c'est la condition pour que l'empreinte en base ait un sens.

   Les quatre familles exigées (majuscule, minuscule, chiffre, symbole) ne sont pas
   qu'une case à cocher réglementaire : le N5 du clavier apprend justement à taper
   @ # € + ( ) = _ " et la ponctuation, et cet écran est le premier endroit où ça sert
   pour de vrai.

   ⚠️ Honnêteté sur l'entropie : un mot de passe CHOISI par un humain de 11 ans
   n'atteint pas les ~55 bits d'un mot de passe TIRÉ AU HASARD, même avec quatre
   familles et cette longueur. Ce qui maintient le compte dans le palier « 50 bits avec
   restriction d'accès » de la recommandation CNIL 2022-100, c'est la limitation des
   tentatives (auth.bloque : 10 essais par identifiant sur 10 minutes) — pas la seule
   composition. Le registre de traitement doit dire ça, et pas autre chose.

   MDP_MIN se change ici, et ici seulement : les messages affichés à l'élève comme les
   contrôles serveur en découlent. 12 caractères avec les quatre familles, c'est la
   formulation historique de la CNIL, et c'est un choix de terrain : les élèves de
   l'atelier sont rodés au clavier — ils viennent d'y passer sept niveaux, dont un
   consacré aux symboles. La copie dans scripts/compte.js est à changer en même temps.
   -------------------------------------------------------------------------- */
export const MDP_MIN = 12;
export const MDP_MAX = 128;   /* pas une exigence de sécurité : une borne d'entrée */

/* Les accents comptent comme des lettres, pas comme des symboles : « é » ne doit pas
   passer pour un caractère spécial, sinon la règle ne veut plus rien dire côté élève. */
const A_MAJUSCULE = /[A-ZÀ-ÖØ-Þ]/;
const A_MINUSCULE = /[a-zß-öø-ÿ]/;
const A_CHIFFRE   = /[0-9]/;
const A_SYMBOLE   = /[^0-9A-Za-zÀ-ÖØ-öø-ÿ\s]/;

/* Le libellé est écrit POUR L'ÉLÈVE : c'est ce texte exact qui s'affiche dans la
   fenêtre de création (scripts/compte.js en tient la copie mot pour mot). */
export const REGLES_MDP = [
  { cle: 'longueur',  texte: `au moins ${MDP_MIN} caractères`,      ok: (m) => m.length >= MDP_MIN },
  { cle: 'majuscule', texte: 'une MAJUSCULE',                       ok: (m) => A_MAJUSCULE.test(m) },
  { cle: 'minuscule', texte: 'une minuscule',                       ok: (m) => A_MINUSCULE.test(m) },
  { cle: 'chiffre',   texte: 'un chiffre',                          ok: (m) => A_CHIFFRE.test(m) },
  { cle: 'symbole',   texte: 'un symbole (! ? @ # € + - _ …)',      ok: (m) => A_SYMBOLE.test(m) }
];

/* Renvoie la liste des règles NON respectées, vide si tout va bien. */
export function reglesManquantes(mdp) {
  const m = String(mdp || '');
  return REGLES_MDP.filter((r) => !r.ok(m));
}

/* Lève une erreur lisible par l'élève, ou ne fait rien. Le serveur l'appelle avant
   tout hachage : la fenêtre du navigateur affiche les mêmes règles, mais rien
   n'empêche d'appeler l'API directement. */
export function verifierPolitique(mdp) {
  const m = String(mdp || '');
  if (m.length > MDP_MAX) throw new Error(`Mot de passe trop long (${MDP_MAX} caractères maximum).`);
  if (/\s/.test(m)) throw new Error('Pas d\'espace dans le mot de passe.');
  const manque = reglesManquantes(m);
  if (manque.length) {
    throw new Error('Il manque ' + manque.map((r) => r.texte).join(', ') + '.');
  }
}
