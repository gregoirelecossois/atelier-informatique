#!/usr/bin/env node
/* Amorce tts/.tts-cache à partir des clips DÉJÀ versionnés.
 *
 * À lancer une fois sur un poste où l'on n'a jamais généré d'audio — typiquement en
 * arrivant sur une deuxième machine.
 *
 * Sans ça, le cache intermédiaire est vide (il n'est pas versionné, cf. .gitignore) et
 * la moindre reconstruction régénère tout par edge-tts. Or edge-tts ne rend pas deux
 * fois exactement les mêmes octets : les *.clips.js se retrouvent modifiés d'un bout à
 * l'autre alors que PAS UN TEXTE n'a changé. Plusieurs mégaoctets de diff pour rien, et
 * un hook qui réécrit ces fichiers à chaque édition.
 *
 * Ici on fait le chemin inverse : chaque clip versionné est redécodé vers le cache sous
 * son propre nom. Le cache devient identique au dépôt, et toute reconstruction
 * ultérieure est servie par le cache — donc sans effet.
 *
 * On réécrit AUSSI les manifests, et c'est indispensable : la purge de engine.mjs ne
 * conserve que les clips listés dans le fichier en cours de construction et dans les
 * manifests voisins. Les manifests n'étant pas versionnés non plus, reconstruire un
 * seul fichier sur un poste neuf effacerait du cache l'audio de TOUS les autres — puis
 * les régénérerait un à un. Seules les clés sont lues par la purge, jamais les textes.
 *
 *   node tts/amorcer-cache.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(ICI, '.tts-cache');
fs.mkdirSync(CACHE, { recursive: true });

const MIME_EXT = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a' };

let ecrits = 0, deja = 0, fichiers = 0;

for (const nom of fs.readdirSync(ICI).filter((f) => f.endsWith('.clips.js'))) {
  const src = fs.readFileSync(path.join(ICI, nom), 'utf8');
  const re = /"([A-Za-z0-9_-]+)"\s*:\s*"data:([^;]+);base64,([^"]+)"/g;
  let m, n = 0;

  while ((m = re.exec(src))) {
    const [, cle, mime, b64] = m;
    const ext = MIME_EXT[mime] || 'ogg';
    const dest = path.join(CACHE, cle + '.' + ext);
    const octets = Buffer.from(b64, 'base64');

    /* On ne réécrit que si le contenu diffère : inutile de toucher aux dates de
       fichiers déjà corrects. */
    if (fs.existsSync(dest) && Buffer.compare(fs.readFileSync(dest), octets) === 0) { deja++; }
    else { fs.writeFileSync(dest, octets); ecrits++; }
    n++;
  }
  /* Manifest de protection : la purge n'y lit que les clés. Les textes seront remplis
     par la première vraie reconstruction, qui écrase ce fichier. */
  const base = nom.replace(/\.clips\.js$/, '');
  const manifest = path.join(ICI, base + '.tts-manifest.json');
  if (!fs.existsSync(manifest)) {
    const cles = {};
    src.replace(/"([A-Za-z0-9_-]+)"\s*:\s*"data:/g, (_, k) => { cles[k] = ''; return _; });
    fs.writeFileSync(manifest, JSON.stringify(
      { voice: '(amorcé depuis les clips versionnés)', generatedAt: new Date().toISOString(),
        count: Object.keys(cles).length, keys: cles }, null, 2));
  }

  fichiers++;
  console.log(`  ${nom.padEnd(28)} ${String(n).padStart(4)} clip(s)`);
}

console.log(`\n  ${fichiers} fichier(s) lus — ${ecrits} clip(s) écrits dans le cache, ${deja} déjà conformes.`);
console.log('  Une reconstruction TTS sera désormais servie par le cache, sans rien régénérer.\n');
