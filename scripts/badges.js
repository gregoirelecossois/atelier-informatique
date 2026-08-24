/* Trophées de l'atelier informatique — catalogue, moteur, vitrine et visite guidée.
 *
 * Fichier PARTAGÉ : inclus tel quel par les 6 ateliers ET par index.html, exactement
 * comme tts/tts-atelier.js. Aucune dépendance, aucun build : il injecte son propre CSS
 * et ses propres calques (bannière, popup, vitrine), sans jamais toucher au #modal ni à
 * la mise en page des ateliers — ceux-ci sont verrouillés à 100dvh sans défilement, donc
 * tout ce que ce fichier affiche EN JEU est en position:fixed.
 *
 * Persistance : une seule clé `badges_v1` dans scripts/store.js (donc synchronisée
 * avec le compte de l'élève quand il y en a un), sans préfixe d'atelier — les
 * trophées sont transversaux. Chaque entrée vaut {t:<horodatage>} et, pour les boss à
 * modes, {t:…, d:'<clé de difficulté>'} : rejouer un boss dans un mode PLUS DUR met le
 * trophée à niveau au lieu d'être ignoré (cf. award()).
 *
 * API publique (window.Badges) :
 *   award(id, {diff, then}) décerne / améliore un trophée. Renvoie 'new' | 'up' | false.
 *   isFirstEver()       vrai tant qu'aucun trophée n'a été gagné : l'atelier sait ainsi
 *                       que le prochain va ouvrir la grande popup du 1er trophée, et lui
 *                       confie son bouton « suite » (opts.then) au lieu d'empiler la sienne.
 *   has(id) / get(id) / count() / all()
 *   renderShowcase(el)  peint la vitrine complète dans un conteneur.
 *   runTour()           défilement + surbrillance + bulle d'aide (page d'accueil).
 *   reset()             remise à zéro (utilisée par le « Reset complet » du devkit).
 */
