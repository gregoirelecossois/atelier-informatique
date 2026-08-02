/* Synthèse vocale de l'atelier — clic sur un 🔊 pour lire, re-clic pour arrêter.
 * Clips pré-générés (voix Denise) dans window.TTS_CLIPS, indexés par hash de contenu.
 * Repli sur la voix du navigateur si le clip n'existe pas encore.
 * Les fonctions ttsNormalize/ttsKey DOIVENT rester identiques à tts/build-tts.mjs. */
(function(){
  'use strict';

  function ttsNormalize(s){
    return String(s)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      // On NE lit PAS les emojis : on les retire avant la synthèse vocale.
      // (doit rester identique à tts/engine.mjs pour que les hash de clips concordent)
      .replace(/[\u{1F000}-\u{1FAFF}]/gu, ' ')
      .replace(/[\u{2600}-\u{27BF}]/gu, ' ')
      .replace(/[\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu, ' ')
      .replace(/[\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '')
      // Le boss du clavier s'écrit K0RT3X mais se prononce « Kortex »
      .replace(/K0RT3X/g, 'Kortex')
      .replace(/\s+/g, ' ').trim();
  }
  function ttsKey(s){
    const t = ttsNormalize(s);
    let h = 0x811c9dc5;
    for (let i=0;i<t.length;i++){ h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h>>>0).toString(16).padStart(8,'0') + '_' + t.length;
  }

  // ----- déverrouillage audio ----------------------------------------------
  // Filet de sécurité : un clic sur le 🔊 est déjà un vrai geste utilisateur
  // (l'autoplay des navigateurs l'autorise), donc ce déverrouillage n'est en
  // principe plus nécessaire — on le garde par prudence (repli voix, autres
  // futurs déclencheurs) en le posant dès le tout premier geste sur la page.
  let audioUnlocked = false;
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  function unlockAudio(){
    if (audioUnlocked) return;
    audioUnlocked = true;
    try{ new Audio(SILENT_WAV).play().catch(()=>{}); }catch(e){}
  }
  ['pointerdown','keydown','touchstart'].forEach(ev=>
    document.addEventListener(ev, unlockAudio, {capture:true, once:true}));

  // ----- lecteur audio (un seul à la fois) --------------------------------
  const PLAY_ICON = '🔊', STOP_ICON = '⏹';
  let curAudio = null, curBtn = null, curWatch = null;
  function setIcon(btn, ch){ if(btn) btn.textContent = ch; }
  // Hooks facultatifs qu'un atelier peut brancher pour baisser sa musique de
  // fond pendant la lecture TTS (elle ne doit plus être qu'un léger fond sonore).
  function notifyTtsStart(){ if (window.onTtsStart) try{ window.onTtsStart(); }catch(e){} }
  function notifyTtsEnd(){ if (window.onTtsEnd) try{ window.onTtsEnd(); }catch(e){} }
  function stopCurrent(){
    if (curWatch){ clearInterval(curWatch); curWatch=null; }
    if (curAudio){ try{ curAudio.pause(); }catch(e){} curAudio=null; }
    if (window.speechSynthesis){ try{ speechSynthesis.cancel(); }catch(e){} }
    if (curBtn){ curBtn.classList.remove('playing'); setIcon(curBtn, PLAY_ICON); curBtn=null; }
    notifyTtsEnd();
  }
  // Les cartes de tutoriel de boss vivent hors de #modal : elles ne passent pas par
  // closeOverlay(), donc rien n'appellerait ttsStopCurrent() à leur fermeture. On coupe
  // l'audio dès que le bouton qui l'a lancé quitte le DOM (carte retirée par le jeu).
  function watchDetach(btn){
    if (curWatch) clearInterval(curWatch);
    curWatch = setInterval(()=>{ if (!btn.isConnected) stopCurrent(); }, 400);
  }
  function pickFrenchVoice(){
    if (!window.speechSynthesis) return null;
    const vs = speechSynthesis.getVoices()||[];
    return vs.find(v=>/denise/i.test(v.name)) ||
           vs.find(v=>/fr[-_]?FR/i.test(v.lang) && /natural|neural/i.test(v.name)) ||
           vs.find(v=>/^fr/i.test(v.lang)) || null;
  }
  function speakFallback(text, btn){
    if (!window.speechSynthesis){ notifyTtsEnd(); return; }
    const u = new SpeechSynthesisUtterance(ttsNormalize(text));
    u.lang='fr-FR'; u.rate=0.95;
    const v = pickFrenchVoice(); if (v) u.voice=v;
    u.onend=()=>{ if(btn){ btn.classList.remove('playing'); setIcon(btn, PLAY_ICON); } notifyTtsEnd(); };
    speechSynthesis.speak(u);
  }
  function play(text, btn){
    stopCurrent();
    curBtn = btn; if (btn){ btn.classList.add('playing'); watchDetach(btn); }
    const clip = window.TTS_CLIPS && window.TTS_CLIPS[ttsKey(text)];
    notifyTtsStart();
    if (clip){
      const a = new Audio(clip); curAudio = a;
      a.onended = ()=>{ if(btn){ btn.classList.remove('playing'); setIcon(btn, PLAY_ICON); } curAudio=null; notifyTtsEnd(); };
      a.play().catch(()=>{ // repli voix si la lecture échoue malgré le clic (cas rare)
        curAudio=null; if (curBtn===btn) speakFallback(text, btn); else notifyTtsEnd();
      });
    } else {
      speakFallback(text, btn);
    }
  }

  // ----- style + bouton ----------------------------------------------------
  function injectStyleOnce(){
    if (document.getElementById('tts-style')) return;
    const st = document.createElement('style'); st.id='tts-style';
    st.textContent = `
      .tts-speaker{position:absolute;top:10px;right:12px;z-index:5;width:38px;height:38px;
        border-radius:50%;border:2px solid #7bc47f;background:#eefaef;color:#2f7d34;
        font-size:1.15rem;line-height:1;cursor:pointer;display:flex;align-items:center;
        justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.12);transition:transform .12s,background .12s;}
      .tts-speaker:hover{background:#d8f3da;transform:scale(1.08);}
      .tts-speaker.playing{animation:tts-pulse .9s ease-in-out infinite;background:#c4edc7;}
      @keyframes tts-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}
      @media (prefers-reduced-motion:reduce){.tts-speaker.playing{animation:none}}
    `;
    document.head.appendChild(st);
  }

  // Appelée par openOverlay() après avoir rempli le modal.
  // Lit modal.dataset.ttsText (posé par la popup), puis CONSOMME l'attribut
  // pour qu'il ne « fuite » pas vers la popup suivante.
  window.ttsDecorateModal = function(modal){
    if (!modal) return;
    const old = modal.querySelector(':scope > .tts-speaker'); if (old) old.remove();
    const text = modal.dataset.ttsText;
    modal.removeAttribute('data-tts-text');
    if (!text) return;
    injectStyleOnce();
    if (getComputedStyle(modal).position === 'static') modal.style.position = 'relative';
    const btn = document.createElement('button');
    btn.type='button'; btn.className='tts-speaker'; btn.textContent=PLAY_ICON;
    btn.setAttribute('aria-label','Écouter la consigne'); btn.title='Écouter';
    // Clic = lecture ; re-clic (pendant la lecture) = arrêt. Survol pendant la
    // lecture : l'icône devient un carré ⏹ pour indiquer qu'un clic arrêtera.
    btn.addEventListener('click', ()=>{
      if (btn.classList.contains('playing')) stopCurrent();
      else play(text, btn);
    });
    btn.addEventListener('mouseenter', ()=>{ if (btn.classList.contains('playing')) setIcon(btn, STOP_ICON); });
    btn.addEventListener('mouseleave', ()=>{ if (btn.classList.contains('playing')) setIcon(btn, PLAY_ICON); });
    modal.appendChild(btn);
  };

  // Variante pour les cartes dessinées HORS de #modal : les tutoriels de boss, qui
  // s'affichent dans le terrain de jeu et ne passent donc pas par openOverlay().
  // `sel` (optionnel) cible le sous-élément qui porte le 🔊 (la boîte visible de la
  // carte), le conteneur étant souvent un calque plein écran transparent.
  // Le texte lu est déduit des sélecteurs `parts` (titre, consigne…) : aucune carte
  // n'a besoin de répéter son texte, il suit automatiquement le contenu affiché.
  window.ttsDecorateCard = function(card, sel, parts){
    if (!card) return;
    const host = sel ? card.querySelector(sel) : card;
    if (!host) return;
    const text = (parts||[]).map(p=>
      [...card.querySelectorAll(p)].map(el=>el.innerHTML).filter(Boolean).join(' ')
    ).filter(Boolean).join('. ');
    if (!ttsNormalize(text)) return;
    host.dataset.ttsText = text;
    window.ttsDecorateModal(host);
  };

  // Exposée pour que le jeu coupe l'audio quand la popup qui l'a lancé se ferme.
  window.ttsStopCurrent = stopCurrent;

  // catalogue de textes lus « statiques » (réussite, déblocage…), partagé avec le build
  try {
    const el = document.getElementById('tts-static');
    window.TTS_STATIC = el ? JSON.parse(el.textContent) : {};
  } catch(e){ window.TTS_STATIC = {}; }

  // pré-charge la liste des voix (certains navigateurs la remplissent tard)
  if (window.speechSynthesis){ try{ speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged=()=>speechSynthesis.getVoices(); }catch(e){} }
})();
