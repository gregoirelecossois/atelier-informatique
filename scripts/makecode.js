/* MakeCode micro:bit, branché sur les comptes de l'atelier.
 *
 * L'éditeur est celui de Microsoft (makecode.microbit.org), affiché dans un cadre en mode
 * « contrôleur » (?controller=1). Dans ce mode, MakeCode ne range plus rien lui-même : il
 * demande ses projets à la page qui l'héberge (message « workspacesync ») et lui renvoie
 * chaque modification (« workspacesave »). C'est cette page qui décide où ils vont :
 *
 *   élève connecté  → serveur de l'atelier (/api/makecode/*), doublé d'un cache sur le
 *                     poste pour démarrer vite et survivre à une coupure réseau ;
 *   pas connecté    → navigateur du poste seulement, comme les ateliers en mode invité.
 *
 * Ménager le serveur : MakeCode enregistre à chaque bloc posé. On n'envoie qu'après 5 s de
 * calme, jamais plus de 30 s sans point de sauvegarde, un projet n'est renvoyé que s'il a
 * VRAIMENT changé, et il voyage compressé (gzip, 4 à 5 fois plus petit). Le serveur ajoute
 * ses propres plafonds (nombre de projets, taille, rythme) : voir api/server.js.
 *
 * Fichier chargé par makecode.html seulement, APRÈS scripts/store.js : il lit l'élève
 * connecté par Store.eleve(), et le jeton de session là où store.js le range.
 * Rien ici n'écrit dans la progression des ateliers.
 */
