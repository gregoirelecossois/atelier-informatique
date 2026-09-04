/* Accès à PostgreSQL. Une seule réserve de connexions pour tout le processus.
 *
 * Chez alwaysdata la base est jointe par le réseau interne : pas de TLS à prévoir,
 * mais on garde PGSSL=1 sous la main pour un hébergeur qui l'exige. */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));

/* La progression est une colonne jsonb dont toutes les valeurs sont des chaînes :
   node-postgres renvoie les bigint/numeric en texte, on ne veut pas d'autre surprise. */
const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host:     process.env.PGHOST     || 'localhost',
      port:     Number(process.env.PGPORT || 5432),
      user:     process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE
    };

if (process.env.PGSSL === '1') config.ssl = { rejectUnauthorized: false };

/* Peu de connexions : l'hébergement mutualisé en compte un petit nombre au total
   (10 sur le plan gratuit alwaysdata) et une classe entière tient largement dedans,
   les requêtes durant quelques millisecondes. */
config.max = Number(process.env.PGMAX || 6);
config.idleTimeoutMillis = 30_000;
config.connectionTimeoutMillis = 8_000;

export const pool = new pg.Pool(config);

pool.on('error', (e) => { console.error('[db] connexion inactive perdue :', e.message); });

export function q(texte, params) { return pool.query(texte, params); }

export async function une(texte, params) {
  const r = await pool.query(texte, params);
  return r.rows[0] || null;
}

/* Applique schema.sql. Rejouable : tout y est en « if not exists ». */
export async function migrer() {
  const sql = fs.readFileSync(path.join(ICI, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

/* `etablissement` est le cinquième argument et non le premier parce qu'il n'est pas
   toujours connu : une purge automatique ou une commande SSH n'appartiennent à aucun
   collège. Là où il l'est, il doit être passé — c'est ce qui permet de rendre à un chef
   d'établissement le journal de SES données, et rien que celui-là. */
export async function journaliser(acteur, action, cible, details, etablissement) {
  try {
    await pool.query(
      'insert into journal(acteur, action, cible, details, etablissement_id) values ($1,$2,$3,$4,$5)',
      [acteur || null, action, cible || null, details ? JSON.stringify(details) : null,
       etablissement != null ? Number(etablissement) : null]
    );
  } catch (e) {
    /* Le journal ne doit jamais faire échouer l'action qu'il décrit. */
    console.error('[journal]', e.message);
  }
}
