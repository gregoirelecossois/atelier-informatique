/* « 🎓 Nouvelle année » dans le tableau de bord enseignant.
 *
 * Chaque classe reçoit une règle : ses élèves PASSENT dans une autre classe, leurs
 * comptes sont SUPPRIMÉS, ou rien ne change. Par défaut 6e → 5e → 4e → 3e et
 * CAP1 → CAP2 ; les comptes de 3e et de CAP2 sont supprimés ; toute autre classe ne
 * bouge pas. L'enseignant change ces règles ici, et elles sont enregistrées sur le
 * serveur pour l'établissement (pas dans ce navigateur) : on les retrouve d'un poste à
 * l'autre, et l'an prochain.
 *
 * Le passage lui-même se fait côté serveur, en une seule transaction (comptes.js,
 * passerAnneeSuivante). Cette page n'envoie que ce qu'elle a montré : le nombre de
 * comptes déplacés et supprimés. S'il ne correspond plus à ce que le serveur trouve, il
 * refuse plutôt que d'exécuter autre chose que ce qui a été confirmé.
 *
 * Dépend de prof.html, chargé avant : api(), ouvrir(), fermer(), esc(), etat,
 * chargerTableau().
 */
(function(){
'use strict';

var SUP = '!supprimer';            /* valeur du menu pour « comptes supprimés » */
var reglage = null;                /* réponse de GET /api/prof/annee */
var choix = {};                    /* nom de classe en minuscules → { de, action, vers } */
var modifie = false;

function cle(nom){ return String(nom || '').trim().toLowerCase(); }

function elevesDe(nom){
  return etat.eleves.filter(function(e){ return e.role === 'eleve' && cle(e.classe) === cle(nom); });
}

function pluriel(n, un, plusieurs){ return n + ' ' + (n > 1 ? plusieurs : un); }

function dateFr(iso){ return new Date(iso).toLocaleDateString('fr-FR'); }

function poserChoix(regles){
  choix = {};
  regles.forEach(function(r){ choix[cle(r.de)] = { de: r.de, action: r.action, vers: r.vers }; });
  modifie = false;
}

/* Les règles dans l'ordre des classes à l'écran, puis celles des classes absentes. */
function reglesActuelles(){
  var vus = {}, liste = [];
  etat.classes.forEach(function(c){
    var r = choix[cle(c.nom)];
    vus[cle(c.nom)] = true;
    if(r) liste.push(r);
  });
  Object.keys(choix).forEach(function(k){ if(!vus[k]) liste.push(choix[k]); });
  return liste.map(function(r){
    return r.action === 'supprimer' ? { de: r.de, action: 'supprimer' }
                                    : { de: r.de, action: 'passer', vers: r.vers };
  });
}

/* Ce qui va se passer, compté sur les élèves affichés par le tableau de bord. */
function apercu(){
  var lignes = reglesActuelles().map(function(r){
    return { regle: r, eleves: elevesDe(r.de) };
  });
  var somme = function(action){
    return lignes.filter(function(l){ return l.regle.action === action; })
      .reduce(function(n, l){ return n + l.eleves.length; }, 0);
  };
  return { lignes: lignes, deplaces: somme('passer'), supprimes: somme('supprimer') };
}

function existe(nom){
  return etat.classes.some(function(c){ return cle(c.nom) === cle(nom); });
}

/* ---- Écran 1 : les règles ---------------------------------------------- */
function menuPour(nom){
  var r = choix[cle(nom)];
  var val = !r ? '' : r.action === 'supprimer' ? SUP : '=' + r.vers;
  var opts = [['', 'Ne change pas'], [SUP, '🗑 Comptes supprimés']];
  etat.classes.forEach(function(c){
    if(cle(c.nom) !== cle(nom)) opts.push(['=' + c.nom, '→ passent en ' + c.nom]);
  });
  /* Une règle peut viser une classe supprimée depuis : on la montre telle quelle, le
     serveur la recréera au passage. */
  if(r && r.action === 'passer' && !existe(r.vers)){
    opts.push(['=' + r.vers, '→ passent en ' + r.vers + ' (sera créée)']);
  }
  return '<select data-de="' + esc(nom) + '">' + opts.map(function(o){
    return '<option value="' + esc(o[0]) + '"' + (cle(o[0]) === cle(val) ? ' selected' : '') + '>' +
      esc(o[1]) + '</option>';
  }).join('') + '</select>';
}

function ligneClasse(nom, absente){
  var n = elevesDe(nom).length;
  var r = choix[cle(nom)];
  var cl = !r ? '' : r.action === 'supprimer' ? ' sup' : ' passe';
  return '<div class="na-ligne' + cl + (absente ? ' absente' : '') + '">' +
    '<span class="na-classe">' + esc(nom) + '</span>' +
    '<span class="na-nb">' + (absente ? 'pas de classe à ce nom' : pluriel(n, 'élève', 'élèves')) + '</span>' +
    menuPour(nom) + '</div>';
}

function resume(a){
  if(!a.deplaces && !a.supprimes) return 'Aucun élève n\'est concerné par ces règles.';
  return [a.deplaces ? pluriel(a.deplaces, 'élève change', 'élèves changent') + ' de classe' : '',
          a.supprimes ? '<b>' + pluriel(a.supprimes, 'compte sera supprimé', 'comptes seront supprimés') +
            '</b>' : ''].filter(Boolean).join(' · ');
}

function ecranRegles(message){
  var absentes = Object.keys(choix).filter(function(k){ return !existe(choix[k].de); });
  var a = apercu();

  var b = ouvrir(
    '<h2>🎓 Nouvelle année</h2>' +
    '<div class="id">Pour chaque classe, ce qui arrive à ses élèves au passage dans l\'année suivante. ' +
      'Ces règles sont enregistrées pour l\'établissement : tu les retrouveras l\'an prochain.' +
      (reglage.derniere ? ' Dernière nouvelle année démarrée le <b>' + dateFr(reglage.derniere) + '</b>.' : '') +
    '</div>' +
    '<div id="msg">' + (message || '') + '</div>' +
    '<div class="na-liste">' +
      etat.classes.map(function(c){ return ligneClasse(c.nom, false); }).join('') +
      absentes.map(function(k){ return ligneClasse(choix[k].de, true); }).join('') +
    '</div>' +
    '<p class="imp-aide">Les élèves gardent toute leur progression en changeant de classe. ' +
      'Un compte supprimé disparaît avec sa progression, ses trophées et ses projets MakeCode. ' +
      'Les classes réglées sur « Ne change pas » ne bougent pas.</p>' +
    '<div class="msg na-resume">' + resume(a) + '</div>' +
    '<div class="actes">' +
      '<button class="btn" id="naDefaut"' + (reglage.parDefaut && !modifie ? ' disabled' : '') +
        ' title="6e → 5e → 4e → 3e, CAP1 → CAP2, 3e et CAP2 supprimés, le reste inchangé">' +
        'Revenir au réglage par défaut</button>' +
      '<button class="btn" id="naEnregistrer"' + (modifie ? '' : ' disabled') + '>Enregistrer les règles</button>' +
      '<button class="btn primaire pousse" id="naSuite"' + (a.deplaces || a.supprimes ? '' : ' disabled') + '>' +
        'Démarrer la nouvelle année…</button>' +
    '</div>', 'large', function(){
      return !modifie || confirm('Fermer sans enregistrer les règles modifiées ?');
    });

  function echec(err){ b.querySelector('#msg').innerHTML = '<div class="msg ko">' + esc(err.message) + '</div>'; }

  b.querySelectorAll('.na-liste select').forEach(function(s){
    s.onchange = function(){
      var de = s.getAttribute('data-de'), v = s.value;
      if(!v) delete choix[cle(de)];
      else if(v === SUP) choix[cle(de)] = { de: de, action: 'supprimer' };
      else choix[cle(de)] = { de: de, action: 'passer', vers: v.slice(1) };
      modifie = true;
      ecranRegles();
    };
  });

  b.querySelector('#naDefaut').onclick = function(){
    api('PUT', '/api/prof/annee/regles', { regles: null }).then(function(r){
      reglage = r; poserChoix(r.regles);
      ecranRegles('<div class="msg ok">Réglage par défaut rétabli.</div>');
    }).catch(echec);
  };

  b.querySelector('#naEnregistrer').onclick = function(){
    enregistrer().then(function(){
      ecranRegles('<div class="msg ok">Règles enregistrées.</div>');
    }).catch(echec);
  };

  /* Les règles sont enregistrées AVANT l'écran de confirmation : le serveur applique
     celles qu'il a en base, il faut donc que ce soient celles qu'on va montrer. */
  b.querySelector('#naSuite').onclick = function(){
    (modifie ? enregistrer() : Promise.resolve()).then(ecranConfirmation).catch(echec);
  };
}

function enregistrer(){
  return api('PUT', '/api/prof/annee/regles', { regles: reglesActuelles() }).then(function(r){
    reglage = r; poserChoix(r.regles);
  });
}

/* ---- Écran 2 : confirmation -------------------------------------------- */
function ecranConfirmation(){
  var a = apercu();
  var recente = reglage.derniere &&
    Date.now() - new Date(reglage.derniere).getTime() < reglage.joursMin * 864e5;

  var lignes = a.lignes.filter(function(l){ return l.eleves.length; }).map(function(l){
    return '<li>' + (l.regle.action === 'supprimer'
      ? '<b>' + esc(l.regle.de) + '</b> : ' + pluriel(l.eleves.length, 'compte supprimé', 'comptes supprimés')
      : '<b>' + esc(l.regle.de) + '</b> → <b>' + esc(l.regle.vers) + '</b> : ' +
        pluriel(l.eleves.length, 'élève', 'élèves')) + '</li>';
  }).join('');

  var partants = [];
  a.lignes.forEach(function(l){
    if(l.regle.action === 'supprimer') l.eleves.forEach(function(e){ partants.push(e); });
  });
  partants.sort(function(x, y){ return (x.nom + x.prenom).localeCompare(y.nom + y.prenom, 'fr'); });

  var b = ouvrir(
    '<h2>Démarrer la nouvelle année ?</h2>' +
    '<div class="id">' + resume(a) + '</div>' +
    '<div id="msg"></div>' +
    '<ul class="na-bilan">' + lignes + '</ul>' +
    (partants.length
      ? '<div class="msg ko">Les <b>' + pluriel(partants.length, 'compte', 'comptes') + '</b> ci-dessous ' +
          'seront supprimés <b>définitivement</b>, avec leur progression, leurs trophées et leurs ' +
          'projets MakeCode. C\'est irréversible.' +
          '<details class="na-partants"><summary>Voir la liste</summary><ul>' +
          partants.map(function(e){
            return '<li>' + esc(e.prenom + ' ' + e.nom) + ' <small>' + esc(e.classe) + ' · ' +
              esc(e.identifiant) + '</small></li>';
          }).join('') + '</ul></details></div>' +
        '<label class="na-coche"><input type="checkbox" id="naCompris"> J\'ai compris que ces comptes ' +
          'seront supprimés définitivement</label>'
      : '') +
    (recente
      ? '<div class="msg imp-alerte">La nouvelle année a déjà été démarrée le <b>' + dateFr(reglage.derniere) +
          '</b>. Recommencer ferait passer les élèves <b>une classe de plus</b>.</div>' +
        '<label class="na-coche"><input type="checkbox" id="naForcer"> Recommencer quand même</label>'
      : '') +
    '<div class="actes">' +
      '<button class="btn" id="naRetour">← Revenir aux règles</button>' +
      '<button class="btn danger pousse" id="naGo">🎓 Démarrer la nouvelle année</button>' +
    '</div>', 'large');

  var go = b.querySelector('#naGo');
  var coches = b.querySelectorAll('.na-coche input');
  function verrou(){
    go.disabled = Array.prototype.some.call(coches, function(c){ return !c.checked; });
  }
  coches.forEach(function(c){ c.onchange = verrou; });
  verrou();

  b.querySelector('#naRetour').onclick = function(){ ecranRegles(); };

  go.onclick = function(){
    go.disabled = true;
    var forcer = b.querySelector('#naForcer');
    api('POST', '/api/prof/annee', {
      attendu: { deplaces: a.deplaces, supprimes: a.supprimes },
      forcer: !!(forcer && forcer.checked)
    }).then(function(r){
      etat.classe = null;            /* le filtre visait peut-être une classe vidée */
      return chargerTableau().then(function(){ ecranFin(r); });
    }).catch(function(err){
      b.querySelector('#msg').innerHTML = '<div class="msg ko">' + esc(err.message) + '</div>';
      verrou();
    });
  };
}

/* ---- Écran 3 : bilan --------------------------------------------------- */
function ecranFin(r){
  var lignes = r.classes.filter(function(c){ return c.n; }).map(function(c){
    return '<li>' + (c.action === 'supprimer'
      ? '<b>' + esc(c.de) + '</b> : ' + pluriel(c.n, 'compte supprimé', 'comptes supprimés')
      : '<b>' + esc(c.de) + '</b> → <b>' + esc(c.vers) + '</b> : ' + pluriel(c.n, 'élève', 'élèves')) + '</li>';
  }).join('');
  var b = ouvrir(
    '<h2>🎓 Nouvelle année démarrée</h2>' +
    '<div class="msg ok">La nouvelle année est démarrée : ' +
      pluriel(r.deplaces, 'élève a changé', 'élèves ont changé') + ' de classe, ' +
      pluriel(r.supprimes, 'compte a été supprimé', 'comptes ont été supprimés') + '.</div>' +
    (lignes ? '<ul class="na-bilan">' + lignes + '</ul>' : '') +
    '<p class="imp-aide">Il reste à créer les comptes des nouveaux élèves, par exemple avec ' +
      '« 📋 Importer de Pronote ».</p>' +
    '<div class="actes"><button class="btn primaire pousse" id="naFin">Fermer</button></div>', 'large');
  b.querySelector('#naFin').onclick = function(){ fermer(); };
}

function ouvrirNouvelleAnnee(){
  api('GET', '/api/prof/annee').then(function(r){
    reglage = r; poserChoix(r.regles);
    ecranRegles();
  }).catch(function(e){ alert(e.message); });
}

window.NouvelleAnnee = { ouvrir: ouvrirNouvelleAnnee };
})();
