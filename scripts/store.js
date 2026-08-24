/* Stockage partagé de l'atelier informatique — cache local et synchronisation en ligne.
 *
 * Fichier PARTAGÉ, chargé EN PREMIER dans le <head> des 7 pages : avant le petit script
 * qui applique le mode dys, avant scripts/badges.js, avant le code de jeu. Tout le reste
 * part du principe que window.Store existe déjà et répond de façon SYNCHRONE — c'est la
 * condition pour que rien ne change dans le code des ateliers, qui appelait jusqu'ici un
 * objet `store` local identique dans chacun des six fichiers.
 *
 * Trois modes, décidés au chargement :
 *
 *   LOCAL   scripts/config.js ne donne pas d'API, ou la page est ouverte en file://.
 *           get/set/del tapent directement dans localStorage : comportement d'avant,
 *           au caractère près. L'atelier reste utilisable sans réseau, sur clé USB.
 *
 *   INVITÉ  une API est configurée mais personne n'est connecté. Idem LOCAL : la
 *           progression reste sur le poste. C'est le mode « je teste » / « pas encore
 *           de compte », et scripts/compte.js le signale à l'élève.
 *
 *   COMPTE  un élève est connecté. La vérité vit alors en mémoire (`mem`), doublée
 *           d'un cache localStorage nommé par élève (`atl_data_<id>`) pour que la page
 *           démarre instantanément et survive à une coupure réseau, et poussée vers le
 *           serveur par petits paquets (voir « envoi différé » plus bas).
 *
 * Pourquoi un cache nommé par élève plutôt que les clés brutes : deux élèves qui se
 * suivent sur le même poste ne doivent JAMAIS voir la progression l'un de l'autre, et
 * la progression « invité » du poste ne doit pas se mélanger à celle d'un compte.
 *
 * Ordre de vérité au démarrage : cache → écran visible tout de suite ; puis le serveur
 * répond et complète. On ne recharge la page QUE pendant l'amorçage bloquant (premier
 * passage d'un élève sur ce poste, page encore masquée) : jamais en cours de partie,
 * un rechargement ferait perdre la mission commencée.
 *
 * API publique (window.Store) :
 *   get(k) / set(k,v) / del(k)   l'API historique, synchrone (celle des ateliers)
 *   wipe(prefixe)                efface toutes les clés d'un préfixe (« Reset complet »)
 *   snapshot()                   copie de tout ce qui est rangé, pour inspection
 *   enLigne()                    une API est-elle configurée ?
 *   eleve()                      {id, prenom, nom, classe} ou null
 *   connexion(identifiant, mdp)  Promise → {eleve}
 *   deconnexion()                Promise
 *   pousser()                    force l'envoi immédiat des changements en attente
 *   etat()                       'local' | 'invite' | 'ok' | 'envoi' | 'hors-ligne' | 'expire'
 *   surEtat(cb)                  s'abonne aux changements d'état (rappelé aussitôt)
 */