(function(){
'use strict';

/* ---------------------------------------------------------------------------
   1. Réglages
   --------------------------------------------------------------------------- */
var EDITEUR = 'https://makecode.microbit.org/';
var ORIGINE_MC = 'https://makecode.microbit.org';

/* Ajoutées à chaque NOUVEAU projet. Épinglée sur un commit précis : une modification du
   dépôt de l'extension en cours d'année ne change pas les blocs sous les doigts des
   élèves. Pour passer à une version plus récente, remplacer l'empreinte après #. */
var EXTENSIONS = {
  'Voiture robot': 'github:gregoirelecossois/robot-car-fr#abd62f7a416509aa96c57bcd70ca0821cbd90cdd'
};

var ATTENTE = 5000, PLAFOND = 30000;   /* cf. en-tête */
var ID_OK = /^[A-Za-z0-9-]{8,64}$/;    /* jumelle de MC_ID_OK dans api/server.js */

var CFG = window.ATELIER_CONFIG || {};
var API = (location.protocol === 'file:') ? '' : String(CFG.api || '').replace(/\/+$/, '');

/* ---------------------------------------------------------------------------
   2. Qui est là
   --------------------------------------------------------------------------- */
/* Le jeton n'est pas exposé par Store : on le relit là où store.js le range. */
function jeton(){
  try{ var s = JSON.parse(localStorage.getItem('atl_session') || 'null'); return (s && s.jeton) || ''; }
  catch(e){ return ''; }
}
function eleve(){ return (window.Store && Store.eleve && Store.eleve()) || null; }

/* Un cache par élève, et un pour le poste sans compte : deux élèves qui se suivent sur le
   même poste ne voient jamais les projets l'un de l'autre.
   L'identité est FIGÉE à l'ouverture de la page. Se connecter ou se déconnecter recharge
   la page, mais entre les deux les projets en mémoire appartiennent toujours à la
   personne d'avant : relire l'identité à ce moment-là les rangeait sous le nom de la
   suivante (les projets d'un élève qui se déconnecte finissaient dans le cache invité
   du poste). `termine` coupe toute écriture une fois la session de la page close. */
var ident = null, termine = false;
function figerIdentite(){
  var e = eleve(), j = jeton(), compte = !!(API && e && j);
  ident = { cle: 'atl_mc_' + (compte ? e.id : 'invite'), jeton: compte ? j : '' };
}
function connecte(){ return !!(ident && ident.jeton && jeton() === ident.jeton); }
function cleCache(){ return ident ? ident.cle : ''; }

/* ---------------------------------------------------------------------------
   3. Compression — gzip natif du navigateur, puis base64 pour voyager en JSON.
      Navigateur trop ancien : le projet part en clair (« js: »), le serveur sait lire.
   --------------------------------------------------------------------------- */
function versBase64(u8){
  var s = '', i, PAS = 0x8000;
  for(i = 0; i < u8.length; i += PAS) s += String.fromCharCode.apply(null, u8.subarray(i, i + PAS));
  return btoa(s);
}
function depuisBase64(b){
  var s = atob(b), u = new Uint8Array(s.length);
  for(var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
function enClair(prj){ return 'js:' + JSON.stringify(prj); }
function compresser(prj){
  if(typeof CompressionStream === 'undefined') return Promise.resolve(enClair(prj));
  var flux = new Blob([JSON.stringify(prj)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(flux).arrayBuffer().then(function(ab){ return 'gz:' + versBase64(new Uint8Array(ab)); });
}
/* MakeCode garde dans `_history` l'historique des versions du projet, qui grossit au fil
   des séances. Si le projet dépasse ce que le serveur accepte (64 Ko, cf. MC_PROJET_MAX),
   on le range sans cet historique : mieux vaut perdre le retour en arrière que le projet. */
var TAILLE_MAX = 64 * 1024;
function preparer(prj){
  return compresser(prj).then(function(d){
    if(d.length <= TAILLE_MAX || !prj.text || !prj.text._history) return d;
    var allege = { header: prj.header, text: {} };
    for(var f in prj.text) if(f !== '_history') allege.text[f] = prj.text[f];
    return compresser(allege);
  });
}
function decompresser(d){
  if(d.indexOf('js:') === 0) return Promise.resolve(JSON.parse(d.slice(3)));
  var flux = new Blob([depuisBase64(d.slice(3))]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(flux).text().then(JSON.parse);
}

/* ---------------------------------------------------------------------------
   4. Les projets
   --------------------------------------------------------------------------- */
var projets = {};     /* id → {header, text} : ce que MakeCode connaît */
var donnees = {};     /* id → forme compressée de la dernière version préparée */
var envoye = {};      /* id → forme compressée que le serveur détient */
var sale = {};        /* id → modifié, pas encore accepté par le serveur */
var rev = {};         /* id → compteur de modifications, pour ne pas effacer `sale` à tort */
var supprimes = {};   /* id → supprimé ici ; suppression serveur à faire si vrai */
var bloques = {};     /* id → refus définitif du serveur (quota, taille) jusqu'au prochain changement */
var maxServeur = 30;
var courant = null;   /* projet ouvert dans l'éditeur */

function liste(){
  var out = [], id;
  for(id in projets) if(projets[id] && !supprimes[id]) out.push(projets[id]);
  out.sort(function(a, b){ return (b.header.modificationTime || 0) - (a.header.modificationTime || 0); });
  return out;
}

function lireCache(){
  if(!cleCache()) return {};
  try{ return JSON.parse(localStorage.getItem(cleCache()) || 'null') || {}; }catch(e){ return {}; }
}
/* Le cache est un confort : s'il ne rentre plus (quota du navigateur), on s'en passe. */
function ecrireCache(){
  if(termine || !cleCache()) return;
  var p = {}, x = [], id;
  for(id in donnees) if(projets[id] && !supprimes[id]) p[id] = { d: donnees[id], s: sale[id] ? 1 : 0 };
  for(id in supprimes) if(supprimes[id]) x.push(id);
  try{ localStorage.setItem(cleCache(), JSON.stringify({ p: p, x: x })); }catch(e){}
}
function effacerCache(){ if(cleCache()) try{ localStorage.removeItem(cleCache()); }catch(e){} }

/* ---------------------------------------------------------------------------
   5. Réseau
   --------------------------------------------------------------------------- */
function req(methode, chemin, corps, keepalive){
  var init = { method: methode, headers: { 'Authorization': 'Bearer ' + jeton() }, cache: 'no-store' };
  if(corps !== undefined){ init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(corps); }
  if(keepalive) init.keepalive = true;
  return fetch(API + chemin, init).then(function(rep){
    return rep.text().then(function(txt){
      var j = {};
      try{ j = txt ? JSON.parse(txt) : {}; }catch(e){}
      if(!rep.ok){ var err = new Error(j.erreur || ('HTTP ' + rep.status)); err.statut = rep.status; throw err; }
      return j;
    });
  });
}

/* ---------------------------------------------------------------------------
   6. État affiché dans la barre
   --------------------------------------------------------------------------- */
var etatEl = null, etatCourant = '', alerte = '';
var TEXTES = {
  local:       ['warn', 'Projets gardés sur ce poste seulement'],
  ok:          ['ok',   'Projets sauvegardés'],
  envoi:       ['busy', 'Sauvegarde…'],
  'hors-ligne':['warn', 'Hors ligne — gardé sur ce poste'],
  expire:      ['bad',  'Session expirée — reconnecte-toi']
};
function poserEtat(e){
  etatCourant = e;
  if(!etatEl) return;
  var t = TEXTES[e] || TEXTES.local;
  etatEl.className = 'mc-etat ' + (alerte ? 'bad' : t[0]);
  etatEl.textContent = alerte || t[1];
  etatEl.title = alerte ? alerte
    : (e === 'local' ? 'Connecte-toi pour retrouver tes projets sur n\'importe quel poste.' : t[1]);
}
function poserAlerte(msg){ alerte = msg || ''; poserEtat(etatCourant); }

/* ---------------------------------------------------------------------------
   7. Envoi différé
   --------------------------------------------------------------------------- */
var minuteur = null, premierSale = 0, enVol = false, aRefaire = false, echecs = 0;

function rienEnAttente(){
  var id;
  for(id in sale) if(sale[id] && !bloques[id]) return false;
  for(id in supprimes) if(supprimes[id]) return false;
  return true;
}

function programmer(){
  if(!premierSale) premierSale = Date.now();
  if(connecte()) poserEtat('envoi');
  var reste = Math.max(0, Math.min(ATTENTE, premierSale + PLAFOND - Date.now()));
  if(minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(envoyer, reste);
}

/* Prépare (compresse) tout ce qui a changé, l'écrit dans le cache, puis l'envoie au
   serveur un projet après l'autre — jamais une rafale. */
function envoyer(){
  if(minuteur){ clearTimeout(minuteur); minuteur = null; }
  if(termine) return Promise.resolve();
  if(enVol){ aRefaire = true; return Promise.resolve(); }
  enVol = true;

  var ids = Object.keys(sale).filter(function(id){ return sale[id] && projets[id]; });
  var revs = {};
  return Promise.all(ids.map(function(id){
    revs[id] = rev[id];
    return preparer(projets[id]).then(function(d){ donnees[id] = d; revUtilisee[id] = revs[id]; });
  })).then(function(){
    ecrireCache();
    if(!connecte()){ premierSale = 0; poserEtat(API ? (eleve() ? 'expire' : 'local') : 'local'); return; }
    return envoyerAuServeur(revs);
  }).catch(function(){ /* une compression ratée : on retentera au prochain changement */ })
    .then(function(){
      enVol = false;
      if(aRefaire){ aRefaire = false; programmer(); }
    });
}

function envoyerAuServeur(revs){
  var file = [], id;
  for(id in supprimes) if(supprimes[id]) file.push({ suppr: id });
  for(id in sale) if(sale[id] && !bloques[id] && donnees[id]) file.push({ id: id });

  function suivant(){
    var t = file.shift();
    if(!t){
      ecrireCache();
      echecs = 0; premierSale = 0;
      poserEtat(rienEnAttente() ? 'ok' : 'envoi');
      return Promise.resolve();
    }
    if(t.suppr){
      return req('DELETE', '/api/makecode/projet', { id: t.suppr }).then(function(){
        supprimes[t.suppr] = false;
        return suivant();
      }, function(err){
        /* 400 ou 404 : rien à effacer côté serveur, inutile de réessayer en boucle. */
        if(err.statut === 400 || err.statut === 404){ supprimes[t.suppr] = false; return suivant(); }
        throw err;
      });
    }
    var d = donnees[t.id];
    /* Déjà sur le serveur à l'identique (MakeCode réenregistre parfois sans rien changer). */
    if(envoye[t.id] === d){ if(rev[t.id] === revs[t.id]) delete sale[t.id]; return suivant(); }
    return req('PUT', '/api/makecode/projet', { id: t.id, donnees: d }).then(function(){
      envoye[t.id] = d;
      if(rev[t.id] === revs[t.id]) delete sale[t.id];
      return suivant();
    }, function(err){
      /* Quota, taille, disque plein : refus qui ne passera pas en réessayant. On le dit,
         le projet reste dans le cache du poste, et on n'insiste plus avant qu'il change. */
      if(err.statut === 409 || err.statut === 413 || err.statut === 507){
        bloques[t.id] = true;
        poserAlerte(err.message);
        return suivant();
      }
      throw err;
    });
  }

  return suivant().catch(function(err){
    if(err.statut === 401 || err.statut === 403){ poserEtat('expire'); return; }
    echecs++;
    poserEtat('hors-ligne');
    /* 429 ou réseau : reprise en douceur, 5 s, 10 s, 20 s… plafonnées à deux minutes. */
    var delai = Math.min(120000, 5000 * Math.pow(2, Math.min(echecs - 1, 5)));
    if(minuteur) clearTimeout(minuteur);
    minuteur = setTimeout(envoyer, delai);
  });
}

/* Onglet qui passe en arrière-plan ou se ferme : compresser est asynchrone, on n'a peut-
   être plus le temps. Le cache reçoit donc tout de suite les projets pas encore préparés,
   en clair : rien ne se perd même si la page meurt dans la seconde. */
var revUtilisee = {};   /* id → `rev` au moment de la dernière compression */

function cacheImmediat(){
  var ids = [], id;
  for(id in sale){
    if(!sale[id] || !projets[id]) continue;
    if(!(donnees[id] && rev[id] === revUtilisee[id])) donnees[id] = enClair(projets[id]);
    ids.push(id);
  }
  ecrireCache();
  return ids;
}

/* Fermeture : on envoie en « keepalive », une requête que le navigateur termine même page
   fermée (64 Ko au total, d'où trois projets au plus — en pratique il n'y en a qu'un).
   Si elle échoue, le cache le garde : il repartira à la prochaine ouverture de MakeCode
   sur ce poste. */
function viderEnUrgence(){
  if(termine) return;
  var n = 0;
  cacheImmediat().forEach(function(id){
    var d = donnees[id];
    if(!connecte() || bloques[id] || envoye[id] === d || n++ >= 3) return;
    try{ req('PUT', '/api/makecode/projet', { id: id, donnees: d }, true).catch(function(){}); }catch(e){}
  });
}

/* ---------------------------------------------------------------------------
   8. Chargement des projets au démarrage
   --------------------------------------------------------------------------- */
function decoderTout(entrees){
  /* entrees : [{id, d, sale}] → projets ; une entrée illisible est ignorée, pas fatale. */
  return Promise.all(entrees.map(function(e){
    return decompresser(e.d).then(function(prj){
      return (prj && prj.header && prj.header.id === e.id && prj.text) ? { e: e, prj: prj } : null;
    }, function(){ return null; });
  })).then(function(r){ return r.filter(Boolean); });
}

function chargerProjets(){
  var cache = lireCache(), locaux = cache.p || {}, id;
  (cache.x || []).forEach(function(x){ if(ID_OK.test(x)) supprimes[x] = true; });

  var entreesLocales = [];
  for(id in locaux) if(ID_OK.test(id) && locaux[id] && locaux[id].d && !supprimes[id]){
    entreesLocales.push({ id: id, d: locaux[id].d, sale: !!locaux[id].s });
  }

  function poserLocaux(seulementSales){
    return decoderTout(entreesLocales.filter(function(e){ return !seulementSales || e.sale; }))
      .then(function(r){
        r.forEach(function(x){
          var id = x.e.id, deja = projets[id];
          /* Version locale pas encore envoyée : elle gagne, sauf si le serveur a plus
             récent (l'élève a continué sur un autre poste entre-temps). */
          if(deja && (deja.header.modificationTime || 0) > (x.prj.header.modificationTime || 0)) return;
          projets[id] = x.prj; donnees[id] = x.e.d; rev[id] = 0; revUtilisee[id] = 0;
          if(x.e.sale || !connecte()) sale[id] = true;
        });
      });
  }

  if(!connecte()){
    return poserLocaux(false).then(function(){
      for(var k in sale) delete sale[k];   /* sans compte, « envoyer » n'a pas de sens */
      poserEtat(API && eleve() ? 'expire' : 'local');
    });
  }

  return req('GET', '/api/makecode/projets').then(function(r){
    maxServeur = r.max || maxServeur;
    var entrees = (r.projets || []).filter(function(p){ return ID_OK.test(p.id) && !supprimes[p.id]; })
      .map(function(p){ return { id: p.id, d: p.donnees, sale: false }; });
    return decoderTout(entrees).then(function(res){
      res.forEach(function(x){
        projets[x.e.id] = x.prj; donnees[x.e.id] = x.e.d; envoye[x.e.id] = x.e.d;
        rev[x.e.id] = 0; revUtilisee[x.e.id] = 0;
      });
      return poserLocaux(true);
    }).then(function(){
      ecrireCache();
      if(rienEnAttente()) poserEtat('ok'); else programmer();
    });
  }, function(err){
    /* Serveur injoignable : on travaille sur le cache, et tout repartira au retour du réseau. */
    return poserLocaux(false).then(function(){
      poserEtat(err.statut === 401 || err.statut === 403 ? 'expire' : 'hors-ligne');
      if(err.statut !== 401 && err.statut !== 403 && !rienEnAttente()){ echecs = 1; programmer(); }
    });
  });
}

/* ---------------------------------------------------------------------------
   9. Dialogue avec l'éditeur
   --------------------------------------------------------------------------- */
var cadre = null, chargement = null, idMsg = 0, enAttente = {};

/* L'éditeur met plusieurs secondes à démarrer : une demande envoyée avant serait perdue
   (bouton « Nouveau projet » cliqué trop tôt). Elles attendent donc son premier signe. */
var signalerPret, editeurPret = new Promise(function(ok){ signalerPret = ok; });

function versEditeur(msg){
  msg.type = 'pxteditor';
  msg.id = 'atl-' + (++idMsg);
  msg.response = true;
  return editeurPret.then(function(){
    return new Promise(function(ok, ko){
      enAttente[msg.id] = { ok: ok, ko: ko };
      cadre.contentWindow.postMessage(msg, ORIGINE_MC);
    });
  });
}
function repondre(demande, extra){
  var r = { type: 'pxthost', id: demande.id, success: true };
  for(var k in extra) r[k] = extra[k];
  cadre.contentWindow.postMessage(r, ORIGINE_MC);
}

function surSauvegarde(prj){
  var h = prj && prj.header;
  if(!h || !ID_OK.test(h.id) || !prj.text) return;
  if(supprimes.hasOwnProperty(h.id)) return;        /* supprimé depuis « Mes projets » */
  if(h.isDeleted){ supprimer(h.id); return; }
  projets[h.id] = { header: h, text: prj.text };
  rev[h.id] = (rev[h.id] || 0) + 1;
  courant = h.id;
  sale[h.id] = true;
  if(bloques[h.id]){ delete bloques[h.id]; poserAlerte(''); }
  programmer();
  peindreListe();
  peindreNom();
}

function ouvrirAuDemarrage(){
  var l = liste();
  /* Premier passage, aucun projet : on demande quand même un nom, mais sans bouton
     Annuler — l'élève ne doit pas se retrouver devant un éditeur vide. */
  if(l.length) ouvrir(l[0].header.id); else nouveau(true);
}

function ouvrir(id){
  courant = id;
  peindreNom();
  return versEditeur({ action: 'openheader', headerId: id }).then(fermerPanneau, function(){});
}

/* `obligatoire` : la fenêtre du nom n'a pas de bouton Annuler (démarrage sans projet).
   Si le professeur a proposé des modèles à la classe, la même fenêtre les présente :
   l'élève part d'un projet vide ou d'un modèle (cf. section 12). */
function nouveau(obligatoire){
  if(connecte() && liste().length >= maxServeur){
    ouvrirPanneau('Tu as déjà ' + maxServeur + ' projets : supprime ceux dont tu n\'as plus besoin pour en créer un nouveau.');
    return Promise.resolve();
  }
  var o = {
    titre: 'Nouveau projet',
    texte: 'Donne un nom à ton projet. Tu pourras le changer plus tard.',
    valeur: '',
    bouton: 'Créer le projet',
    obligatoire: obligatoire === true
  };
  return modelesProposes().then(function(modeles){
    o.modeles = modeles;
    if(modeles.length) o.texte = 'Pars d\'un projet vide ou d\'un projet préparé par ton professeur, puis donne-lui un nom.';
    return demanderNom(o);
  }).then(function(nom){
    if(!nom) return;
    if(o.choisi) return depuisModele(o.choisi, nom);
    return versEditeur({ action: 'newproject', options: { name: nom, dependencies: EXTENSIONS } })
      .then(fermerPanneau, function(){});
  });
}

/* MakeCode n'a pas de commande « renommer » en mode contrôleur : il garde sa propre copie
   du projet, avec l'ancien nom, et la réenregistrerait telle quelle. On lui fait donc
   IMPORTER une copie portant le nouveau nom (nouvel identifiant), puis on efface
   l'ancienne. Pour l'élève, c'est le même projet : même code, même historique.
   « saveproject » d'abord, pour ne pas perdre les toutes dernières modifications. */
var renommageEnCours = false;
function renommer(id){
  id = id || courant;
  if(!id || !projets[id] || renommageEnCours) return Promise.resolve();
  var ancien = projets[id].header.name || '';
  return demanderNom({
    titre: 'Renommer le projet',
    valeur: ancien,
    bouton: 'Renommer'
  }).then(function(nom){
    if(!nom || nom === ancien) return;
    renommageEnCours = true;
    var avant = id === courant ? versEditeur({ action: 'saveproject' }).catch(function(){}) : Promise.resolve();
    return avant.then(function(){
      var p = projets[id];
      if(!p) return;
      return versEditeur({ action: 'importproject', project: copieRenommee(p, nom) }).then(function(){
        supprimer(id);
        fermerPanneau();
      }, function(){
        poserAlerte('Le projet n\'a pas pu être renommé. Réessaie.');
      });
    }).then(function(){ renommageEnCours = false; }, function(){ renommageEnCours = false; });
  });
}

function copieRenommee(p, nom){
  var h = JSON.parse(JSON.stringify(p.header)), t = {}, f;
  h.name = nom;
  delete h.isDeleted;
  for(f in p.text) t[f] = p.text[f];
  /* Le nom vit aussi dans pxt.json : c'est lui qui donne son nom au fichier téléchargé. */
  try{
    var cfg = JSON.parse(t['pxt.json']);
    cfg.name = nom;
    t['pxt.json'] = JSON.stringify(cfg, null, 4);
  }catch(e){}
  return { header: h, text: t };
}

function supprimer(id){
  supprimes[id] = true;
  delete projets[id]; delete sale[id]; delete donnees[id]; delete bloques[id];
  if(!connecte() || !envoye.hasOwnProperty(id)) supprimes[id] = false;   /* rien à effacer en ligne */
  delete envoye[id];
  ecrireCache();
  if(supprimes[id]) programmer();
  peindreListe();
  peindreNom();
}

window.addEventListener('message', function(ev){
  if(!cadre || ev.source !== cadre.contentWindow || ev.origin !== ORIGINE_MC) return;
  var m = ev.data;
  if(!m || typeof m !== 'object') return;

  /* Réponse de l'éditeur à une de nos demandes. */
  if(m.type === 'pxteditor' && m.id && enAttente[m.id]){
    var p = enAttente[m.id]; delete enAttente[m.id];
    if(m.success) p.ok(m.resp); else p.ko(m.error);
    return;
  }
  /* Au démarrage (noproject=1), MakeCode envoie sa demande « newproject » SANS champ
     `type` : c'est la seule, on l'accepte telle quelle. */
  if(m.type !== 'pxthost' && !(m.type === undefined && m.action === 'newproject')) return;

  switch(m.action){
    case 'workspacesync':
      projetsPrets.then(function(){
        repondre(m, { projects: liste(), editor: {}, controllerId: 'atelier-informatique' });
      });
      break;
    case 'workspacesave':
      surSauvegarde(m.project);
      break;
    case 'workspaceloaded':
      signalerPret();
      if(chargement){ chargement.parentNode.removeChild(chargement); chargement = null; }
      if(m.response) repondre(m, {});
      break;
    case 'newproject':
      /* noproject=1 : au démarrage, l'éditeur nous laisse choisir quoi ouvrir. */
      signalerPret();
      projetsPrets.then(ouvrirAuDemarrage);
      break;
    case 'workspacereset':
      /* « Tout réinitialiser » dans les réglages de MakeCode : on ne laisse pas un clic
         malheureux effacer les projets du serveur. Ils reviendront au prochain chargement. */
      if(m.response) repondre(m, {});
      break;
    default:
      if(m.response) repondre(m, {});
  }
});

/* ---------------------------------------------------------------------------
   10. Panneau « Mes projets »
   --------------------------------------------------------------------------- */
var panneau = null;

function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function quand(sec){
  if(!sec) return '';
  var d = new Date(sec * 1000), auj = new Date();
  var h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if(d.toDateString() === auj.toDateString()) return 'aujourd\'hui à ' + h;
  return 'le ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ' à ' + h;
}

function ouvrirPanneau(message){
  panneau.hidden = false;
  panneau.querySelector('.mc-msg').textContent = message || '';
  panneau.querySelector('.mc-msg').hidden = !message;
  peindreListe();
  chargerModelesProf();
}
function fermerPanneau(){ if(panneau) panneau.hidden = true; }

function peindreListe(){
  if(!panneau || panneau.hidden) return;
  peindreModeles();
  var l = liste(), ul = panneau.querySelector('.mc-projets'), prof = estProf();
  panneau.querySelector('.mc-compte').textContent = connecte()
    ? l.length + ' projet' + (l.length > 1 ? 's' : '') + ' sur ' + maxServeur
    : l.length + ' projet' + (l.length > 1 ? 's' : '') + ' sur ce poste';
  if(!l.length){ ul.innerHTML = '<li class="mc-vide">Aucun projet pour l\'instant.</li>'; return; }
  ul.innerHTML = l.map(function(p){
    var h = p.header, m = prof && modeleDeSource(h.id);
    return '<li data-id="' + esc(h.id) + '"' + (h.id === courant ? ' class="mc-ouvert"' : '') + '>' +
      '<button type="button" class="mc-ouvrir"><b>' + esc(h.name || 'Sans titre') + '</b>' +
        '<span>' + (h.id === courant ? 'ouvert · ' : '') + 'modifié ' + esc(quand(h.modificationTime)) +
        (m ? ' · 📘 proposé à ' + esc(nomsDesClasses(m.classes)) : '') + '</span></button>' +
      (prof && modelesProf ? '<button type="button" class="mc-icone mc-publier" title="' +
        (m ? 'Mettre à jour le modèle proposé aux élèves' : 'Proposer ce projet à des classes') + '">📤</button>' : '') +
      '<button type="button" class="mc-icone mc-renom" title="Renommer ce projet">✏️</button>' +
      '<button type="button" class="mc-icone mc-suppr" title="Supprimer ce projet">🗑️</button>' +
    '</li>';
  }).join('');
}

/* ---------------------------------------------------------------------------
   10 bis. Le nom du projet : affiché en haut, demandé à chaque création
   --------------------------------------------------------------------------- */
var NOM_MAX = 50;

function peindreNom(){
  var b = document.getElementById('mcNom');
  if(!b) return;
  var p = courant && projets[courant];
  b.hidden = !p;
  if(p){
    b.querySelector('span').textContent = p.header.name || 'Sans titre';
    b.title = 'Renommer « ' + (p.header.name || 'Sans titre') + ' »';
  }
}

/* Fenêtre maison plutôt que prompt() : celle du navigateur fait peur, ne se met pas en
   forme, et certains navigateurs la bloquent dans une page qui contient un cadre.
   Renvoie le nom choisi (nettoyé), ou null si l'élève annule. */
function demanderNom(o){
  var fen = document.getElementById('mcNomFenetre'),
      form = fen.querySelector('form'),
      champ = fen.querySelector('input'),
      err = fen.querySelector('.mc-erreur'),
      annuler = fen.querySelector('[data-a=annuler]');

  fen.querySelector('h2').textContent = o.titre;
  fen.querySelector('.mc-texte').textContent = o.texte || '';
  fen.querySelector('.mc-texte').hidden = !o.texte;
  fen.querySelector('[data-a=ok]').textContent = o.bouton;
  annuler.hidden = !!o.obligatoire;
  champ.value = o.valeur || '';
  champ.maxLength = NOM_MAX;
  err.hidden = true;

  /* Modèles du professeur : un choix de départ au-dessus du nom. Choisir un modèle
     propose son nom, sauf si l'élève a déjà écrit le sien. `o.choisi` porte le choix. */
  var choix = fen.querySelector('.mc-choix'), nomAuto = '';
  o.choisi = null;
  if(o.modeles && o.modeles.length){
    var origine = estProf() ? 'modèle de l\'établissement' : 'préparé par ton professeur';
    choix.innerHTML = '<p class="mc-choix-titre">Partir de…</p><div class="mc-choix-liste">' +
      '<label><input type="radio" name="mcDepart" value="" checked>' +
        '<span><b>Un projet vide</b><small>avec les blocs de la voiture robot</small></span></label>' +
      o.modeles.map(function(m){
        return '<label><input type="radio" name="mcDepart" value="' + esc(m.id) + '">' +
          '<span><b>📘 ' + esc(m.nom) + '</b><small>' + origine + '</small></span></label>';
      }).join('') + '</div>';
    choix.hidden = false;
    choix.onchange = function(ev){
      var v = ev.target.value, m = null;
      o.modeles.forEach(function(x){ if(String(x.id) === v) m = x; });
      o.choisi = m;
      if(!champ.value.trim() || champ.value === nomAuto){
        nomAuto = m ? m.nom.slice(0, NOM_MAX) : '';
        champ.value = nomAuto;
      }
    };
  }else{
    choix.hidden = true; choix.innerHTML = ''; choix.onchange = null;
  }

  fen.hidden = false;
  setTimeout(function(){ champ.focus(); champ.select(); }, 30);

  return new Promise(function(fin){
    function finir(v){
      fen.hidden = true;
      choix.onchange = null;
      form.onsubmit = null; annuler.onclick = null;
      fen.removeEventListener('keydown', clavier, true);
      fen.removeEventListener('mousedown', dehors);
      fin(v);
    }
    function clavier(ev){
      if(ev.key !== 'Escape') return;
      ev.stopPropagation();
      if(!o.obligatoire) finir(null);
    }
    function dehors(ev){ if(ev.target === fen && !o.obligatoire) finir(null); }

    form.onsubmit = function(ev){
      ev.preventDefault();
      var nom = champ.value.replace(/\s+/g, ' ').trim().slice(0, NOM_MAX);
      if(!nom){
        err.textContent = 'Écris un nom pour ton projet.';
        err.hidden = false; champ.focus(); return;
      }
      finir(nom);
    };
    annuler.onclick = function(){ finir(null); };
    fen.addEventListener('keydown', clavier, true);
    fen.addEventListener('mousedown', dehors);
  });
}

function poserPanneau(){
  panneau = document.getElementById('mcPanneau');
  panneau.addEventListener('mousedown', function(ev){ if(ev.target === panneau) fermerPanneau(); });
  document.addEventListener('keydown', function(ev){ if(ev.key === 'Escape') fermerPanneau(); });
  panneau.querySelector('[data-a=fermer]').onclick = fermerPanneau;
  panneau.querySelector('[data-a=nouveau]').onclick = function(){ nouveau(); };

  poserModeles();
  panneau.querySelector('.mc-projets').addEventListener('click', function(ev){
    var li = ev.target.closest('li[data-id]');
    if(!li) return;
    var id = li.getAttribute('data-id');
    if(ev.target.closest('.mc-ouvrir')){ ouvrir(id); return; }
    if(ev.target.closest('.mc-publier')){ publier(id); return; }
    if(ev.target.closest('.mc-renom')){ renommer(id); return; }
    if(ev.target.closest('.mc-suppr')){
      /* Confirmation sur place, pas de confirm() : la fenêtre du navigateur fait peur, et
         un élève clique « OK » sans lire. */
      li.innerHTML = '<span class="mc-question">Supprimer « ' + esc((projets[id] && projets[id].header.name) || 'Sans titre') +
        ' » pour toujours ?</span>' +
        '<button type="button" class="mc-non">Non</button><button type="button" class="mc-oui">Oui, supprimer</button>';
      li.querySelector('.mc-non').onclick = peindreListe;
      li.querySelector('.mc-oui').onclick = function(){
        var etaitOuvert = id === courant;
        supprimer(id);
        /* On ne laisse pas l'éditeur sur un projet qui n'existe plus : il le
           réenregistrerait (sans effet, mais l'élève croirait le garder). */
        if(etaitOuvert){ var l = liste(); if(l.length) ouvrir(l[0].header.id); else nouveau(true); }
      };
    }
  });
}

/* ---------------------------------------------------------------------------
   12. Modèles proposés par le professeur
       Le professeur propose un de ses projets à des classes (📤 dans « Mes projets ») ;
       l'élève le voit dans « Nouveau projet » et en part. MakeCode IMPORTE alors une
       copie, avec un nouvel identifiant (même mécanisme que le renommage) : elle
       appartient à l'élève, et le modèle peut être corrigé ou retiré sans y toucher.
   --------------------------------------------------------------------------- */
function estProf(){ var e = eleve(); return connecte() && !!e && e.role === 'prof'; }

/* Récupérés au démarrage, puis rafraîchis à chaque « Nouveau projet ». Jamais
   bloquant : si le serveur tarde, la fenêtre s'ouvre avec ce qu'on connaît déjà. */
var modelesConnus = [];
function rafraichirModeles(){
  if(!connecte()) return Promise.resolve(modelesConnus = []);
  return req('GET', '/api/makecode/modeles').then(function(r){
    modelesConnus = r.modeles || [];
    return modelesConnus;
  }, function(){ return modelesConnus; });
}
function modelesProposes(){
  if(!connecte()) return Promise.resolve([]);
  var delai = new Promise(function(ok){ setTimeout(function(){ ok(modelesConnus); }, 1500); });
  return Promise.race([rafraichirModeles(), delai]);
}

/* Ce qui ne doit pas suivre la copie : les liens de publication et de synchronisation
   du projet du professeur, et son historique des versions (ses essais à lui). */
var CHAMPS_PUBLICATION = ['pubId', 'pubCurrent', 'pubVersions', 'pubPermalink', 'githubId', 'githubTag',
  'githubCurrent', 'cloudUserId', 'cloudVersion', 'cloudCurrent', 'cloudLastSyncTime',
  'blobId', 'blobVersion', 'blobCurrent'];
function copieDepuisModele(prj, nom){
  var c = copieRenommee(prj, nom), maintenant = Math.round(Date.now() / 1000);
  CHAMPS_PUBLICATION.forEach(function(k){ delete c.header[k]; });
  delete c.text._history;
  c.header.modificationTime = c.header.recentUse = maintenant;
  return c;
}

function depuisModele(m, nom){
  return req('GET', '/api/makecode/modele/' + encodeURIComponent(m.id))
    .then(function(r){ return decompresser(r.donnees); })
    .then(function(prj){
      if(!prj || !prj.header || !prj.text) throw new Error('illisible');
      return versEditeur({ action: 'importproject', project: copieDepuisModele(prj, nom) });
    })
    .then(fermerPanneau, function(err){
      rafraichirModeles();
      ouvrirPanneau((err && err.statut === 404 && err.message) ||
        'Le projet de ton professeur n\'a pas pu être ouvert. Réessaie.');
    });
}

/* --- Côté professeur ------------------------------------------------------ */
var modelesProf = null;   /* {modeles:[{id, source, nom, maj_le, auteur, classes}], classes, max} */

function chargerModelesProf(){
  if(!estProf()) return Promise.resolve();
  return req('GET', '/api/prof/makecode/modeles').then(function(r){
    modelesProf = r; peindreListe();
  }, function(){});
}
function modeleDeSource(id){
  var r = null;
  if(modelesProf) modelesProf.modeles.forEach(function(m){ if(m.source === id) r = m; });
  return r;
}
function nomsDesClasses(ids){
  var noms = [];
  ((modelesProf && modelesProf.classes) || []).forEach(function(c){ if(ids.indexOf(c.id) >= 0) noms.push(c.nom); });
  return noms.length ? noms.join(', ') : 'aucune classe';
}

/* Fenêtre « nom + classes ». `o.envoyer(v)` fait le travail et renvoie une promesse :
   un refus s'affiche dans la fenêtre, qui ne se ferme qu'une fois l'envoi réussi. */
function fenetreModele(o){
  var fen = document.getElementById('mcModeleFenetre'),
      form = fen.querySelector('form'),
      champ = fen.querySelector('input[type=text]'),
      boite = fen.querySelector('.mc-classes'),
      err = fen.querySelector('.mc-erreur'),
      ok = fen.querySelector('[data-a=ok]'),
      annuler = fen.querySelector('[data-a=annuler]');

  fen.querySelector('h2').textContent = o.titre;
  fen.querySelector('.mc-texte').textContent = o.texte || '';
  fen.querySelector('.mc-texte').hidden = !o.texte;
  ok.textContent = o.bouton; ok.disabled = false;
  champ.value = o.nom || ''; champ.maxLength = NOM_MAX;
  var classes = (modelesProf && modelesProf.classes) || [];
  boite.innerHTML = classes.length ? classes.map(function(c){
    return '<label><input type="checkbox" value="' + c.id + '"' + (o.classes.indexOf(c.id) >= 0 ? ' checked' : '') +
      '><span>' + esc(c.nom) + '</span></label>';
  }).join('') : '<p class="mc-texte">Aucune classe dans l\'établissement : crée-les d\'abord dans le tableau de bord.</p>';
  err.hidden = true;
  boite.onchange = function(){ err.hidden = true; };
  fen.hidden = false;
  setTimeout(function(){ champ.focus(); champ.select(); }, 30);

  function finir(){
    fen.hidden = true;
    form.onsubmit = null; annuler.onclick = null;
    fen.removeEventListener('keydown', clavier, true);
    fen.removeEventListener('mousedown', dehors);
  }
  function clavier(ev){ if(ev.key === 'Escape'){ ev.stopPropagation(); finir(); } }
  function dehors(ev){ if(ev.target === fen) finir(); }
  function erreur(msg){ err.textContent = msg; err.hidden = false; }

  form.onsubmit = function(ev){
    ev.preventDefault();
    var nom = champ.value.replace(/\s+/g, ' ').trim().slice(0, NOM_MAX);
    var coches = [].map.call(boite.querySelectorAll('input:checked'), function(i){ return Number(i.value); });
    if(!nom){ erreur('Écris un nom pour le modèle.'); champ.focus(); return; }
    if(!coches.length){ erreur('Coche au moins une classe.'); return; }
    ok.disabled = true;
    o.envoyer({ nom: nom, classes: coches }).then(function(){
      finir();
      rafraichirModeles();
    }, function(e){
      ok.disabled = false;
      erreur((e && e.message && e.statut) ? e.message : 'L\'envoi a échoué. Vérifie la connexion et réessaie.');
    });
  };
  annuler.onclick = finir;
  fen.addEventListener('keydown', clavier, true);
  fen.addEventListener('mousedown', dehors);
}

/* Proposer un projet (ou remettre à jour son modèle). La version envoyée est celle du
   moment : « saveproject » d'abord si c'est le projet ouvert, comme pour renommer. */
function publier(id){
  if(!projets[id] || !modelesProf) return;
  var m = modeleDeSource(id);
  fenetreModele({
    titre: m ? 'Mettre à jour le modèle' : 'Proposer ce projet à des classes',
    texte: m
      ? 'Le modèle prend la version actuelle de ton projet. Les élèves qui en sont déjà partis gardent leur copie.'
      : 'Tes élèves le retrouveront dans « Nouveau projet » et en partiront pour créer leur propre copie. Ton projet ne change pas.',
    nom: m ? m.nom : projets[id].header.name,
    classes: m ? m.classes : [],
    bouton: m ? 'Mettre à jour' : 'Proposer',
    envoyer: function(v){
      var avant = id === courant ? versEditeur({ action: 'saveproject' }).catch(function(){}) : Promise.resolve();
      return avant.then(function(){
        var p = projets[id], t = {}, f;
        if(!p){ var e = new Error('Ce projet n\'existe plus.'); e.statut = 404; throw e; }
        for(f in p.text) if(f !== '_history') t[f] = p.text[f];
        return compresser({ header: p.header, text: t });
      }).then(function(d){
        return req('PUT', '/api/prof/makecode/modele', { source: id, nom: v.nom, donnees: d, classes: v.classes });
      }).then(function(r){ modelesProf = r; peindreListe(); });
    }
  });
}

function modifierModele(m){
  fenetreModele({
    titre: 'Modifier le modèle',
    texte: 'Pour changer son contenu, modifie ton projet puis clique sur 📤 à côté de lui.',
    nom: m.nom, classes: m.classes, bouton: 'Enregistrer',
    envoyer: function(v){
      return req('PATCH', '/api/prof/makecode/modele/' + m.id, { nom: v.nom, classes: v.classes })
        .then(function(r){ modelesProf = r; peindreListe(); });
    }
  });
}

function peindreModeles(){
  var bloc = panneau.querySelector('.mc-bloc-modeles');
  bloc.hidden = !estProf();
  if(bloc.hidden) return;
  var ul = bloc.querySelector('.mc-modeles');
  if(!modelesProf){ ul.innerHTML = '<li class="mc-vide">Chargement…</li>'; return; }
  if(!modelesProf.modeles.length){ ul.innerHTML = '<li class="mc-vide">Aucun modèle proposé pour l\'instant.</li>'; return; }
  ul.innerHTML = modelesProf.modeles.map(function(m){
    var maj = quand(Math.round(Date.parse(m.maj_le) / 1000));
    return '<li data-modele="' + m.id + '"><div class="mc-infos"><b>📘 ' + esc(m.nom) + '</b>' +
        '<span>' + esc(nomsDesClasses(m.classes)) + ' · mis à jour ' + esc(maj) +
        (m.auteur ? ' · par ' + esc(m.auteur) : '') + '</span></div>' +
      '<button type="button" class="mc-icone mc-modif" title="Changer le nom ou les classes">✏️</button>' +
      '<button type="button" class="mc-icone mc-retirer" title="Ne plus proposer ce modèle">🗑️</button>' +
    '</li>';
  }).join('');
}

function poserModeles(){
  panneau.querySelector('.mc-modeles').addEventListener('click', function(ev){
    var li = ev.target.closest('li[data-modele]');
    if(!li || !modelesProf) return;
    var m = null, id = Number(li.getAttribute('data-modele'));
    modelesProf.modeles.forEach(function(x){ if(x.id === id) m = x; });
    if(!m) return;
    if(ev.target.closest('.mc-modif')){ modifierModele(m); return; }
    if(ev.target.closest('.mc-retirer')){
      li.innerHTML = '<span class="mc-question">Ne plus proposer « ' + esc(m.nom) + ' » ? ' +
        'Les élèves qui en sont partis gardent leur projet.</span>' +
        '<button type="button" class="mc-non">Non</button><button type="button" class="mc-oui">Oui, retirer</button>';
      li.querySelector('.mc-non').onclick = peindreModeles;
      li.querySelector('.mc-oui').onclick = function(){
        req('DELETE', '/api/prof/makecode/modele/' + m.id).then(function(r){
          modelesProf = r; peindreListe(); rafraichirModeles();
        }, function(e){ ouvrirPanneau((e && e.statut && e.message) || 'Le modèle n\'a pas pu être retiré. Réessaie.'); });
      };
    }
  });
}

/* ---------------------------------------------------------------------------
   11. Démarrage
   --------------------------------------------------------------------------- */
var projetsPrets;

/* store.js masque parfois la page le temps de récupérer la progression d'un élève qui
   arrive sur un poste neuf, et peut la recharger une fois. Inutile de lancer l'éditeur
   (lourd) avant d'être sûr que la page reste. */
function attendreStore(){
  return new Promise(function(ok){
    var debut = Date.now();
    (function guetter(){
      if(!document.documentElement.classList.contains('atl-boot') || Date.now() - debut > 6000) ok();
      else setTimeout(guetter, 150);
    })();
  });
}

function demarrer(){
  figerIdentite();
  etatEl = document.getElementById('mcEtat');
  poserEtat(connecte() ? 'ok' : (API && eleve() ? 'expire' : 'local'));
  poserPanneau();
  document.getElementById('mcProjets').onclick = function(){ ouvrirPanneau(); };
  document.getElementById('mcNouveau').onclick = function(){ nouveau(); };
  document.getElementById('mcNom').onclick = function(){ renommer(); };
  chargement = document.getElementById('mcChargement');

  attendreStore().then(function(){
    /* store.js a pu constater entre-temps une session expirée : on refige, AVANT de
       charger quoi que ce soit. */
    figerIdentite();
    projetsPrets = chargerProjets().catch(function(){});
    rafraichirModeles();

    cadre = document.createElement('iframe');
    cadre.id = 'mcCadre';
    cadre.title = 'Éditeur MakeCode micro:bit';
    /* usb : bouton « Connecter » pour envoyer directement sur la carte (WebUSB). */
    cadre.setAttribute('allow', 'usb; serial; bluetooth; clipboard-read; clipboard-write; fullscreen');
    cadre.setAttribute('allowfullscreen', '');
    cadre.src = EDITEUR + '?controller=1&noproject=1&lang=fr';
    document.getElementById('mcZone').appendChild(cadre);

    /* Rien au bout d'une minute : le plus souvent, le filtre du réseau de l'établissement
       bloque makecode.microbit.org. On le dit plutôt que de laisser tourner l'attente. */
    setTimeout(function(){
      if(chargement) chargement.textContent = 'MakeCode ne répond pas. Vérifie la connexion, ou que le site '+
        'makecode.microbit.org n\'est pas bloqué par le réseau du collège.';
    }, 60000);
  });

  /* Déconnexion depuis la pastille du compte : on pousse ce qui traîne AVANT que
     store.js n'efface la session. Le cache du poste n'est vidé que si tout est parti. */
  if(window.Store && Store.deconnexion){
    var deconnexionAtelier = Store.deconnexion;
    Store.deconnexion = function(){
      var args = arguments;
      return envoyer().catch(function(){}).then(function(){
        if(rienEnAttente()) effacerCache();
        termine = true;
      }).then(function(){ return deconnexionAtelier.apply(Store, args); });
    };
  }
  /* Connexion depuis la pastille (la page se recharge ensuite) : les projets en mémoire
     sont ceux du poste sans compte. On les met en cache tout de suite, puis plus rien ne
     s'écrit — sinon ils partiraient sur le compte qui vient de se connecter. Connexion
     refusée (mauvais mot de passe) : on reprend comme avant. */
  if(window.Store && Store.connexion){
    var connexionAtelier = Store.connexion;
    Store.connexion = function(){
      cacheImmediat();
      termine = true;
      return connexionAtelier.apply(Store, arguments).catch(function(e){ termine = false; throw e; });
    };
  }
  if(window.Store && Store.surEtat){
    Store.surEtat(function(e){ if(e === 'expire') poserEtat('expire'); });
  }

  /* Onglet en arrière-plan (l'élève va voir un atelier) : la page vit encore, on envoie
     normalement. Fermeture : voie d'urgence. Les deux peuvent se suivre, un envoi en
     double est sans effet. */
  window.addEventListener('pagehide', viderEnUrgence);
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState !== 'hidden' || rienEnAttente()) return;
    cacheImmediat();
    envoyer();
  });
  window.addEventListener('online', function(){ if(!rienEnAttente()){ echecs = 0; envoyer(); } });
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
else demarrer();

})();
