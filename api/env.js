/* Charge api/.env s'il existe, sans dépendance.
 *
 * En production chez alwaysdata les variables se règlent dans l'interface d'admin
 * (Environnement du site) et ce fichier ne trouve rien : c'est normal et voulu. Le
 * .env ne sert qu'aux essais en local, et il n'est jamais versionné. Une variable
 * déjà définie dans l'environnement gagne toujours sur le fichier. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fichier = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');

if (fs.existsSync(fichier)) {
  for (const ligne of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const t = ligne.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const cle = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(cle in process.env)) process.env[cle] = val;
  }
}