window.Store = (function(){
'use strict';

/* ---------------------------------------------------------------------------
   1. Mode de fonctionnement
   --------------------------------------------------------------------------- */
var CFG   = window.ATELIER_CONFIG || {};
var API   = (location.protocol === 'file:') ? '' : String(CFG.api || '').replace(/\/+$/, '');
var CLOUD = !!API;

/* Les clés qui appartiennent à l'élève et le suivent de poste en poste. Tout le reste
   (clés d'un autre script, essais divers) reste strictement local au navigateur. */
var PREFIXES = ['ms_','kb_','tt_','df_','nv_','ml_','badges_','a11y_'];
function aMoi(k){
  for(var i=0;i<PREFIXES.length;i++) if(k.indexOf(PREFIXES[i])===0) return true;
  return false;
}

var CLE_SESSION = 'atl_session';
var CLE_CACHE   = 'atl_data_';      /* + identifiant numérique de l'élève */

/* ---------------------------------------------------------------------------
   2. Accès brut au localStorage — toujours enveloppé : certaines configurations
      (file://, navigation privée verrouillée, quota plein) le font lever.
   --------------------------------------------------------------------------- */
var repli = {};   /* dernier filet quand localStorage est indisponible */

function brutGet(k){ try{ var v=localStorage.getItem(k); return v===null?(k in repli?repli[k]:null):v; }catch(e){ return (k in repli)?repli[k]:null; } }
function brutSet(k,v){ repli[k]=v; try{ localStorage.setItem(k,v); }catch(e){} }
function brutDel(k){ delete repli[k]; try{ localStorage.removeItem(k); }catch(e){} }
function brutCles(){
  var out=[], k;
  try{ for(k in localStorage) if(Object.prototype.hasOwnProperty.call(localStorage,k)) out.push(k); }catch(e){}
  for(k in repli) if(out.indexOf(k)<0) out.push(k);
  return out;
}

/* ---------------------------------------------------------------------------
   3. Session
   --------------------------------------------------------------------------- */
var session = null;   /* {jeton, eleve:{id,identifiant,prenom,nom,classe}} */

(function chargerSession(){
  if(!CLOUD) return;
  try{
    var s = JSON.parse(brutGet(CLE_SESSION)||'null');
    if(s && s.jeton && s.eleve && s.eleve.id) session = s;
  }catch(e){}
})();

function poserSession(s){
  session = s;
  if(s) brutSet(CLE_SESSION, JSON.stringify(s)); else brutDel(CLE_SESSION);
}

/* ---------------------------------------------------------------------------
   4. Données
   `mem` n'existe qu'en mode COMPTE. Ailleurs il vaut null et get/set/del tapent
   directement dans localStorage, exactement comme avant l'arrivée des comptes.
   --------------------------------------------------------------------------- */
var mem = null;
var versionServeur = 0;
var sale = {};      /* clés modifiées, pas encore acceptées par le serveur */
var supprimees = {};

function cleCache(){ return CLE_CACHE + (session ? session.eleve.id : '0'); }

function lireCache(){
  try{
    var c = JSON.parse(brutGet(cleCache())||'null');
    if(c && typeof c.d === 'object' && c.d){ versionServeur = c.v|0; return c.d; }
  }catch(e){}
  return null;
}
function ecrireCache(){
  if(!mem) return;
  brutSet(cleCache(), JSON.stringify({ v: versionServeur, d: mem, t: Date.now() }));
}

var cacheAuDemarrage = null;
if(CLOUD && session){
  cacheAuDemarrage = lireCache();
  mem = cacheAuDemarrage || {};
}

/* ---------------------------------------------------------------------------
   5. Amorçage bloquant
   Premier passage d'un élève sur ce poste : aucun cache, le jeu démarrerait au
   niveau 1 avant que le serveur n'ait répondu. On masque la page le temps de la
   réponse (4 s maximum, on ne bloque jamais un élève sur un réseau capricieux).
   --------------------------------------------------------------------------- */
var amorcageBloquant = !!(CLOUD && session && !cacheAuDemarrage);
var masqueOte = false;

/* Tant que cet indicateur est faux, on ne SAIT PAS où en est l'élève : ni cache, ni
   réponse du serveur. Les ateliers, eux, démarrent quand même et écrivent aussitôt
   leurs valeurs par défaut (ms_curlevel=1, etc.). Ces écritures-là ne doivent ni
   partir vers le serveur, ni survivre à l'hydratation — sans quoi un élève arrivant
   sur un poste neuf verrait sa progression remise à zéro par son propre démarrage. */
var baseConnue = !amorcageBloquant;

if(amorcageBloquant){
  try{
    var st = document.createElement('style');
    st.id = 'atl-boot-style';
    st.textContent =
      'html.atl-boot body{visibility:hidden!important}'+
      'html.atl-boot::before{content:"Chargement de ta progression…";position:fixed;inset:0;z-index:2147483647;'+
        'display:flex;align-items:center;justify-content:center;background:#f4f7fb;color:#22303f;'+
        'font-family:"Nunito",system-ui,sans-serif;font-weight:800;font-size:1.05rem}';
    (document.head||document.documentElement).appendChild(st);
    document.documentElement.classList.add('atl-boot');
  }catch(e){ amorcageBloquant = false; }
  setTimeout(oterMasque, 4000);
}
function oterMasque(){
  if(masqueOte) return; masqueOte = true;
  try{
    document.documentElement.classList.remove('atl-boot');
    var st = document.getElementById('atl-boot-style');
    if(st && st.parentNode) st.parentNode.removeChild(st);
  }catch(e){}
}

/* ---------------------------------------------------------------------------
   6. API de stockage — synchrone, c'est tout l'intérêt
   --------------------------------------------------------------------------- */
function get(k){
  if(mem) return Object.prototype.hasOwnProperty.call(mem,k) ? mem[k] : null;
  return brutGet(k);
}

function set(k,v){
  v = String(v);
  if(mem){
    if(mem[k] === v) return;
    mem[k] = v; delete supprimees[k];
    if(!baseConnue) return;          /* démarrage à vide : écriture volatile */
    ecrireCache();
    if(aMoi(k)){ sale[k] = true; programmerEnvoi(); }
  }else{
    brutSet(k,v);
  }
}

function del(k){
  if(mem){
    if(!Object.prototype.hasOwnProperty.call(mem,k) && !sale[k]) return;
    delete mem[k]; delete sale[k];
    if(!baseConnue) return;
    ecrireCache();
    if(aMoi(k)){ supprimees[k] = true; programmerEnvoi(); }
  }else{
    brutDel(k);
  }
}

/* Efface toutes les clés d'un préfixe. Balayage par préfixe et non par liste : une
   liste finit toujours par oublier une clé ajoutée plus tard. */
function wipe(pfx){
  var i, k;
  if(mem){
    var touche = false;
    for(k in mem) if(Object.prototype.hasOwnProperty.call(mem,k) && k.indexOf(pfx)===0){
      delete mem[k];
      if(aMoi(k) && baseConnue){ supprimees[k]=true; delete sale[k]; }
      touche = true;
    }
    if(touche && baseConnue){ ecrireCache(); programmerEnvoi(); }
  }else{
    var cles = brutCles();
    for(i=0;i<cles.length;i++) if(cles[i].indexOf(pfx)===0) brutDel(cles[i]);
  }
}

function snapshot(){
  var out = {}, k, cles, i;
  if(mem){
    for(k in mem) if(Object.prototype.hasOwnProperty.call(mem,k)) out[k]=mem[k];
  }else{
    cles = brutCles();
    for(i=0;i<cles.length;i++) if(aMoi(cles[i])) out[cles[i]] = brutGet(cles[i]);
  }
  return out;
}

/* ---------------------------------------------------------------------------
   7. État visible (scripts/compte.js affiche la pastille correspondante)
   --------------------------------------------------------------------------- */
var etatCourant = !CLOUD ? 'local' : (session ? 'ok' : 'invite');
var abonnes = [];

function etat(){ return etatCourant; }
function poserEtat(e){
  if(e === etatCourant) return;
  etatCourant = e;
  for(var i=0;i<abonnes.length;i++){ try{ abonnes[i](e); }catch(err){} }
}
function surEtat(cb){
  if(typeof cb !== 'function') return;
  abonnes.push(cb);
  try{ cb(etatCourant); }catch(e){}
}

/* ---------------------------------------------------------------------------
   8. Réseau
   --------------------------------------------------------------------------- */
function req(methode, chemin, corps, opts){
  opts = opts || {};
  var init = { method: methode, headers: {}, cache: 'no-store' };
  if(session && session.jeton) init.headers['Authorization'] = 'Bearer ' + session.jeton;
  if(corps !== undefined){ init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(corps); }
  if(opts.keepalive) init.keepalive = true;

  return fetch(API + chemin, init).then(function(rep){
    return rep.text().then(function(txt){
      var j = null;
      try{ j = txt ? JSON.parse(txt) : {}; }catch(e){ j = {}; }
      if(!rep.ok){
        var err = new Error(j.erreur || ('HTTP ' + rep.status));
        err.statut = rep.status;
        throw err;
      }
      return j;
    });
  });
}

/* Session refusée par le serveur (expirée, compte supprimé ou désactivé) : on
   retombe proprement en mode invité plutôt que d'insister avec un jeton mort. */
function sessionPerdue(){
  poserSession(null);
  mem = null; sale = {}; supprimees = {}; baseConnue = true;
  poserEtat('expire');
  oterMasque();
}

/* ---------------------------------------------------------------------------
   9. Envoi différé
   Un élève enchaîne les missions vite : on regroupe les écritures (2,5 s de calme)
   sans jamais laisser passer plus de 15 s sans point de sauvegarde, et on vide la
   file au moment où la page se ferme (keepalive : la requête survit à la fermeture).
   --------------------------------------------------------------------------- */
var ATTENTE = 2500, PLAFOND = 15000;
var minuteur = null, premierSale = 0, enVol = false, aRefaire = false, echecs = 0;

function riens(){
  var k;
  for(k in sale) if(sale[k]) return false;
  for(k in supprimees) if(supprimees[k]) return false;
  return true;
}

function programmerEnvoi(){
  if(!mem || !session) return;
  if(!premierSale) premierSale = Date.now();
  poserEtat('envoi');
  var reste = Math.max(0, Math.min(ATTENTE, premierSale + PLAFOND - Date.now()));
  if(minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(envoyer, reste);
}

function envoyer(opts){
  opts = opts || {};
  if(minuteur){ clearTimeout(minuteur); minuteur = null; }
  if(!mem || !session) return Promise.resolve();
  if(riens()){ premierSale = 0; poserEtat('ok'); return Promise.resolve(); }
  if(enVol){ aRefaire = true; return Promise.resolve(); }

  var majs = {}, dels = [], k;
  for(k in sale) if(sale[k] && Object.prototype.hasOwnProperty.call(mem,k)) majs[k] = mem[k];
  for(k in supprimees) if(supprimees[k]) dels.push(k);

  enVol = true;
  return req('PUT', '/api/progression', { majs: majs, suppressions: dels }, opts)
    .then(function(r){
      /* On ne vide QUE ce qui vient de partir : une écriture arrivée pendant le
         vol reste marquée sale et repartira au tour suivant. */
      for(var k2 in majs) if(sale[k2] && mem[k2] === majs[k2]) delete sale[k2];
      for(var i=0;i<dels.length;i++) if(!Object.prototype.hasOwnProperty.call(mem,dels[i])) delete supprimees[dels[i]];
      versionServeur = r.version|0;
      ecrireCache();
      echecs = 0; premierSale = 0;
      poserEtat(riens() ? 'ok' : 'envoi');
    })
    .catch(function(err){
      if(err.statut === 401 || err.statut === 403){ sessionPerdue(); return; }
      echecs++;
      poserEtat('hors-ligne');
      /* Reprise en douceur : 3 s, 6 s, 12 s… plafonnées à une minute. */
      var delai = Math.min(60000, 3000 * Math.pow(2, Math.min(echecs, 5)));
      if(minuteur) clearTimeout(minuteur);
      minuteur = setTimeout(envoyer, delai);
    })
    .then(function(){
      enVol = false;
      if(aRefaire){ aRefaire = false; programmerEnvoi(); }
    });
}

/* ---------------------------------------------------------------------------
   10. Hydratation depuis le serveur
   --------------------------------------------------------------------------- */
function appliquerServeur(donnees, version){
  var k, garde = {};
  /* Les écritures locales pas encore envoyées sont plus récentes que ce que répond
     le serveur : on les remet par-dessus. Sauf au tout premier chargement d'un poste
     neuf (baseConnue faux), où « local » ne veut rien dire d'autre que « valeurs par
     défaut du jeu » : là, le serveur a raison sur toute la ligne. */
  if(baseConnue){
    for(k in sale) if(sale[k]) garde[k] = Object.prototype.hasOwnProperty.call(mem||{},k) ? mem[k] : null;
    for(k in supprimees) if(supprimees[k]) garde[k] = null;
  }else{
    sale = {}; supprimees = {};
  }

  var avant = JSON.stringify(mem || {});
  mem = {};
  for(k in donnees) if(Object.prototype.hasOwnProperty.call(donnees,k) && donnees[k] !== null) mem[k] = String(donnees[k]);
  for(k in garde){ if(garde[k] === null) delete mem[k]; else mem[k] = garde[k]; }

  versionServeur = version|0;
  baseConnue = true;
  ecrireCache();
  return JSON.stringify(mem) !== avant;
}

function hydrater(){
  if(!CLOUD || !session) return Promise.resolve(false);
  return req('GET', '/api/moi').then(function(r){
    if(r.eleve) poserSession({ jeton: session.jeton, eleve: r.eleve });
    var change = appliquerServeur(r.progression || {}, r.version || 0);
    poserEtat(riens() ? 'ok' : 'envoi');
    if(!riens()) programmerEnvoi();
    return change;
  }).catch(function(err){
    if(err.statut === 401 || err.statut === 403){ sessionPerdue(); return false; }
    poserEtat('hors-ligne');
    return false;
  });
}

/* Rechargement au plus une fois par onglet : si l'écriture du cache échoue (mode
   privé verrouillé), on ne veut surtout pas d'une page qui se recharge en boucle. */
function dejaRecharge(){ try{ return sessionStorage.getItem('atl_reload') === '1'; }catch(e){ return false; } }
function marquerRecharge(){ try{ sessionStorage.setItem('atl_reload','1'); }catch(e){} }

function amorcer(essai){
  hydrater().then(function(change){
    if(baseConnue){
      /* Le jeu a démarré sur des valeurs par défaut avant que le serveur ne réponde :
         on repart proprement. La page est encore masquée, rien n'est perdu. */
      if(amorcageBloquant && change && !dejaRecharge()){ marquerRecharge(); location.reload(); return; }
      oterMasque();
      try{ document.dispatchEvent(new CustomEvent('store:maj')); }catch(e){}
      return;
    }
    /* Poste neuf ET serveur injoignable : on montre quand même la page — mieux vaut
       un atelier jouable qu'un écran figé — et on retente pendant une minute. Rien
       n'est envoyé tant qu'on ignore ce que le serveur détient (cf. baseConnue). */
    oterMasque();
    if(essai < 6) setTimeout(function(){ amorcer(essai + 1); }, 10000);
  });
}

if(CLOUD && session) amorcer(0);

/* ---------------------------------------------------------------------------
   Battement de présence
   Dit au tableau de bord enseignant où en est l'élève EN CE MOMENT, pour qu'un
   professeur voie d'un coup d'œil qui bloque et sur quoi. Rien à câbler dans les
   ateliers : on déduit l'atelier du nom de fichier (scripts/ateliers.js) et le
   niveau des clés déjà présentes. Silencieux tant que personne n'est connecté.
   --------------------------------------------------------------------------- */
var BATTEMENT_MS = 45000;

function ouSuisJe(){
  var a = window.ATELIER_PAR_FICHIER ? window.ATELIER_PAR_FICHIER(location.pathname) : null;
  if(!a) return { atelier: null, niveau: null, mission: null };
  var n = parseInt(get(a.id + '_curlevel') || '1', 10) || 1;
  return {
    atelier: a.id,
    niveau: n,
    mission: parseInt(get(a.id + '_step_l' + n) || '0', 10) || 0
  };
}

function battre(){
  if(!mem || !session || document.visibilityState === 'hidden') return;
  req('POST', '/api/presence', ouSuisJe()).catch(function(){ /* sans conséquence */ });
}

if(CLOUD && session){
  setTimeout(battre, 2000);
  setInterval(battre, BATTEMENT_MS);
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible') battre();
  });
}

/* Dernière chance avant fermeture / changement d'onglet. */
function vider(){
  if(mem && session && !riens()) envoyer({ keepalive: true });
}
if(CLOUD){
  window.addEventListener('pagehide', vider);
  window.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'hidden') vider(); });
  window.addEventListener('online', function(){ if(mem && session && !riens()){ echecs = 0; envoyer(); } });
}

