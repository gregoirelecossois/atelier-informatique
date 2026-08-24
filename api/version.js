/* Empreinte du code réellement déployé.
 *
 * Le code arrive sur le serveur par un simple curl : pas de dépôt Git, donc aucun
 * numéro de version à lire quelque part. Or après chaque redéploiement la question
 * revient — « est-ce bien la nouvelle version qui tourne ? » — et jusqu'ici on ne
 * pouvait y répondre qu'en observant le comportement de l'application.
 *
 * On calcule donc au démarrage une empreinte du code source lui-même. Rien à
 * incrémenter à la main, donc rien qui puisse dériver : deux installations affichent
 * la même empreinte si et seulement si elles font tourner exactement les mêmes
 * fichiers. `outils/empreinte.mjs` recalcule la même valeur depuis n'importe quelle
 * copie, ce qui permet de comparer une machine de travail à /api/sante.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));

/* Tout ce qui décide du comportement du serveur. Le dossier outils/ en est exclu :
   il ne tourne pas dans le service, et un correctif d'outil ne devrait pas laisser
   croire que le serveur a changé. */
export const FICHIERS_SUIVIS = [
  'server.js', 'db.js', 'auth.js', 'comptes.js', 'motsdepasse.js',
  'env.js', 'version.js', 'schema.sql', 'package.json'
];

export function empreinteDuCode(racine = ICI) {
  const h = crypto.createHash('sha256');
  for (const f of FICHIERS_SUIVIS) {
    let contenu;
    try { contenu = fs.readFileSync(path.join(racine, f), 'utf8'); }
    catch { contenu = '(absent)'; }
    /* Fins de ligne normalisées : le dépôt les stocke en LF, une copie de travail
       Windows les a en CRLF. Sans ça, deux copies identiques donneraient deux
       empreintes différentes et la comparaison ne servirait à rien. */
    h.update(f + '\n' + contenu.replace(/\r\n/g, '\n') + '\n');
  }
  return h.digest('hex').slice(0, 12);
}

export const VERSION = empreinteDuCode();
export const DEMARRE = new Date().toISOString();
