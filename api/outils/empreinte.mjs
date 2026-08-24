#!/usr/bin/env node
/* Affiche l'empreinte du code de cette copie, et la compare à celle d'un serveur.
 *
 *   node outils/empreinte.mjs
 *   node outils/empreinte.mjs https://TONCOMPTE.alwaysdata.net
 *
 * Sans argument : l'empreinte locale seulement. Avec une adresse : la compare à ce
 * que renvoie /api/sante, et sort en code 1 si les deux diffèrent — de quoi savoir
 * en une commande si un redéploiement a bien pris.
 */
import { empreinteDuCode, FICHIERS_SUIVIS } from '../version.js';

const locale = empreinteDuCode();
console.log('');
console.log('  Cette copie          : ' + locale);
console.log('  Fichiers pris en compte : ' + FICHIERS_SUIVIS.join(', '));

const adresse = process.argv[2];
if (!adresse) { console.log(''); process.exit(0); }

const url = adresse.replace(/\/+$/, '') + '/api/sante';
let distante;
try {
  const rep = await fetch(url, { cache: 'no-store' });
  const j = await rep.json();
  distante = j.version;
  console.log('  ' + adresse.replace(/^https?:\/\//, '').padEnd(20).slice(0, 20) + ' : ' +
    (distante || '(pas de version — serveur trop ancien)'));
  if (j.demarre) console.log('  Démarré le           : ' + new Date(j.demarre).toLocaleString('fr-FR'));
} catch (e) {
  console.error('\n  Impossible de joindre ' + url + ' : ' + e.message + '\n');
  process.exit(1);
}

const pareil = distante === locale;
console.log('');
console.log(pareil
  ? '  ✓ Le serveur fait tourner exactement ce code.'
  : '  ✗ Le serveur fait tourner un AUTRE code. Redéploie, puis redémarre le site.');
console.log('');
process.exit(pareil ? 0 : 1);
