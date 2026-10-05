/* « 📱 Travail à la maison » dans le tableau de bord enseignant.
 *
 * Les élèves font, sur leur téléphone, une courte série de leçons et de jeux (« Le PC à
 * la maison », dépôt le-pc, maison.html). Ils y entrent SANS COMPTE : un prénom, une
 * classe. Cette fenêtre répond à trois questions, dans cet ordre :
 *
 *   qui a fait le travail,   jusqu'où,   avec quel score.
 *
 * Elle donne aussi le LIEN à distribuer — il porte le code de l'établissement, c'est lui
 * qui rattache un téléphone à ce collège et à aucun autre.
 *
 * « Pas encore vus » : faute de compte, le serveur ne sait pas qui DEVAIT faire le
 * travail. La page le déduit ici, en comparant les prénoms reçus à ceux des comptes de
 * la classe (etat.eleves, déjà chargé par le tableau de bord). C'est une aide de lecture,
 * pas une vérité : un élève qui écrit un surnom, ou deux élèves du même prénom, la
 * trompent — d'où le « ? » affiché quand le compte n'y est pas.
 *
 * Dépend de prof.html, chargé avant : api(), ouvrir(), fermer(), esc(), plat(), quand(),
 * etat.
 */
(function(){
'use strict';

var RYTHME = 30000;                /* la fenêtre se rafraîchit seule tant qu'elle est ouverte */

/* Titre affiché pour chaque travail (colonne `devoir` côté serveur). Un identifiant
   inconnu s'affiche tel quel : mieux vaut un nom brut qu'une ligne cachée. */
var TITRES = { 'pc-1': 'Le PC à la maison' };

var donnees = null;                /* réponse de GET /api/prof/devoirs */
var devoir = null;                 /* travail affiché */
var classe = null;                 /* nom de la classe filtrée, null = toutes */
var minuteur = null;
var boite = null;
var empreinte = '';               /* dernière réponse peinte, pour ne pas repeindre à l'identique */

function cle(t){ return plat(String(t || '').trim()); }
function pluriel(n, un, plusieurs){ return n + ' ' + (n > 1 ? plusieurs : un); }

function lien(){
  var base = String((window.ATELIER_CONFIG || {}).devoirMaison || '').trim();
  if(!base || !donnees || !donnees.code) return '';
  return base + (base.indexOf('?') < 0 ? '?' : '&') + 'c=' + encodeURIComponent(donnees.code);
}

function passagesDuDevoir(){
  return (donnees ? donnees.passages : []).filter(function(p){ return p.devoir === devoir; });
}

function visibles(){
  return passagesDuDevoir().filter(function(p){ return !classe || cle(p.classe) === cle(classe); });
}

/* Les comptes élèves d'une classe dont le prénom n'apparaît dans aucune ligne reçue. */
function pasEncoreVus(lignes){
  if(!classe) return [];
  var vus = {};
  lignes.forEach(function(p){ vus[cle(p.prenom)] = true; });
  return etat.eleves.filter(function(e){
    return e.role === 'eleve' && e.actif !== false && cle(e.classe) === cle(classe) && !vus[cle(e.prenom)];
  });
}

/* Les classes à proposer en filtre : celles qui ont au moins une ligne, dans l'ordre du
   tableau de bord. */
function classesPresentes(){
  var avec = {};
  passagesDuDevoir().forEach(function(p){ if(p.classe) avec[cle(p.classe)] = p.classe; });
  var liste = etat.classes.filter(function(c){ return avec[cle(c.nom)]; }).map(function(c){ return c.nom; });
  Object.keys(avec).forEach(function(k){
    if(!liste.some(function(n){ return cle(n) === k; })) liste.push(avec[k]);
  });
  return liste;
}

function barreEtapes(p){
  var n = Math.max(1, p.etapes || 1), h = '';
  for(var i = 0; i < n; i++) h += '<i class="' + (i < p.etape ? 'on' : '') + '"></i>';
  return '<span class="dv-etapes" title="' + p.etape + ' sur ' + n + '">' + h + '</span>' +
         '<span class="dv-nb">' + p.etape + ' / ' + n + '</span>';
}

function ligne(p, doublons){
  var pc = p.score_max ? Math.round(p.score * 100 / p.score_max) : 0;
  var etatTxt = p.termine ? '<span class="dv-pastille fini">Terminé</span>'
              : p.etape > 0 ? '<span class="dv-pastille cours">En cours</span>'
              : '<span class="dv-pastille ouvert">Ouvert</span>';
  var meme = doublons[cle(p.classe) + '|' + cle(p.prenom)] > 1
    ? ' <span class="dv-double" title="Même prénom dans la même classe : deux élèves, ou le même élève sur deux téléphones.">×' +
      doublons[cle(p.classe) + '|' + cle(p.prenom)] + '</span>' : '';
  return '<tr>' +
    '<td class="dv-prenom">' + esc(p.prenom) + meme + '</td>' +
    '<td>' + esc(p.classe || '—') + '</td>' +
    '<td>' + etatTxt + '</td>' +
    '<td class="dv-avance">' + barreEtapes(p) + '</td>' +
    '<td class="dv-score"><b>' + p.score + '</b> / ' + p.score_max +
      (p.score_max && p.etape > 0 ? ' <small>' + pc + ' %</small>' : '') + '</td>' +
    '<td class="dv-quand">' + esc(quand(p.maj_le)) + '</td>' +
    '<td><button class="btn petit" data-suppr="' + esc(p.id) + '" title="Effacer cette ligne" aria-label="Effacer la ligne de ' +
      esc(p.prenom) + '">🗑</button></td>' +
  '</tr>';
}

function peindre(){
  if(!boite || !donnees) return;
  var tous = passagesDuDevoir();
  var lignes = visibles();
  var url = lien();

  var devoirs = {};
  donnees.passages.forEach(function(p){ devoirs[p.devoir] = true; });
  var listeDevoirs = Object.keys(devoirs);
  if(listeDevoirs.indexOf(devoir) < 0) listeDevoirs.unshift(devoir);

  var doublons = {};
  tous.forEach(function(p){
    var k = cle(p.classe) + '|' + cle(p.prenom);
    doublons[k] = (doublons[k] || 0) + 1;
  });

  var finis = lignes.filter(function(p){ return p.termine; }).length;
  var manquants = pasEncoreVus(lignes);

  var puces = '<button class="puce' + (!classe ? ' on' : '') + '" data-classe="">Toutes</button>' +
    classesPresentes().map(function(n){
      return '<button class="puce' + (cle(classe) === cle(n) ? ' on' : '') + '" data-classe="' + esc(n) + '">' + esc(n) + '</button>';
    }).join('');

  boite.innerHTML =
    '<h2>📱 Travail à la maison</h2>' +
    '<div class="id">Sur téléphone, sans compte : l\'élève écrit son prénom, choisit sa classe, et commence.</div>' +

    (url
      ? '<label for="dvLien">Le lien à donner aux élèves</label>' +
        '<div class="dv-lien"><input id="dvLien" readonly value="' + esc(url) + '">' +
        '<button class="btn primaire" id="dvCopier">Copier</button>' +
        '<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">Ouvrir</a></div>' +
        '<p class="dv-note">Ce lien est celui de ton établissement. Les lignes se suppriment toutes seules ' +
        esc(String(donnees.conservationMois)) + ' mois après la dernière activité.</p>'
      : '<div class="msg ko">Aucune page à distribuer : <code>devoirMaison</code> est vide dans scripts/config.js.</div>') +

    (listeDevoirs.length > 1
      ? '<div class="dv-devoirs">' + listeDevoirs.map(function(d){
          return '<button class="puce' + (d === devoir ? ' on' : '') + '" data-devoir="' + esc(d) + '">' + esc(TITRES[d] || d) + '</button>';
        }).join('') + '</div>'
      : '<h3 class="dv-titre">' + esc(TITRES[devoir] || devoir) + '</h3>') +

    '<div class="filtres dv-filtres">' + puces +
      '<span class="qui">' + (lignes.length
        ? pluriel(lignes.length, 'élève a ouvert le travail', 'élèves ont ouvert le travail') + ' · ' +
          pluriel(finis, 'l\'a terminé', 'l\'ont terminé')
        : '') + '</span></div>' +

    (lignes.length
      ? '<div class="dv-cadre"><table class="dv-table"><thead><tr>' +
        '<th>Prénom</th><th>Classe</th><th>État</th><th>Missions faites</th><th>Score</th><th>Dernière activité</th><th></th>' +
        '</tr></thead><tbody>' + lignes.map(function(p){ return ligne(p, doublons); }).join('') + '</tbody></table></div>'
      : '<div class="vide dv-vide">' + (tous.length
          ? 'Aucun élève de cette classe n\'a encore ouvert le travail.'
          : 'Personne n\'a encore ouvert le travail. Donne le lien ci-dessus aux élèves : ils apparaîtront ici dès leur prénom écrit.') + '</div>') +

    (classe
      ? '<div class="dv-manque"><b>Pas encore vus en ' + esc(classe) + ' (' + manquants.length + ')</b> ' +
        (manquants.length
          ? manquants.map(function(e){ return '<span>' + esc(e.prenom) + ' ' + esc(String(e.nom || '').charAt(0)) + '.</span>'; }).join('')
          : '<em>Tous les prénoms de la classe sont là.</em>') +
        '<p class="dv-note">Comparé aux prénoms des comptes de la classe. Un surnom ou une faute de frappe fausse cette liste.</p></div>'
      : (lignes.length ? '<p class="dv-note">Choisis une classe pour voir qui ne l\'a pas encore ouvert.</p>' : '')) +

    '<div class="actes">' +
      '<button class="btn" id="dvActualiser">↻ Actualiser</button>' +
      (lignes.length ? '<button class="btn danger" id="dvVider">🗑 Effacer ' +
        (classe ? 'les lignes de ' + esc(classe) : 'toutes les lignes') + '</button>' : '') +
      '<button class="btn pousse" id="dvFermer">Fermer</button>' +
    '</div>';

  brancher();
}

function brancher(){
  var q = function(s){ return boite.querySelector(s); };
  var tous = function(s){ return Array.prototype.slice.call(boite.querySelectorAll(s)); };

  tous('[data-classe]').forEach(function(b){
    b.addEventListener('click', function(){ classe = b.getAttribute('data-classe') || null; peindre(); });
  });
  tous('[data-devoir]').forEach(function(b){
    b.addEventListener('click', function(){ devoir = b.getAttribute('data-devoir'); classe = null; peindre(); });
  });
  tous('[data-suppr]').forEach(function(b){
    b.addEventListener('click', function(){
      var id = b.getAttribute('data-suppr');
      var p = donnees.passages.filter(function(x){ return x.id === id; })[0];
      if(!p || !confirm('Effacer la ligne de ' + p.prenom + ' (' + (p.classe || 'sans classe') + ') ?\n\n' +
        'Si l\'élève rouvre le travail sur le même téléphone, sa ligne reviendra avec son score.')) return;
      api('DELETE', '/api/prof/devoirs', { id: id }).then(charger).catch(function(e){ alert(e.message); });
    });
  });

  if(q('#dvCopier')) q('#dvCopier').addEventListener('click', function(){
    var champ = q('#dvLien'), bouton = this;
    var fait = function(){ bouton.textContent = 'Copié ✓'; setTimeout(function(){ bouton.textContent = 'Copier'; }, 1800); };
    var aLaMain = function(){ champ.focus(); champ.select(); try{ if(document.execCommand('copy')) fait(); }catch(e){} };
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(champ.value).then(fait, aLaMain);
    else aLaMain();
  });
  if(q('#dvLien')) q('#dvLien').addEventListener('focus', function(){ this.select(); });

  q('#dvActualiser').addEventListener('click', charger);
  q('#dvFermer').addEventListener('click', function(){ fermer(); });
  if(q('#dvVider')) q('#dvVider').addEventListener('click', function(){
    var n = visibles().length;
    if(!confirm('Effacer ' + pluriel(n, 'ligne', 'lignes') + (classe ? ' de ' + classe : '') + ' ?\n\n' +
      'Les scores sont perdus côté tableau de bord. Les élèves gardent leur avancée sur leur téléphone.')) return;
    var corps = { devoir: devoir };
    if(classe) corps.classe = classe;
    api('DELETE', '/api/prof/devoirs', corps).then(charger).catch(function(e){ alert(e.message); });
  });
}

function charger(){
  return api('GET', '/api/prof/devoirs').then(function(r){
    /* Rien de neuf : on ne repeint pas. Un rafraîchissement qui redessine la fenêtre
       toutes les 30 s ferait sauter le défilement et la sélection du lien. */
    var nouvelle = JSON.stringify(r);
    if(nouvelle === empreinte && donnees) return;
    empreinte = nouvelle;
    donnees = r;
    if(!devoir) devoir = (r.passages[0] && r.passages[0].devoir) || 'pc-1';
    /* La fenêtre a pu être fermée, ou remplacée par une autre, pendant l'appel. */
    if(boite && document.body.contains(boite)) peindre();
  }).catch(function(e){
    if(boite && document.body.contains(boite) && !donnees){
      boite.innerHTML = '<h2>📱 Travail à la maison</h2><div class="msg ko">' +
        (e.statut === 404
          ? 'Le serveur ne connaît pas encore cette fonction : l\'API doit être redéployée (api/README.md § 2.4).'
          : esc(e.message)) +
        '</div><div class="actes"><button class="btn pousse" id="dvFermer">Fermer</button></div>';
      boite.querySelector('#dvFermer').addEventListener('click', function(){ fermer(); });
    }
  });
}

function arreter(){ if(minuteur){ clearInterval(minuteur); minuteur = null; } }

function ouvrirDevoirs(){
  arreter();
  empreinte = '';
  boite = ouvrir('<h2>📱 Travail à la maison</h2><div class="vide">Chargement…</div>', 'large');
  charger();
  minuteur = setInterval(function(){
    /* Fenêtre fermée (Échap, clic à côté, autre fenêtre ouverte) : on cesse d'interroger. */
    if(!boite || !document.body.contains(boite)){ arreter(); return; }
    charger();
  }, RYTHME);
}

window.Devoirs = { ouvrir: ouvrirDevoirs };
})();
