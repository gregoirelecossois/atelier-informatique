/* Compte élève — pastille d'état et fenêtre de connexion.
 *
 * Fichier PARTAGÉ, chargé après scripts/store.js dans les 7 pages. Il n'écrit rien
 * lui-même : il ne fait qu'habiller ce que window.Store sait déjà (qui est connecté,
 * si l'envoi passe). En mode LOCAL — pas d'API dans scripts/config.js, ou page ouverte
 * en file:// — il ne s'affiche pas du tout : l'atelier reste exactement celui d'avant.
 *
 * Où se pose la pastille : dans la .topbar quand il y en a une (les six ateliers), en
 * haut à gauche sinon (page d'accueil). Jamais ailleurs — les ateliers sont verrouillés
 * à 100dvh sans défilement, tout ce qui flotte doit être en position:fixed et petit.
 */
(function(){
'use strict';

if(!window.Store || !Store.enLigne()) return;

var CFG = window.ATELIER_CONFIG || {};
var Z = 2147481500;   /* sous les trophées (2147482000), au-dessus de tout le jeu */

/* ---------------------------------------------------------------------------
   1. Habillage
   --------------------------------------------------------------------------- */
function css(){
  var s = document.createElement('style');
  s.textContent = [
  '.atl-chip{display:inline-flex;align-items:center;gap:7px;border:2px solid #d7e0ea;background:#fff;color:#22303f;',
    'border-radius:999px;padding:6px 12px;font-family:"Nunito",system-ui,"Fluent Emoji",sans-serif;font-weight:800;',
    'font-size:.82rem;line-height:1;cursor:pointer;white-space:nowrap;transition:border-color .2s,background .2s;}',
  '.atl-chip:hover{border-color:#9fb6cd;}',
  '.atl-chip.warn{border-color:#e0a416;background:#fffbf0;}',
  '.atl-chip.bad{border-color:#dc2626;background:#fef2f2;}',
  '.atl-chip.ok{border-color:#16a34a;background:#f1fbf4;}',
  '.atl-chip .atl-pt{width:9px;height:9px;border-radius:50%;background:#16a34a;flex:none;}',
  '.atl-chip.warn .atl-pt{background:#e0a416;}',
  '.atl-chip.bad .atl-pt{background:#dc2626;}',
  '.atl-chip.busy .atl-pt{background:#0891b2;animation:atl-pulse 1s ease-in-out infinite;}',
  '@keyframes atl-pulse{0%,100%{opacity:1}50%{opacity:.25}}',
  '.atl-float{position:fixed;top:16px;left:16px;z-index:600;box-shadow:0 6px 18px rgba(34,48,63,.20);}',
  '@media (max-width:640px){.atl-chip .atl-txt{display:none}.atl-chip{padding:6px 9px}}',

  '.atl-back{position:fixed;inset:0;z-index:'+Z+';background:rgba(20,30,42,.62);display:flex;align-items:center;',
    'justify-content:center;padding:18px;font-family:"Nunito",system-ui,"Fluent Emoji",sans-serif;}',
  '.atl-box{background:#fff;border-radius:20px;padding:26px 26px 22px;width:min(400px,100%);max-height:92dvh;',
    'overflow:auto;box-shadow:0 24px 60px rgba(15,25,38,.35);color:#22303f;}',
  '.atl-box h2{font-family:"Fredoka","Fluent Emoji",sans-serif;font-weight:600;font-size:1.35rem;margin:0 0 4px;}',
  '.atl-box .atl-sub{color:#5d6f83;font-size:.86rem;margin:0 0 18px;line-height:1.4;}',
  '.atl-box label{display:block;font-weight:800;font-size:.82rem;margin:0 0 5px;}',
  '.atl-box input{width:100%;box-sizing:border-box;border:2px solid #d7e0ea;border-radius:12px;padding:11px 13px;',
    'font-family:inherit;font-size:1rem;font-weight:700;color:#22303f;background:#fbfdff;margin:0 0 14px;}',
  '.atl-box input:focus{outline:none;border-color:#2563eb;background:#fff;}',
  '.atl-err{background:#fef2f2;border:2px solid #fecaca;color:#b91c1c;border-radius:12px;padding:9px 12px;',
    'font-size:.84rem;font-weight:700;margin:0 0 14px;line-height:1.35;}',
  '.atl-acts{display:flex;gap:9px;margin-top:4px;}',
  '.atl-btn{flex:1;border:none;border-radius:999px;padding:12px 16px;font-family:inherit;font-weight:800;',
    'font-size:.94rem;cursor:pointer;transition:filter .15s;}',
  '.atl-btn:hover{filter:brightness(1.07);}',
  '.atl-btn[disabled]{opacity:.55;cursor:progress;}',
  '.atl-btn.primary{background:#2563eb;color:#fff;}',
  '.atl-btn.ghost{background:#eef3f9;color:#3c4d61;}',
  '.atl-btn.danger{background:#fee2e2;color:#b91c1c;}',
  '.atl-note{margin:16px 0 0;font-size:.79rem;color:#7b8b9d;line-height:1.45;text-align:center;}',
  '.atl-rgpd{margin:12px 0 0;font-size:.76rem;color:#7b8b9d;line-height:1.5;}',
  '.atl-rgpd summary{cursor:pointer;font-weight:800;color:#5d6f83;text-align:center;}',
  '.atl-rgpd summary:hover{color:#2563eb;}',
  '.atl-rgpd p{margin:9px 0 0;text-align:left;}',
  '.atl-who{background:#f4f8fd;border-radius:14px;padding:13px 15px;margin:0 0 16px;}',
  '.atl-who b{display:block;font-size:1.05rem;}',
  '.atl-who span{color:#5d6f83;font-size:.84rem;}',

  /* Liste des règles du mot de passe : elle se coche en direct pendant la frappe.
     Un élève de 6e ne lit pas une phrase de refus après coup — il regarde ce qui
     manque encore pendant qu'il tape. */
  '.atl-regles{list-style:none;margin:0 0 14px;padding:0;display:grid;gap:3px;}',
  '.atl-regles li{font-size:.82rem;font-weight:700;color:#8a99aa;line-height:1.35;}',
  '.atl-regles li::before{content:"○ ";font-weight:800;}',
  '.atl-regles li.ok{color:#16a34a;}',
  '.atl-regles li.ok::before{content:"✓ ";}',
  '.atl-vu{display:flex;align-items:center;gap:7px;margin:-6px 0 14px;font-size:.8rem;',
    'font-weight:700;color:#5d6f83;cursor:pointer;user-select:none;}',
  '.atl-vu input{width:auto;margin:0;}'
  ].join('');
  (document.head||document.documentElement).appendChild(s);
}

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ---------------------------------------------------------------------------
   2. La pastille
   --------------------------------------------------------------------------- */
var chip;

function poserChip(){
  chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'atl-chip';
  chip.innerHTML = '<span class="atl-pt"></span><span class="atl-txt"></span>';
  /* Enveloppé : addEventListener passerait l'événement en 1er argument, que `ouvrir`
     prendrait pour une vue à afficher. */
  chip.addEventListener('click', function(){ ouvrir(); });

  /* Une page peut réserver l'emplacement de la pastille avec data-atl-compte : c'est
     ce que fait le tableau de bord, dont l'en-tête est déjà occupé et où une pastille
     flottante en haut à gauche viendrait recouvrir le titre. À défaut, on se glisse
     dans la .topbar des ateliers, et en dernier recours on flotte. */
  var place = document.querySelector('[data-atl-compte]') || document.querySelector('.topbar');
  if(place){ place.appendChild(chip); }
  else { chip.classList.add('atl-float'); document.body.appendChild(chip); }
}

function peindre(e){
  if(!chip) return;
  var el = Store.eleve(), txt = chip.querySelector('.atl-txt');
  chip.classList.remove('ok','warn','bad','busy');

  if(!el){
    chip.classList.add(CFG.insisterConnexion === false ? 'warn' : 'bad');
    txt.textContent = e === 'expire' ? 'Session expirée — reconnecte-toi' : 'Non connecté·e';
    chip.title = 'Ta progression n\'est pas sauvegardée. Clique pour te connecter.';
    return;
  }
  if(e === 'envoi'){
    chip.classList.add('busy');
    txt.textContent = el.prenom + ' · sauvegarde…';
    chip.title = 'Sauvegarde en cours…';
  }else if(e === 'hors-ligne'){
    chip.classList.add('warn');
    txt.textContent = el.prenom + ' · hors ligne';
    chip.title = 'Pas de réseau : ta progression est gardée sur le poste et repartira dès le retour de la connexion.';
  }else{
    chip.classList.add('ok');
    txt.textContent = el.prenom + (el.classe ? ' · ' + el.classe : '');
    chip.title = 'Connecté·e. Ta progression est sauvegardée.';
  }
}

/* ---------------------------------------------------------------------------
   3. La fenêtre
   --------------------------------------------------------------------------- */
var back = null;
var verrouillee = false;   /* fenêtre qu'on ne peut pas refermer : création du mot de passe */

function fermer(){
  if(!back || verrouillee) return;
  document.removeEventListener('keydown', auClavier, true);
  if(back.parentNode) back.parentNode.removeChild(back);
  back = null;
}
function auClavier(ev){ if(ev.key === 'Escape'){ ev.stopPropagation(); fermer(); } }

/* `vue` force un écran précis ; sans elle on montre le compte ou la connexion.
   `bloquante` retire les deux sorties habituelles (Échap et clic dans le vide) : c'est
   le cas de la création du mot de passe, qu'on ne contourne pas en cliquant à côté. */
function ouvrir(vue, bloquante){
  if(back){ if(!vue) return; fermer(); }
  verrouillee = !!bloquante;
  back = document.createElement('div');
  back.className = 'atl-back';
  back.addEventListener('mousedown', function(ev){ if(ev.target === back) fermer(); });
  document.addEventListener('keydown', auClavier, true);
  document.body.appendChild(back);
  (vue || (Store.eleve() ? vueCompte : vueConnexion))();
}

function vueCompte(){
  var el = Store.eleve();
  back.innerHTML =
    '<div class="atl-box">'+
      '<h2>Ton compte</h2>'+
      '<div class="atl-who"><b>'+esc(el.prenom+' '+el.nom)+'</b>'+
        '<span>'+esc(el.classe || 'Sans classe')+' · identifiant <b style="display:inline">'+esc(el.identifiant)+'</b></span></div>'+
      '<p class="atl-sub" style="margin-bottom:16px">Ta progression et tes trophées sont enregistrés sur le serveur du collège : '+
        'tu les retrouveras sur n\'importe quel poste.</p>'+
      /* Le tableau de bord n'est jamais annoncé aux élèves : il n'apparaît que dans la
         fenêtre de compte d'un enseignant connecté. Le serveur vérifie le rôle de son
         côté, ce bouton n'est qu'un raccourci. */
      (el.role === 'prof'
        ? '<a class="atl-btn primaire" href="prof.html" style="display:block;text-align:center;'+
          'text-decoration:none;margin-bottom:9px">📊 Suivi des élèves</a>'
        : '')+
      '<button type="button" class="atl-btn ghost" data-a="mdp" style="width:100%;margin-bottom:9px">'+
        '🔑 Changer mon mot de passe</button>'+
      '<div class="atl-acts">'+
        '<button type="button" class="atl-btn ghost" data-a="fermer">Continuer</button>'+
        '<button type="button" class="atl-btn danger" data-a="sortir">Se déconnecter</button>'+
      '</div>'+
      '<p class="atl-note">Déconnecte-toi à la fin de l\'heure pour que le poste soit libre pour l\'élève suivant.</p>'+
    '</div>';

  back.querySelector('[data-a=fermer]').onclick = fermer;
  back.querySelector('[data-a=mdp]').onclick = function(){ vueMotDePasse(false); };
  back.querySelector('[data-a=sortir]').onclick = function(){
    var b = this; b.disabled = true; b.textContent = 'Sauvegarde…';
    Store.deconnexion().then(function(){ location.reload(); });
  };
}

/* ---------------------------------------------------------------------------
   3 bis. Le mot de passe que l'élève choisit lui-même

   Le mot de passe distribué par l'enseignant est TEMPORAIRE : il a été imprimé, lu à
   voix haute, parfois recopié sur un cahier. Tant qu'il sert, l'empreinte gardée en
   base ne protège rien. À la première connexion, l'élève en choisit donc un que
   personne d'autre ne connaît — et il le tape DEUX FOIS, parce qu'un mot de passe
   choisi puis mal retapé est un compte perdu jusqu'à la prochaine réinitialisation.

   Les règles ci-dessous sont la copie EXACTE de REGLES_MDP dans api/motsdepasse.js.
   Ici elles servent à guider pendant la frappe ; c'est le serveur qui décide.
   --------------------------------------------------------------------------- */
var MDP_MIN = 12;   /* doit rester égal à MDP_MIN dans api/motsdepasse.js */
var REGLES = [
  { texte: 'au moins ' + MDP_MIN + ' caractères', ok: function(m){ return m.length >= MDP_MIN; } },
  { texte: 'une MAJUSCULE',                       ok: function(m){ return /[A-ZÀ-ÖØ-Þ]/.test(m); } },
  { texte: 'une minuscule',                       ok: function(m){ return /[a-zß-öø-ÿ]/.test(m); } },
  { texte: 'un chiffre',                          ok: function(m){ return /[0-9]/.test(m); } },
  { texte: 'un symbole (! ? @ # € + - _ …)',      ok: function(m){ return /[^0-9A-Za-zÀ-ÖØ-öø-ÿ\s]/.test(m); } }
];

/* `premiere` : première connexion — la fenêtre est bloquante et ne demande pas le mot
   de passe actuel (l'élève vient de s'en servir pour entrer). Sinon c'est un changement
   volontaire depuis « Ton compte », et le mot de passe actuel est exigé. */
function vueMotDePasse(premiere){
  var el = Store.eleve() || {};
  back.innerHTML =
    '<div class="atl-box">'+
      '<h2>'+(premiere ? 'Choisis ton mot de passe' : 'Changer ton mot de passe')+'</h2>'+
      '<p class="atl-sub">'+
        (premiere
          ? 'Bienvenue '+esc(el.prenom)+' ! Celui que ton professeur t\'a donné était provisoire. '+
            'Invente-en un que <b>toi seul</b> connais, et retiens-le bien : personne ne pourra te le redonner.'
          : 'Choisis un nouveau mot de passe. Tes autres sessions ouvertes seront fermées.')+
      '</p>'+
      '<div id="atlErr"></div>'+
      (premiere ? '' :
        '<label for="atlAnc">Ton mot de passe actuel</label>'+
        '<input id="atlAnc" type="password" autocomplete="off" placeholder="•••••••••">')+
      '<label for="atlN1">Nouveau mot de passe</label>'+
      '<input id="atlN1" type="password" autocomplete="off" placeholder="•••••••••">'+
      '<ul class="atl-regles" id="atlRegles">'+
        REGLES.map(function(r){ return '<li>'+esc(r.texte)+'</li>'; }).join('')+
      '</ul>'+
      '<label class="atl-vu"><input type="checkbox" id="atlVu"> Montrer ce que je tape</label>'+
      '<label for="atlN2">Retape-le pour vérifier</label>'+
      '<input id="atlN2" type="password" autocomplete="off" placeholder="•••••••••">'+
      '<div class="atl-acts">'+
        (premiere ? '' : '<button type="button" class="atl-btn ghost" data-a="fermer">Annuler</button>')+
        '<button type="button" class="atl-btn primary" data-a="ok">Enregistrer</button>'+
      '</div>'+
      /* L'exemple doit passer les règles telles qu'elles sont réglées : 16 caractères,
         les quatre familles. Le proposer trop court apprendrait le contraire de la règle. */
      '<p class="atl-note">Un bon mot de passe se retient sans se deviner : pense à deux mots '+
        'à toi, colle-les, et glisse une majuscule, des chiffres et un signe. '+
        'Exemple de forme (n\'utilise pas celui-là) : <b>Marcelbaleine35!</b></p>'+
    '</div>';

  var anc = back.querySelector('#atlAnc'),
      n1  = back.querySelector('#atlN1'),
      n2  = back.querySelector('#atlN2'),
      vu  = back.querySelector('#atlVu'),
      lis = back.querySelectorAll('#atlRegles li'),
      btn = back.querySelector('[data-a=ok]'),
      err = back.querySelector('#atlErr');

  function erreur(msg){ err.innerHTML = '<div class="atl-err">' + esc(msg) + '</div>'; }

  function cocher(){
    var m = n1.value, i;
    for(i = 0; i < REGLES.length; i++){
      if(REGLES[i].ok(m)) lis[i].classList.add('ok'); else lis[i].classList.remove('ok');
    }
  }
  n1.addEventListener('input', cocher);

  /* Une seule case pour les deux champs : un élève qui n'arrive pas à retaper à
     l'identique a besoin de VOIR les deux, pas seulement le premier. */
  vu.addEventListener('change', function(){
    var t = vu.checked ? 'text' : 'password';
    n1.type = t; n2.type = t;
  });

  function envoyer(){
    var m = n1.value, m2 = n2.value, i;
    for(i = 0; i < REGLES.length; i++){
      if(!REGLES[i].ok(m)){ erreur('Il manque : ' + REGLES[i].texte + '.'); n1.focus(); return; }
    }
    if(m !== m2){
      erreur('Les deux mots de passe ne sont pas les mêmes. Retape le second.');
      n2.value = ''; n2.focus(); return;
    }
    btn.disabled = true; btn.textContent = 'Enregistrement…'; err.innerHTML = '';
    Store.changerMdp(m, anc ? anc.value : '').then(function(){
      verrouillee = false;
      fermer();
      /* Pas de rechargement : la progression est déjà chargée et la session tient
         toujours — recharger ferait perdre une mission commencée. */
      if(chip) peindre(Store.etat());
    }).catch(function(e){
      /* En première connexion, un 401 ne peut pas venir d'un mot de passe actuel faux
         (on ne le demande pas) : la session est tombée. Sans ce cas, l'élève resterait
         enfermé dans une fenêtre qu'il ne peut pas refermer. */
      if(premiere && e && e.statut === 401){ verrouillee = false; location.reload(); return; }
      btn.disabled = false; btn.textContent = 'Enregistrer';
      erreur(e && e.message && e.statut ? e.message
        : 'Impossible de joindre le serveur. Préviens ton professeur.');
      if(e && e.statut === 401 && anc){ anc.value = ''; anc.focus(); }
    });
  }

  btn.onclick = envoyer;
  var annuler = back.querySelector('[data-a=fermer]');
  if(annuler) annuler.onclick = fermer;
  [anc, n1, n2].forEach(function(inp){
    if(!inp) return;
    inp.addEventListener('keydown', function(ev){ if(ev.key === 'Enter'){ ev.preventDefault(); envoyer(); } });
  });
  setTimeout(function(){ (anc || n1).focus(); }, 30);
}

function vueConnexion(){
  back.innerHTML =
    '<div class="atl-box">'+
      '<h2>Connexion</h2>'+
      '<p class="atl-sub">Connecte-toi pour retrouver ta progression et tes trophées'+
        (CFG.etablissement ? ' — ' + esc(CFG.etablissement) : '') + '.</p>'+
      '<div id="atlErr"></div>'+
      '<label for="atlId">Identifiant</label>'+
      '<input id="atlId" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="prenom.n">'+
      '<label for="atlMdp">Mot de passe</label>'+
      '<input id="atlMdp" type="password" autocomplete="off" placeholder="•••••••••">'+
      '<div class="atl-acts">'+
        '<button type="button" class="atl-btn ghost" data-a="fermer">Plus tard</button>'+
        '<button type="button" class="atl-btn primary" data-a="ok">Se connecter</button>'+
      '</div>'+
      '<p class="atl-note">Pas encore de compte ? Demande-le à ton professeur.<br>'+
        'Sans connexion, tu peux jouer, mais rien ne sera gardé quand tu changeras de poste.</p>'+
      /* Information des personnes (RGPD art. 13). Repliée pour ne pas encombrer la
         fenêtre, mais présente à l'endroit exact où la donnée est demandée — voir
         docs/rgpd-mention-information.md, dont ceci est la version courte. */
      '<details class="atl-rgpd"><summary>Que deviennent mes données ?</summary>'+
        "<p>Ton prénom, ton nom, ta classe et ton avancement dans les jeux sont enregistrés "+
        "sur un serveur du collège, en France. Ça sert à deux choses : que tu retrouves ta "+
        "progression sur n'importe quel poste, et que ton professeur puisse t'aider si tu "+
        "bloques. Rien d'autre n'est collecté, rien n'est transmis à qui que ce soit, et "+
        "tout est effacé au bout de deux ans.</p>"+
        "<p>Tu peux demander à voir, corriger ou effacer tes données : parles-en à ton "+
        "professeur ou au chef d'établissement.</p></details>"+
    '</div>';

  var id = back.querySelector('#atlId'), mdp = back.querySelector('#atlMdp'),
      btn = back.querySelector('[data-a=ok]'), err = back.querySelector('#atlErr');

  function erreur(msg){ err.innerHTML = '<div class="atl-err">' + esc(msg) + '</div>'; }

  function envoyer(){
    var i = id.value.trim(), m = mdp.value;
    if(!i || !m){ erreur('Remplis ton identifiant et ton mot de passe.'); return; }
    btn.disabled = true; btn.textContent = 'Connexion…'; err.innerHTML = '';
    Store.connexion(i, m).then(function(){
      location.reload();
    }).catch(function(e){
      btn.disabled = false; btn.textContent = 'Se connecter';
      erreur(e && e.statut === 429
        ? 'Trop d\'essais. Attends une minute avant de réessayer.'
        : (e && e.message && e.statut ? e.message : 'Impossible de joindre le serveur. Préviens ton professeur.'));
      mdp.value = ''; mdp.focus();
    });
  }

  btn.onclick = envoyer;
  back.querySelector('[data-a=fermer]').onclick = fermer;
  [id, mdp].forEach(function(inp){
    inp.addEventListener('keydown', function(ev){ if(ev.key === 'Enter'){ ev.preventDefault(); envoyer(); } });
  });
  setTimeout(function(){ id.focus(); }, 30);
}

/* ---------------------------------------------------------------------------
   4. Démarrage
   --------------------------------------------------------------------------- */
function demarrer(){
  css();
  poserChip();
  Store.surEtat(peindre);
  /* Session tombée pendant la partie : on le dit franchement plutôt que de laisser
     l'élève jouer une heure pour rien. */
  Store.surEtat(function(e){
    if(e !== 'expire') return;
    /* La session est tombée pendant que l'élève choisissait son mot de passe : on
       déverrouille, sinon il reste devant un formulaire que le serveur refusera. */
    if(verrouillee){ verrouillee = false; fermer(); }
    if(!back) ouvrir();
  });
  verifierMdpProvisoire();
  /* Le profil arrive parfois APRÈS le premier peindre() : /api/moi le rafraîchit au
     démarrage, et c'est lui qui porte le drapeau si la page a été rouverte plus tard. */
  Store.surEtat(function(){ verifierMdpProvisoire(); });
}

/* Mot de passe encore provisoire : l'élève le remplace avant de jouer. La fenêtre est
   bloquante — sans quoi la moitié de la classe cliquerait « plus tard » et le mot de
   passe imprimé resterait le vrai mot de passe toute l'année. */
function verifierMdpProvisoire(){
  var el = Store.eleve();
  if(!el || !el.doitChangerMdp || back) return;
  ouvrir(function(){ vueMotDePasse(true); }, true);
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
else demarrer();

})();
