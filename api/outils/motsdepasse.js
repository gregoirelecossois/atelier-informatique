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