/* ---------------------------------------------------------------------------
   11. Connexion / déconnexion
   --------------------------------------------------------------------------- */
function connexion(identifiant, motdepasse){
  if(!CLOUD) return Promise.reject(new Error('Aucun serveur configuré.'));
  return req('POST', '/api/connexion', { identifiant: identifiant, motdepasse: motdepasse })
    .then(function(r){
      poserSession({ jeton: r.jeton, eleve: r.eleve });
      mem = {}; sale = {}; supprimees = {}; versionServeur = 0; baseConnue = true;
      appliquerServeur(r.progression || {}, r.version || 0);
      poserEtat('ok');
      return { eleve: r.eleve };
    });
}

/* On pousse ce qui traîne AVANT d'effacer quoi que ce soit : un élève qui se
   déconnecte à la fin de l'heure ne doit pas laisser sa dernière mission au poste. */
function deconnexion(){
  if(!session) return Promise.resolve();
  var fin = function(){
    var c = cleCache();
    poserSession(null);
    brutDel(c);
    mem = null; sale = {}; supprimees = {}; versionServeur = 0;
    poserEtat(CLOUD ? 'invite' : 'local');
  };
  return envoyer().then(function(){ return req('POST','/api/deconnexion',{}); })
                  .catch(function(){})
                  .then(fin);
}

/* ---------------------------------------------------------------------------
   12. Surface publique
   --------------------------------------------------------------------------- */
return {
  get: get, set: set, del: del, wipe: wipe, snapshot: snapshot,
  enLigne: function(){ return CLOUD; },
  eleve: function(){ return session ? session.eleve : null; },
  connexion: connexion, deconnexion: deconnexion,
  pousser: function(){ return envoyer(); },
  etat: etat, surEtat: surEtat,
  prefixes: PREFIXES,
  _m: repli   /* compatibilité : les ateliers remettaient `store._m={}` dans wipe() */
};
})();
