/* Vocabulaire des mots de passe élèves.
 *
 * Uniquement des mots courants, courts, SANS accent ni trait d'union : un élève de 6e
 * les recopie depuis sa carte sans se tromper, et un élève dyslexique n'a pas à deviner
 * quelle lettre porte quel accent. Pas de mot prêtant à moquerie, pas d'homophone piège
 * (« ver / verre / vert »), pas de couple qui se confond à la lecture. */
export const MOTS = [
  'avion','balai','balcon','banane','bateau','bijou','bille','bison','blouse','bocal',
  'bonbon','botte','boule','boussole','bouton','branche','brique','bulle','bureau','cactus',
  'cadeau','cadre','caillou','camion','canard','canif','canon','carotte','cartable','casque',
  'castor','cerise','chameau','champion','chapeau','chemin','cheval','chien','cible','cigale',
  'citron','clairon','clavier','cloche','cochon','colline','collier','compas','confiture','coquille',
  'corbeau','corde','coton','couloir','coussin','crabe','crayon','cuivre','dauphin','diamant',
  'dindon','domino','donjon','dragon','drapeau','encre','escargot','falaise','fanfare','farine',
  'ferme','feuille','figue','filet','flamant','fleur','flocon','fourmi','fraise','framboise',
  'galet','garage','gazon','girafe','gomme','gorille','goutte','grange','grelot','grenier',
  'griffe','guitare','hameau','harpe','hibou','horloge','iceberg','igloo','image','jardin',
  'jonquille','jungle','kangourou','koala','lampe','lanterne','lapin','licorne','lierre','limace',
  'lion','loupe','lucarne','lutin','machine','maison','marmotte','marteau','masque','melon',
  'menthe','miroir','momie','moineau','montagne','moulin','mouton','muguet','museau','navire',
  'nuage','olive','ombre','orage','orange','ortie','oursin','palais','panda','panier',
  'papillon','parapluie','patin','peluche','perle','phare','piano','pigeon','pinceau','pingouin',
  'pirate','plume','poire','pomme','poulain','poulpe','prairie','prune','puzzle','quille',
  'radeau','raisin','rateau','renard','requin','robot','rocher','rubis','ruche','sabot',
  'salade','sapin','sauterelle','savon','serpent','sifflet','singe','soleil','sorbet','souris',
  'sucre','table','tambour','tapis','taupe','tempete','tigre','tomate','tortue','toupie',
  'tournesol','tracteur','trefle','tresor','tulipe','tunnel','vague','valise','vanille','verger',
  'village','violon','voilier','volcan','zebre'
];

/* Alphabet des mots de passe « forts » : ni i/l/1, ni o/0 — les confusions classiques
   quand on recopie un code depuis une feuille imprimée. */
export const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