window.Badges = (function(){
'use strict';

var KEY='badges_v1', TOUR_KEY='badges_tour_seen', HOME='index.html';
var Z=2147482000;   /* au-dessus de tous les calques des ateliers */

/* ---------------------------------------------------------------------------
   1. Échelles de difficulté des boss
   Chaque échelle est ORDONNÉE du plus facile au plus dur : c'est l'index dans ce
   tableau qui fait foi pour décider si une nouvelle victoire améliore le trophée.
   Les clés reprennent telles quelles celles déjà stockées par chaque atelier
   (ms_bossmode, kb_bossmode, _corrDiffKey, nv_bossmode).
   --------------------------------------------------------------------------- */
var SCALES={
  ms:[{k:'easy',n:'Facile',ic:'🛡️'},{k:'medium',n:'Moyen',ic:'⚔️'},{k:'hard',n:'Difficile',ic:'🔥'},{k:'extreme',n:'Extrême',ic:'💀'}],
  kb:[{k:'easy',n:'Facile',ic:'🛡️'},{k:'medium',n:'Moyen',ic:'💾'},{k:'hard',n:'Difficile',ic:'🔥'},{k:'extreme',n:'Extrême',ic:'💀'}],
  df:[{k:'easy',n:'Facile',ic:'🛡️'},{k:'medium',n:'Moyen',ic:'⚔️'},{k:'hard',n:'Difficile',ic:'🔥'}],
  nv:[{k:'tranquille',n:'Tranquille',ic:'🛡️'},{k:'normal',n:'Normal',ic:'⚔️'},{k:'heroique',n:'Héroïque',ic:'🔥'}]
};
function rank(scale,key){
  var s=SCALES[scale]; if(!s) return -1;
  for(var i=0;i<s.length;i++) if(s[i].k===key) return i;
  return -1;
}
function diffMeta(scale,key){
  var s=SCALES[scale]||[], i=rank(scale,key);
  return i<0?null:s[i];
}

/* ---------------------------------------------------------------------------
   2. Ateliers (ordre d'affichage dans la vitrine) et métaux de rareté
   --------------------------------------------------------------------------- */
var WS={
  ms  :{n:'La souris',              ic:'🖱️', hue:'#2563eb'},
  kb  :{n:'Le clavier',             ic:'⌨️', hue:'#7c3aed'},
  tt  :{n:'Traitement de texte',    ic:'📝', hue:'#dc2626'},
  df  :{n:'Dossiers et fichiers',   ic:'🗂️', hue:'#d97706'},
  nv  :{n:'Naviguer sur internet',  ic:'🌐', hue:'#0891b2'},
  ml  :{n:'La messagerie',          ic:'✉️', hue:'#16a34a'},
  meta:{n:'Trophées d\'honneur',    ic:'🏆', hue:'#7c6cf5'}
};
var WS_ORDER=['ms','kb','tt','df','nv','ml','meta'];
var TIERS={
  bronze :{n:'Bronze', c:'#c1743a', pip:'B'},
  argent :{n:'Argent', c:'#8ea3b8', pip:'A'},
  or     :{n:'Or',     c:'#e0a416', pip:'O'},
  platine:{n:'Platine',c:'#7c6cf5', pip:'P'}
};

/* ---------------------------------------------------------------------------
   3. Le catalogue — 60 trophées
   id      identifiant stable (ne jamais renommer : c'est la clé de sauvegarde)
   ws      atelier de rattachement (groupe dans la vitrine)
   tier    métal
   ic      emoji de la médaille
   n       nom affiché
   how     ce qu'il faut faire (montré au survol, débloqué ou non)
   scale   pour les boss à modes : quelle échelle de difficulté afficher
   secret  masqué tant qu'il n'est pas gagné
   meta    fonction de vérification automatique (trophées transversaux)
   --------------------------------------------------------------------------- */
var LIST=[
  /* --- A. Ateliers terminés (or) --- */
  {id:'ms.master', ws:'ms', tier:'or', ic:'🖱️', n:'Souris en main',        how:'Terminer les 7 niveaux de La souris.'},
  {id:'kb.master', ws:'kb', tier:'or', ic:'⌨️', n:'Dix doigts',            how:'Terminer les 7 niveaux du Clavier.'},
  {id:'tt.master', ws:'tt', tier:'or', ic:'📝', n:'Plume numérique',       how:'Terminer les 7 niveaux du Traitement de texte.'},
  {id:'df.master', ws:'df', tier:'or', ic:'🗂️', n:'Rangement impeccable',  how:'Terminer les 9 niveaux de Dossiers et fichiers.'},
  {id:'nv.master', ws:'nv', tier:'or', ic:'🌐', n:'Explorateur du web',    how:'Terminer les 9 niveaux de Naviguer sur internet.'},
  {id:'ml.master', ws:'ml', tier:'or', ic:'✉️', n:'Boîte bien tenue',      how:'Terminer les 9 niveaux de La messagerie.'},

  /* --- B. Boss vaincus (argent) — le palier de difficulté s'affiche et se met à jour --- */
  {id:'boss.gruk',      ws:'ms', tier:'argent', ic:'👑', n:'Gruk terrassé',          how:'Vaincre Gruk, le Démon Gardien (niveau 7).', scale:'ms'},
  {id:'boss.mere',      ws:'kb', tier:'argent', ic:'🛸', n:'Vaisseau-Mère abattu',   how:'Vaincre le Vaisseau-Mère (niveau 5).', scale:'kb'},
  {id:'boss.kortex',    ws:'kb', tier:'argent', ic:'🐉', n:'K0RT3X effacé',          how:'Vaincre K0RT3X (niveau 7).', scale:'kb'},
  {id:'boss.corruptus', ws:'df', tier:'argent', ic:'🦠', n:'CORRUPTUS purgé',        how:'Vaincre CORRUPTUS (niveau 9).', scale:'df'},
  {id:'boss.popzilla',  ws:'nv', tier:'argent', ic:'🪟', n:'POPZILLA écrasé',        how:'Vaincre POPZILLA (niveau 5).', scale:'nv'},
  {id:'boss.infox',     ws:'nv', tier:'argent', ic:'👾', n:'INFOX démasqué',         how:'Vaincre INFOX (niveau 9).', scale:'nv'},
  {id:'boss.phisher',   ws:'ml', tier:'argent', ic:'🎣', n:'LE PHISHER harponné',    how:'Vaincre LE PHISHER (niveau 9).'},

  /* --- C. Boss en difficulté maximale (or) --- */
  {id:'hard.gruk',      ws:'ms', tier:'or', ic:'🔥', n:'Gruk en Extrême',            how:'Battre Gruk en difficulté Extrême.'},
  {id:'hard.mere',      ws:'kb', tier:'or', ic:'💥', n:'Vaisseau-Mère en Extrême',   how:'Battre le Vaisseau-Mère en difficulté Extrême.'},
  {id:'hard.kortex',    ws:'kb', tier:'or', ic:'⚡', n:'K0RT3X en Extrême',          how:'Battre K0RT3X en difficulté Extrême.'},
  {id:'hard.corruptus', ws:'df', tier:'or', ic:'🧪', n:'CORRUPTUS en Difficile',     how:'Battre CORRUPTUS en difficulté Difficile.'},
  {id:'hard.popzilla',  ws:'nv', tier:'or', ic:'🥊', n:'POPZILLA en Héroïque',       how:'Battre POPZILLA en mode Héroïque.'},
  {id:'hard.infox',     ws:'nv', tier:'or', ic:'🎖️', n:'INFOX en Héroïque',          how:'Battre INFOX en mode Héroïque.'},
  {id:'hard.phisher',   ws:'ml', tier:'or', ic:'🛡️', n:'Sans une fuite',             how:'Battre LE PHISHER sans jamais faire tomber la Sécurité réseau sous la moitié.'},

  /* --- D. Niveaux-clés (bronze) — 3 par atelier --- */
  {id:'ms.l3', ws:'ms', tier:'bronze', ic:'🚪', n:'Double-clic éclair',       how:'Terminer le niveau 3, Le double-clic.'},
  {id:'ms.l5', ws:'ms', tier:'bronze', ic:'🔲', n:'Lasso d\'or',              how:'Terminer le niveau 5, Sélectionner.'},
  {id:'ms.l6', ws:'ms', tier:'bronze', ic:'🎡', n:'Molette maîtrisée',        how:'Terminer le niveau 6, La molette.'},
  {id:'kb.l3', ws:'kb', tier:'bronze', ic:'🔤', n:'Chasseur d\'accents',      how:'Terminer le niveau 3, les accents.'},
  {id:'kb.l4', ws:'kb', tier:'bronze', ic:'🔢', n:'Pluie de chiffres',        how:'Terminer le niveau 4, les chiffres.'},
  {id:'kb.l6', ws:'kb', tier:'bronze', ic:'⌛', n:'Doigts de fée',            how:'Terminer le niveau 6, L\'épave, et ses 9 missions de frappe.'},
  {id:'tt.l4', ws:'tt', tier:'bronze', ic:'✨', n:'Magicien des raccourcis',  how:'Terminer le niveau 4, Le clavier magique.'},
  {id:'tt.l6', ws:'tt', tier:'bronze', ic:'📊', n:'Architecte de tableaux',   how:'Terminer le niveau 6, Les tableaux.'},
  {id:'tt.l7', ws:'tt', tier:'bronze', ic:'🖼️', n:'Metteur en page',          how:'Terminer le niveau 7, Images et Objets, et ses 24 missions.'},
  {id:'df.l4', ws:'df', tier:'bronze', ic:'📦', n:'Grand déménagement',       how:'Terminer le niveau 4, Ranger : déplacer et copier.'},
  {id:'df.l5', ws:'df', tier:'bronze', ic:'♻️', n:'Sauveteur de la corbeille',how:'Terminer le niveau 5, Supprimer et la corbeille.'},
  {id:'df.l7', ws:'df', tier:'bronze', ic:'🔍', n:'Décodeur d\'extensions',   how:'Terminer le niveau 7, Les extensions de fichiers.'},
  {id:'nv.l3', ws:'nv', tier:'bronze', ic:'🔎', n:'Fin limier',               how:'Terminer le niveau 3, Chercher sur internet.'},
  {id:'nv.l6', ws:'nv', tier:'bronze', ic:'🔒', n:'Détecteur de pièges',      how:'Terminer le niveau 6, Sécurité et fiabilité.'},
  {id:'nv.l8', ws:'nv', tier:'bronze', ic:'🔑', n:'Coffre-fort vivant',       how:'Terminer le niveau 8, Les mots de passe.'},
  {id:'ml.l2', ws:'ml', tier:'bronze', ic:'📬', n:'À, Cc et Cci',             how:'Terminer le niveau 2, À, Cc et Cci.'},
  {id:'ml.l4', ws:'ml', tier:'bronze', ic:'📎', n:'Roi du trombone',          how:'Terminer le niveau 4, Les pièces jointes.'},
  {id:'ml.l8', ws:'ml', tier:'bronze', ic:'📅', n:'Maître du temps',          how:'Terminer le niveau 8, L\'agenda.'},

  /* --- E. Perfection (argent) — 2 par atelier --- */
  {id:'ms.perf1',   ws:'ms', tier:'argent', ic:'🎯', n:'Sans une aide',          how:'Terminer un niveau de La souris sans jamais activer Plus facile.'},
  {id:'ms.perfAll', ws:'ms', tier:'argent', ic:'🌠', n:'Souris parfaite',        how:'Terminer TOUS les niveaux de La souris sans jamais activer Plus facile.'},
  {id:'kb.perf1',   ws:'kb', tier:'argent', ic:'🎯', n:'Frappe nette',           how:'Terminer un niveau du Clavier sans jamais activer Plus facile.'},
  {id:'kb.perfAll', ws:'kb', tier:'argent', ic:'🌠', n:'Clavier parfait',        how:'Terminer TOUS les niveaux du Clavier sans jamais activer Plus facile.'},
  {id:'tt.perf1',   ws:'tt', tier:'argent', ic:'✅', n:'Copie parfaite',         how:'Terminer un niveau du Traitement de texte sans une seule erreur.'},
  {id:'tt.perfAll', ws:'tt', tier:'argent', ic:'🌠', n:'Zéro rature',            how:'Terminer TOUS les niveaux du Traitement de texte sans une seule erreur.'},
  {id:'df.perf1',   ws:'df', tier:'argent', ic:'🧭', n:'Rangement au cordeau',   how:'Terminer un niveau de Dossiers et fichiers sans une seule erreur.'},
  {id:'df.perfAll', ws:'df', tier:'argent', ic:'🌠', n:'Tout à sa place',        how:'Terminer TOUS les niveaux de Dossiers et fichiers sans une seule erreur.'},
  {id:'nv.perf1',   ws:'nv', tier:'argent', ic:'⭐', n:'Niveau trois étoiles',   how:'Décrocher 3 étoiles à toutes les missions d\'un niveau de Naviguer sur internet.'},
  {id:'nv.perfAll', ws:'nv', tier:'argent', ic:'🌠', n:'Web trois étoiles',      how:'Décrocher 3 étoiles partout, dans les 9 niveaux de Naviguer sur internet.'},
  {id:'ml.perf1',   ws:'ml', tier:'argent', ic:'⭐', n:'Boîte trois étoiles',    how:'Décrocher 3 étoiles à toutes les missions d\'un niveau de La messagerie.'},
  {id:'ml.perfAll', ws:'ml', tier:'argent', ic:'🌠', n:'Messagerie sans faute',  how:'Décrocher 3 étoiles partout, dans les 9 niveaux de La messagerie.'},

  /* --- F. Transversaux et secrets --- */
  /* Décerné par le levelComplete() des 6 ateliers : c'est donc, pour presque tout élève,
     le tout premier trophée gagné — et c'est lui qui déclenche la découverte de la vitrine. */
  {id:'meta.first',   ws:'meta', tier:'bronze',  ic:'🌱', n:'Premiers pas',          how:'Terminer ton tout premier niveau, dans n\'importe quel atelier.'},

  /* les suivants (platine) sont décernés automatiquement, sans appel depuis les ateliers */
  {id:'meta.5',       ws:'meta', tier:'platine', ic:'🥉', n:'Collectionneur',        how:'Gagner 5 trophées.',
   meta:function(s){ return countReal(s)>=5; }},
  {id:'meta.15',      ws:'meta', tier:'platine', ic:'🥈', n:'Chasseur de trophées',  how:'Gagner 15 trophées.',
   meta:function(s){ return countReal(s)>=15; }},
  {id:'meta.30',      ws:'meta', tier:'platine', ic:'🥇', n:'Vitrine bien remplie',  how:'Gagner 30 trophées.',
   meta:function(s){ return countReal(s)>=30; }},
  {id:'meta.50',      ws:'meta', tier:'platine', ic:'💎', n:'Légende de l\'atelier', how:'Gagner 50 trophées.',
   meta:function(s){ return countReal(s)>=50; }},
  {id:'meta.3ate',    ws:'meta', tier:'platine', ic:'🎓', n:'Triple diplôme',        how:'Terminer trois ateliers en entier.',
   meta:function(s){ return nMasters(s)>=3; }},
  {id:'meta.allboss', ws:'meta', tier:'platine', ic:'⚔️', n:'Tombeur de boss',       how:'Vaincre les 7 boss de l\'atelier.',
   meta:function(s){ return every(BOSS_IDS,s); }},
  {id:'meta.allhard', ws:'meta', tier:'platine', ic:'💀', n:'Sans peur',             how:'Vaincre chaque boss à sa difficulté maximale.',
   meta:function(s){ return every(HARD_IDS,s); }},
  {id:'meta.100',     ws:'meta', tier:'platine', ic:'👑', n:'Champion de l\'atelier',how:'Terminer les six ateliers en entier.',
   meta:function(s){ return nMasters(s)>=6; }},
  {id:'meta.tts',     ws:'meta', tier:'platine', ic:'🔊', n:'Grandes oreilles',      how:'Écouter un tutoriel en cliquant sur le haut-parleur.'},
  {id:'secret.goupil',ws:'meta', tier:'platine', ic:'🦊', n:'Ami du renard',         how:'Trophée secret — à découvrir en explorant Goupil.', secret:true}
];

var BY_ID={}; LIST.forEach(function(d){ BY_ID[d.id]=d; });
var BOSS_IDS=['boss.gruk','boss.mere','boss.kortex','boss.corruptus','boss.popzilla','boss.infox','boss.phisher'];
var HARD_IDS=['hard.gruk','hard.mere','hard.kortex','hard.corruptus','hard.popzilla','hard.infox','hard.phisher'];
var MASTER_IDS=['ms.master','kb.master','tt.master','df.master','nv.master','ml.master'];

function every(ids,s){ for(var i=0;i<ids.length;i++) if(!s[ids[i]]) return false; return true; }
function nMasters(s){ var n=0; MASTER_IDS.forEach(function(id){ if(s[id]) n++; }); return n; }
/* Les paliers de collection comptent les trophées « gagnés sur le terrain » : sans cela,
   décerner meta.5 ferait immédiatement grimper le total et pourrait enchaîner meta.15. */
function countReal(s){ var n=0; for(var k in s){ if(s.hasOwnProperty(k) && BY_ID[k] && !BY_ID[k].meta) n++; } return n; }

/* ---------------------------------------------------------------------------
   4. Persistance
   --------------------------------------------------------------------------- */
function load(){ try{ return JSON.parse(Store.get(KEY)||'{}')||{}; }catch(e){ return {}; } }
function save(o){ Store.set(KEY, JSON.stringify(o)); }
function flag(k){ return Store.get(k)==='1'; }
function setFlag(k){ Store.set(k,'1'); }

/* ---------------------------------------------------------------------------
   5. Attribution
   --------------------------------------------------------------------------- */
var checking=false;

function award(id, opts){
  var def=BY_ID[id]; if(!def) return false;
  opts=opts||{};
  var st=load(), cur=st[id], res=null;

  if(def.scale && opts.diff){
    var r=rank(def.scale, opts.diff);
    if(r<0) return false;                                  /* clé de mode inconnue */
    if(cur){
      if(r<=rank(def.scale, cur.d)) return false;          /* pas mieux qu'avant */
      cur.d=opts.diff; cur.t=Date.now(); res='up';
    } else {
      st[id]={t:Date.now(), d:opts.diff}; res='new';
    }
  } else {
    if(cur) return false;
    st[id]={t:Date.now()}; res='new';
  }
  save(st);

  var first = res==='new' && !flag('badges_seen_first');
  if(first) setFlag('badges_seen_first');
  announce(def, st[id], res, first, first?opts.then:null);
  checkMeta();
  return res;
}

/* Vrai tant qu'aucun trophée n'a jamais été gagné. À interroger JUSTE avant award() :
   l'atelier sait alors que ce trophée-ci ouvrira la grande popup du premier trophée. */
function isFirstEver(){ return !flag('badges_seen_first'); }

/* Réévalue les trophées transversaux après chaque attribution. */
function checkMeta(){
  if(checking) return; checking=true;
  try{
    var st=load(), again=true, guard=0;
    while(again && guard++<8){
      again=false;
      for(var i=0;i<LIST.length;i++){
        var d=LIST[i];
        if(!d.meta || st[d.id]) continue;
        if(d.meta(st)){
          st[d.id]={t:Date.now()}; save(st);
          announce(d, st[d.id], 'new', false);
          again=true;
        }
      }
    }
  } finally { checking=false; }
}

function get(id){ return load()[id]||null; }
function has(id){ return !!load()[id]; }
function count(){ var s=load(), n=0; for(var k in s) if(s.hasOwnProperty(k)&&BY_ID[k]) n++; return n; }
function all(){ return load(); }
function reset(){ Store.del(KEY); Store.del(TOUR_KEY); Store.del('badges_seen_first'); }

/* ---------------------------------------------------------------------------
   6. Styles (injectés une fois, préfixe bdg- pour ne rien percuter)
   --------------------------------------------------------------------------- */
function css(){
  if(document.getElementById('bdg-style')) return;
  var s=document.createElement('style'); s.id='bdg-style';
  s.textContent=[
  '.bdg-medal{position:relative;width:74px;height:74px;border-radius:50%;flex:none;display:flex;',
  '  align-items:center;justify-content:center;font-size:1.95rem;line-height:1;',
  '  background:radial-gradient(circle at 34% 28%,color-mix(in srgb,var(--bdg-hue) 26%,#fff) 0%,color-mix(in srgb,var(--bdg-hue) 62%,#fff) 100%);',
  '  box-shadow:0 0 0 4px var(--bdg-metal),0 0 0 5px rgba(255,255,255,.85),0 7px 16px -8px rgba(34,48,63,.55);',
  '  transition:transform .18s ease;}',
  '.bdg-medal .bdg-pip{position:absolute;right:-3px;bottom:-3px;width:22px;height:22px;border-radius:50%;',
  '  background:var(--bdg-metal);border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;',
  '  font-size:.62rem;font-weight:800;color:#fff;font-family:inherit;}',
  '.bdg-medal.lk{background:#e4eaf1;box-shadow:0 0 0 3px #ccd7e3;color:#a8b8c8;font-size:1.6rem;}',
  '.bdg-item{position:relative;display:flex;flex-direction:column;align-items:center;gap:7px;width:104px;text-align:center;}',
  '.bdg-item:hover .bdg-medal,.bdg-item:focus-visible .bdg-medal{transform:translateY(-5px) scale(1.04);}',
  '.bdg-item:focus-visible{outline:none;}',
  '.bdg-item:focus-visible .bdg-medal{box-shadow:0 0 0 4px var(--bdg-metal),0 0 0 8px #2563eb;}',
  '.bdg-item .bdg-nm{font-weight:800;font-size:.77rem;line-height:1.25;color:#22303f;}',
  '.bdg-item.lk .bdg-nm{color:#8496a8;}',
  '.bdg-item .bdg-df{font-weight:800;font-size:.68rem;line-height:1;color:#5a6b7b;background:#eef3f9;',
  '  border:1px solid #d7e0ea;border-radius:999px;padding:3px 8px;}',
  '.bdg-item .bdg-tip{position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%) translateY(4px);',
  '  width:230px;background:#22303f;color:#f2f7fc;border-radius:11px;padding:10px 13px;font-size:.78rem;line-height:1.45;',
  '  text-align:left;opacity:0;pointer-events:none;transition:opacity .16s ease,transform .16s ease;z-index:30;font-weight:600;}',
  '.bdg-item .bdg-tip b{display:block;font-size:.85rem;margin-bottom:3px;}',
  '.bdg-item .bdg-tip i{display:block;margin-top:5px;color:#a9c0d6;font-style:normal;font-size:.73rem;}',
  '.bdg-item .bdg-tip::after{content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);',
  '  border:7px solid transparent;border-top-color:#22303f;}',
  '.bdg-item:hover .bdg-tip,.bdg-item:focus-visible .bdg-tip{opacity:1;transform:translateX(-50%) translateY(0);}',

  /* --- bannière de déblocage (en jeu, toujours flottante) --- */
  '.bdg-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-140%);z-index:'+Z+';',
  '  display:flex;align-items:center;gap:14px;background:#fff;border:2px solid var(--bdg-metal);border-radius:18px;',
  '  padding:12px 20px 12px 14px;box-shadow:0 16px 40px rgba(34,48,63,.3);max-width:92vw;',
  '  font-family:inherit;transition:transform .45s cubic-bezier(.2,1.3,.4,1);}',
  '.bdg-toast.in{transform:translateX(-50%) translateY(0);}',
  '.bdg-toast .bdg-medal{width:56px;height:56px;font-size:1.5rem;}',
  '.bdg-toast .bdg-medal .bdg-pip{width:18px;height:18px;font-size:.55rem;}',
  '.bdg-toast .tx{display:flex;flex-direction:column;gap:2px;min-width:0;}',
  '.bdg-toast .kk{font-weight:800;font-size:.7rem;letter-spacing:.07em;text-transform:uppercase;color:var(--bdg-metal);}',
  '.bdg-toast .nn{font-weight:800;font-size:1.02rem;color:#22303f;}',
  '.bdg-toast .ss{font-weight:700;font-size:.78rem;color:#5a6b7b;}',

  /* --- popup du tout premier trophée --- */
  '.bdg-back{position:fixed;inset:0;z-index:'+(Z+1)+';background:rgba(20,30,42,.62);display:flex;',
  '  align-items:center;justify-content:center;padding:22px;opacity:0;transition:opacity .25s ease;}',
  '.bdg-back.in{opacity:1;}',
  '.bdg-pop{position:relative;background:#fff;border-radius:24px;padding:30px 30px 26px;max-width:520px;width:100%;',
  '  text-align:center;box-shadow:0 26px 60px rgba(0,0,0,.4);font-family:inherit;color:#22303f;',
  '  transform:scale(.9);transition:transform .3s cubic-bezier(.2,1.3,.4,1);}',
  '.bdg-back.in .bdg-pop{transform:scale(1);}',
  '.bdg-pop h2{font-size:1.5rem;font-weight:800;margin:14px 0 8px;}',
  '.bdg-pop p{font-size:1rem;color:#5a6b7b;font-weight:600;margin:0 0 10px;line-height:1.55;}',
  '.bdg-pop .bdg-medal{margin:0 auto;width:88px;height:88px;font-size:2.3rem;}',
  '.bdg-pop .acts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px;}',
  '.bdg-pop .acts a,.bdg-pop .acts button{font-family:inherit;font-weight:800;font-size:.95rem;border-radius:999px;',
  '  padding:12px 22px;cursor:pointer;border:2px solid #d7e0ea;background:#fff;color:#5a6b7b;text-decoration:none;}',
  '.bdg-pop .acts .go{background:#2563eb;border-color:#2563eb;color:#fff;}',
  '.bdg-pop .acts .go:hover{background:#1d4ed8;border-color:#1d4ed8;}',
  '.bdg-pop .acts button:hover,.bdg-pop .acts .ghost:hover{border-color:#2563eb;color:#1d4ed8;}',

  /* --- vitrine (page d'accueil) --- */
  '.bdg-case{background:#fff;border:2px solid #d7e0ea;border-radius:22px;padding:24px 22px 26px;',
  '  display:flex;flex-direction:column;gap:20px;scroll-margin-top:24px;transition:border-color .3s,box-shadow .3s;}',
  '.bdg-case.spot{border-color:#e0a416;box-shadow:0 0 0 5px rgba(224,164,22,.24),0 0 44px -6px rgba(224,164,22,.5);}',
  '.bdg-case .hd{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:10px;}',
  '.bdg-case .hd h2{margin:0;font-size:1.35rem;font-weight:700;}',
  '.bdg-case .hd .ct{font-weight:800;font-size:.95rem;color:#5a6b7b;font-variant-numeric:tabular-nums;}',
  '.bdg-case .pr{height:9px;border-radius:999px;background:#eef3f9;border:1px solid #d7e0ea;overflow:hidden;}',
  '.bdg-case .pr i{display:block;height:100%;background:linear-gradient(90deg,#e0a416,#7c6cf5);transition:width .6s ease;}',
  '.bdg-grp{display:flex;flex-direction:column;gap:11px;}',
  '.bdg-grp .gt{font-weight:800;font-size:.84rem;color:var(--bdg-hue);text-transform:uppercase;letter-spacing:.05em;}',
  '.bdg-row{display:flex;flex-wrap:wrap;gap:18px 10px;}',

  /* --- bulle de la visite guidée ---
     Elle se place AU-DESSUS de la vitrine, la queue pointant vers le bas : la vitrine
     fait près de 1500 px de haut, une bulle placée dessous serait hors écran. */
  '.bdg-bub{position:relative;background:#fff;border:2px solid #e0a416;border-radius:16px;padding:17px 19px;',
  '  max-width:440px;margin:0 0 22px;display:flex;flex-direction:column;gap:8px;font-family:inherit;color:#22303f;',
  '  scroll-margin-top:26px;}',
  '.bdg-bub::before{content:"";position:absolute;top:100%;left:44px;border:11px solid transparent;border-top-color:#e0a416;}',
  '.bdg-bub::after{content:"";position:absolute;top:100%;left:44px;margin-top:-3px;border:11px solid transparent;border-top-color:#fff;}',
  '.bdg-bub h3{margin:0;font-size:1.05rem;font-weight:800;}',
  '.bdg-bub p{margin:0;font-size:.9rem;color:#5a6b7b;font-weight:600;line-height:1.5;}',
  '.bdg-bub .ok{align-self:flex-start;margin-top:4px;background:#2563eb;color:#fff;border:none;border-radius:999px;',
  '  padding:9px 22px;font-family:inherit;font-weight:800;font-size:.88rem;cursor:pointer;}',
  '.bdg-bub .ok:hover{background:#1d4ed8;}',

  '@media (prefers-reduced-motion:reduce){.bdg-toast,.bdg-pop,.bdg-back,.bdg-medal,.bdg-case .pr i{transition:none!important;}}',
  '@media (max-width:560px){.bdg-item{width:88px;}.bdg-medal{width:62px;height:62px;font-size:1.65rem;}',
  '  .bdg-item .bdg-tip{width:186px;}}'
  ].join('\n');
  document.head.appendChild(s);
}

/* ---------------------------------------------------------------------------
   7. Rendu d'une médaille
   --------------------------------------------------------------------------- */
function medalHtml(def, entry, opts){
  opts=opts||{};
  var lk=!entry, tier=TIERS[def.tier], hue=(WS[def.ws]||WS.meta).hue;
  var glyph = lk ? '🔒' : def.ic;
  return '<div class="bdg-medal'+(lk?' lk':'')+'" style="--bdg-hue:'+hue+';--bdg-metal:'+tier.c+'">'
    + glyph + (lk?'':'<span class="bdg-pip">'+tier.pip+'</span>') + '</div>';
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function itemHtml(def, entry){
  var lk=!entry, tier=TIERS[def.tier], hue=(WS[def.ws]||WS.meta).hue;
  var hidden = lk && def.secret;
  var name = hidden ? 'Trophée secret' : def.n;
  var how  = hidden ? 'À découvrir en explorant l\'atelier.' : def.how;

  var chip='', extra='';
  if(entry && def.scale && entry.d){
    var dm=diffMeta(def.scale, entry.d);
    if(dm){
      chip='<span class="bdg-df">'+dm.ic+' '+dm.n+'</span>';
      var sc=SCALES[def.scale], r=rank(def.scale, entry.d);
      extra = (r < sc.length-1)
        ? 'Battu en '+dm.n+'. Rebats-le en '+sc[r+1].n+' pour faire monter ce trophée.'
        : 'Battu au mode le plus dur. Rien au-dessus !';
    }
  }
  if(entry && !extra){
    extra='Gagné le '+new Date(entry.t).toLocaleDateString('fr-FR')+'.';
  }

  return '<div class="bdg-item'+(lk?' lk':'')+'" tabindex="0" style="--bdg-hue:'+hue+';--bdg-metal:'+tier.c+'">'
    + medalHtml(def, entry)
    + '<span class="bdg-nm">'+esc(name)+'</span>'
    + chip
    + '<span class="bdg-tip"><b>'+esc(name)+'</b>'+esc(how)+(extra?'<i>'+esc(extra)+'</i>':'')+'</span>'
    + '</div>';
}

/* ---------------------------------------------------------------------------
   8. Bannière de déblocage / d'amélioration
   --------------------------------------------------------------------------- */
var queue=[], showing=false;

function announce(def, entry, res, first, then){
  css();
  queue.push({def:def, entry:entry, res:res, first:first, then:then});
  pump();
}
function pump(){
  if(showing || !queue.length) return;
  showing=true;
  var it=queue.shift();
  var t=document.createElement('div');
  t.className='bdg-toast';
  t.style.setProperty('--bdg-metal', TIERS[it.def.tier].c);
  var sub='';
  if(it.def.scale && it.entry.d){
    var dm=diffMeta(it.def.scale, it.entry.d);
    if(dm) sub=dm.ic+' '+dm.n;
  }
  t.innerHTML = medalHtml(it.def, it.entry)
    + '<span class="tx"><span class="kk">'+(it.res==='up'?'Trophée amélioré':'Trophée débloqué')+'</span>'
    + '<span class="nn">'+esc(it.def.n)+'</span>'
    + (sub?'<span class="ss">'+esc(sub)+'</span>':'')+'</span>';
  document.body.appendChild(t);
  ding(it.res==='up');
  requestAnimationFrame(function(){ t.classList.add('in'); });
  setTimeout(function(){
    t.classList.remove('in');
    setTimeout(function(){
      if(t.parentNode) t.parentNode.removeChild(t);
      showing=false;
      if(it.first) setTimeout(function(){ firstPopup(it.def, it.entry, it.then); }, 240);
      pump();
    }, 480);
  }, 3600);
}

/* Petit son de trophée — indépendant du moteur audio de chaque atelier. */
function ding(up){
  try{
    var C=window.AudioContext||window.webkitAudioContext; if(!C) return;
    var ac=ding._ac||(ding._ac=new C());
    if(ac.state==='suspended') ac.resume();
    var notes = up ? [660,880] : [523.25,659.25,783.99,1046.5];
    notes.forEach(function(f,i){
      var o=ac.createOscillator(), g=ac.createGain(), t=ac.currentTime+i*0.11;
      o.type='triangle'; o.frequency.setValueAtTime(f,t);
      g.gain.setValueAtTime(0.0001,t);
      g.gain.exponentialRampToValueAtTime(0.13,t+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.34);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t+0.36);
    });
  }catch(e){}
}

/* ---------------------------------------------------------------------------
   9. Popup du tout premier trophée
   --------------------------------------------------------------------------- */
var FIRST_TEXT='Bravo, tu as gagné ton premier trophée ! Chaque trophée récompense une réussite : '
  + 'finir un niveau difficile, battre un boss, ou terminer un atelier en entier. '
  + 'Ils sont tous rangés dans ta vitrine, en bas de la page d\'accueil. Va la découvrir !';

function firstPopup(def, entry, then){
  css();
  var back=document.createElement('div'); back.className='bdg-back';
  var pop=document.createElement('div'); pop.className='bdg-pop';
  /* `then` : l'atelier nous a confié son propre bouton « suite » (typiquement « Aller au
     Niveau 2 »). On le porte donc ICI, et l'atelier n'ouvre pas sa popup — sans quoi
     l'élève enchaînerait deux fenêtres et en fermerait forcément une sans la lire. */
  var acts = then
    ? '<a class="ghost" href="'+HOME+'?vitrine=1">🏆 Voir ma vitrine</a>'
      + '<button type="button" class="go next">'+esc(then.label)+'</button>'
    : '<button type="button" class="later">Plus tard</button>'
      + '<a class="go" href="'+HOME+'?vitrine=1">🏆 Voir ma vitrine</a>';
  pop.innerHTML = medalHtml(def, entry)
    + '<h2>Ton tout premier trophée !</h2>'
    + '<p>Tu viens de gagner <b>'+esc(def.n)+'</b>. Chaque trophée récompense une réussite : finir un '
    + 'niveau difficile, battre un boss, ou terminer un atelier en entier.</p>'
    + '<p>Ils sont tous rangés dans ta <b>vitrine</b>, en bas de la page d\'accueil. Va la découvrir !</p>'
    + '<div class="acts">'+acts+'</div>';
  back.appendChild(pop); document.body.appendChild(back);

  /* 🔊 comme sur les popups des ateliers (sans effet sur index.html, qui n'a pas le moteur TTS) */
  pop.dataset.ttsText=FIRST_TEXT;
  if(typeof window.ttsDecorateModal==='function') window.ttsDecorateModal(pop);

  requestAnimationFrame(function(){ back.classList.add('in'); });
  function close(){
    if(typeof window.ttsStopCurrent==='function') window.ttsStopCurrent();
    back.classList.remove('in');
    setTimeout(function(){ if(back.parentNode) back.parentNode.removeChild(back); }, 260);
  }
  var later=pop.querySelector('.later'); if(later) later.onclick=close;
  var next=pop.querySelector('.next');
  if(next) next.onclick=function(){ close(); then.run(); };
  /* Sans bouton « suite », un clic à côté ferme la popup. Avec, on l'exige : le seul
     chemin de retour au jeu passe par ce bouton, on ne veut pas qu'il s'évapore. */
  if(!then) back.addEventListener('click', function(e){ if(e.target===back) close(); });
}

/* ---------------------------------------------------------------------------
   10. Vitrine
   --------------------------------------------------------------------------- */
function renderShowcase(host){
  if(!host) return 0;
  css();
  var st=load(), n=count();
  var h='<div class="hd"><h2>🏆 Ma vitrine de trophées</h2>'
      + '<span class="ct">'+n+' / '+LIST.length+'</span></div>'
      + '<div class="pr"><i style="width:'+Math.round(n/LIST.length*100)+'%"></i></div>';
  WS_ORDER.forEach(function(ws){
    var defs=LIST.filter(function(d){ return d.ws===ws; });
    if(!defs.length) return;
    var got=defs.filter(function(d){ return st[d.id]; }).length;
    h+='<div class="bdg-grp" style="--bdg-hue:'+WS[ws].hue+'">'
      +'<span class="gt">'+WS[ws].ic+' '+esc(WS[ws].n)+' — '+got+' / '+defs.length+'</span>'
      +'<div class="bdg-row">'
      + defs.map(function(d){ return itemHtml(d, st[d.id]); }).join('')
      +'</div></div>';
  });
  host.className='bdg-case';
  host.innerHTML=h;
  return n;
}

/* ---------------------------------------------------------------------------
   11. Visite guidée (page d'accueil, une seule fois)
   --------------------------------------------------------------------------- */
var TOUR_TEXT='Ici, c\'est ta vitrine de trophées. Chaque rond gris avec un cadenas est un trophée '
  + 'qui te reste à gagner : passe ta souris dessus pour découvrir ce qu\'il faut faire. '
  + 'Tu en gagnes en finissant les niveaux difficiles, en battant les boss, et en terminant les ateliers.';

/* Défilement doux « fait main ».
   On n'utilise ni scrollIntoView({behavior:'smooth'}) ni scrollTo({behavior:'smooth'}) :
   plusieurs navigateurs les ignorent purement et simplement, ou s'arrêtent en chemin quand
   la page grandit sous eux (ici : 60 médailles + emojis qui finissent de se charger). On
   anime donc la position nous-mêmes, en recalculant la cible à chaque image pour absorber
   ces décalages, et on respecte « animations réduites ». */
function scrollTween(el, margin, ms){
  function target(){ return Math.max(0, el.getBoundingClientRect().top + (window.pageYOffset||0) - (margin||0)); }
  var reduce=false;
  try{ reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
  if(reduce){ window.scrollTo(0, target()); return; }
  var start=window.pageYOffset||0, t0=null, started=false, done=false;
  ms=ms||820;
  function step(ts){
    started=true;
    if(t0===null) t0=ts;
    var p=Math.min(1,(ts-t0)/ms);
    var e=p<0.5 ? 2*p*p : 1-Math.pow(-2*p+2,2)/2;      // easeInOutQuad
    window.scrollTo(0, Math.round(start+(target()-start)*e));
    if(p<1) requestAnimationFrame(step);
    else { done=true; window.scrollTo(0, target()); }   // recadrage final
  }
  requestAnimationFrame(step);
  /* Filet : dans un onglet d'arrière-plan, requestAnimationFrame ne se déclenche pas du
     tout. Sans ce repli, l'élève qui revient sur l'onglet trouverait la page en haut,
     sans comprendre où est sa vitrine. On saute alors directement à la bonne position. */
  setTimeout(function(){ if(!started && !done) window.scrollTo(0, target()); }, 420);
}

function runTour(host){
  host=host||document.querySelector('.bdg-case');
  if(!host) return;
  css();
  host.classList.add('spot');
  var bub=document.createElement('div'); bub.className='bdg-bub';
  bub.innerHTML='<h3>🏆 Ta vitrine de trophées</h3>'
    +'<p>Chaque trophée récompense une réussite : un niveau difficile terminé, un boss battu, '
    +'un atelier fini en entier.</p>'
    +'<p>Les ronds gris avec un cadenas 🔒 sont ceux qu\'il te reste à gagner. '
    +'<b>Passe ta souris dessus</b> pour découvrir ce qu\'il faut faire !</p>'
    +'<button type="button" class="ok">J\'ai compris !</button>';
  host.parentNode.insertBefore(bub, host);
  bub.dataset.ttsText=TOUR_TEXT;
  if(typeof window.ttsDecorateModal==='function') window.ttsDecorateModal(bub);
  setFlag(TOUR_KEY);
  /* On cadre la BULLE en haut de l'écran : la vitrine, très haute, se déroule juste
     dessous, si bien que l'explication et les premières médailles sont vues ensemble.
     Le défilement est relancé une seconde fois : au premier appel la page n'a pas fini
     de se stabiliser (polices, emojis, 60 médailles), et le navigateur peut aussi
     restaurer sa position d'avant-navigation — dans les deux cas on s'arrête trop court. */
  function go(){ setTimeout(function(){ scrollTween(bub, 26); }, 160); }
  if(document.readyState==='complete') go();
  else window.addEventListener('load', go, {once:true});
  bub.querySelector('.ok').onclick=function(){
    if(typeof window.ttsStopCurrent==='function') window.ttsStopCurrent();
    host.classList.remove('spot');
    if(bub.parentNode) bub.parentNode.removeChild(bub);
  };
}
function tourPending(){
  var q=false;
  try{ q=/[?&]vitrine=1/.test(location.search); }catch(e){}
  return q && !flag(TOUR_KEY);
}

/* ---------------------------------------------------------------------------
   12. Trophée « Grandes oreilles » — déclenché par le premier clic sur un 🔊
   --------------------------------------------------------------------------- */
document.addEventListener('click', function(e){
  var t=e.target;
  if(t && t.classList && t.classList.contains('tts-speaker')) award('meta.tts');
}, true);

return {
  award:award, isFirstEver:isFirstEver, has:has, get:get, count:count, all:all, reset:reset,
  renderShowcase:renderShowcase, runTour:runTour, tourPending:tourPending,
  list:LIST, total:LIST.length, scales:SCALES
};
})();
