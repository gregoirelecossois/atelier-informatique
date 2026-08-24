/* Mots de passe, jetons de session, limitation des tentatives.
 *
 * Hachage : scrypt, fourni par Node lui-même (node:crypto). Choisi pour trois raisons —
 * il figure dans la liste des fonctions admises par la recommandation CNIL 2022-100
 * (avec Argon2, bcrypt et PBKDF2), il ne demande AUCUNE dépendance native (argon2 et
 * bcrypt réclament une compilation qui passe mal sur un hébergement mutualisé), et ses
 * paramètres sont lisibles dans l'empreinte, donc rejouables plus tard.
 *
 * Le « poivre » (POIVRE) est un secret d'application ajouté au mot de passe avant
 * hachage. Il vit dans les variables d'environnement, PAS dans la base : une copie de
 * la base seule ne permet donc aucune attaque par dictionnaire. En contrepartie, le
 * changer invalide TOUS les mots de passe existants. */
import crypto from 'node:crypto';

const N = 32768, R = 8, P = 1, LONGUEUR = 64;
/* 128 * N * r * p = 32 Mio pile : la limite par défaut de Node ferait échouer l'appel. */
const MAXMEM = 96 * 1024 * 1024;
const POIVRE = process.env.POIVRE || '';

function scrypt(mdp, sel) {
  return new Promise((res, rej) => {
    crypto.scrypt(mdp + POIVRE, sel, LONGUEUR, { N, r: R, p: P, maxmem: MAXMEM },
      (e, cle) => (e ? rej(e) : res(cle)));
  });
}

export async function hacher(mdp) {
  const sel = crypto.randomBytes(16);                       /* 128 bits, comme recommandé */
  const cle = await scrypt(mdp, sel);
  return ['scrypt', N, R, P, sel.toString('base64'), cle.toString('base64')].join('$');
}

export async function verifier(mdp, stocke) {
  try {
    const [algo, n, r, p, selB64, cleB64] = String(stocke).split('$');
    if (algo !== 'scrypt') return false;
    const sel = Buffer.from(selB64, 'base64');
    const attendu = Buffer.from(cleB64, 'base64');
    const obtenu = await new Promise((res, rej) => {
      crypto.scrypt(mdp + POIVRE, sel, attendu.length,
        { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM },
        (e, cle) => (e ? rej(e) : res(cle)));
    });
    return obtenu.length === attendu.length && crypto.timingSafeEqual(obtenu, attendu);
  } catch { return false; }
}

/* Identifiant inconnu : on hache quand même dans le vide. Sans cela, la réponse
   revient bien plus vite pour un identifiant inexistant que pour un mot de passe
   faux, ce qui suffit à énumérer les comptes de l'établissement. */
const LEURRE = 'scrypt$32768$8$1$' + Buffer.alloc(16).toString('base64') + '$' + Buffer.alloc(64).toString('base64');
export function perdreDuTemps() { return verifier('x', LEURRE); }

/* --- Jetons de session -----------------------------------------------------
   Le client reçoit `clair` ; la base ne garde que l'empreinte. */
export function nouveauJeton() {
  const clair = crypto.randomBytes(32).toString('base64url');   /* 256 bits */
  return { clair, empreinte: empreinte(clair) };
}
export function empreinte(jeton) {
  return crypto.createHash('sha256').update(String(jeton)).digest('hex');
}

/* --- Limitation des tentatives ---------------------------------------------
   En mémoire : un seul processus sert l'application, et une limite qui disparaît
   au redémarrage reste très largement suffisante face à une attaque en ligne.
   C'est cette limitation qui place les mots de passe élèves dans le palier « 50 bits
   d'entropie avec restriction d'accès » de la recommandation CNIL, plutôt que dans
   le palier « 80 bits » exigé d'un mot de passe laissé sans garde-fou. */
const FENETRE = 10 * 60 * 1000;
const essais = new Map();

function compter(cle, plafond) {
  const t = Date.now();
  const liste = (essais.get(cle) || []).filter((x) => t - x < FENETRE);
  essais.set(cle, liste);
  return liste.length >= plafond;
}

export function bloque(ip, identifiant) {
  return compter('ip:' + ip, 40) || compter('id:' + identifiant, 10);
}

export function noterEchec(ip, identifiant) {
  const t = Date.now();
  for (const cle of ['ip:' + ip, 'id:' + identifiant]) {
    const liste = essais.get(cle) || [];
    liste.push(t);
    essais.set(cle, liste);
  }
}

export function oublier(ip, identifiant) {
  essais.delete('ip:' + ip);
  essais.delete('id:' + identifiant);
}

/* Ménage : sans cela la Map grossit indéfiniment sur un processus qui tourne des mois. */
setInterval(() => {
  const t = Date.now();
  for (const [cle, liste] of essais) {
    const vivants = liste.filter((x) => t - x < FENETRE);
    if (vivants.length) essais.set(cle, vivants); else essais.delete(cle);
  }
}, FENETRE).unref?.();
