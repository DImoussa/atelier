# Message pour l'IA de l'autre compte — projet « Atelier »

Salut ! Voici où en est ce projet après la session du 25/11/2026. Lis ce fichier en entier avant de toucher au code.

## Le projet en une phrase

Un clone complet de Milanote (tableaux visuels infinis : notes, images, liens, tâches, colonnes, flèches, planches imbriquées). Le nom **« Atelier » est provisoire** : l'utilisateur renommera tout lui-même plus tard (voir `README.md`, section « Changer le nom »). Ne pas reprendre le nom, le logo ni les images de Milanote.

## Où en est l'app

- **Dossier :** `Documents\atelier`, sans dépôt git pour l'instant.
- **Stack :** React 18, Vite et TypeScript, avec zustand et immer pour l'état. Pas de serveur : tout est enregistré dans le navigateur (IndexedDB, base `atelier-db`).
- **Lancer :** `npm install` puis `npm run dev`, qui ouvre http://localhost:5173. `npm run build` passe sans erreur.
- **Architecture :** décrite dans `README.md`. Les fichiers clés sont `src/store.ts` (données, historique, actions) et `src/components/Canvas.tsx` (toutes les interactions à la souris et au doigt).

## Ce qui a été fait aujourd'hui

1. **Première version complète.**
   - Canevas infini : défilement, zoom, sélection au cadre, aimantation entre cartes.
   - 14 types de cartes : note riche, tâches, lien et vidéo YouTube/Vimeo, image, fichier, colonne, planche, ligne et flèche, titre, couleur, dessin, tableau, commentaire, document plein écran.
   - Organisation : « À trier », corbeille, recherche globale (Ctrl K), annuler/rétablir.
   - Édition : copier/coller, menu clic droit, raccourcis clavier.
   - Partage : exports PNG, PDF et planche `.json` (aller-retour testé), sauvegarde complète, lecture seule, thème sombre.
2. **Deuxième passe.**
   - Tâches : échéances (orange le jour J, rouge en retard) et personnes assignées.
   - Planches : couverture et fond (couleur ou image), duplication d'une planche entière.
   - Exports Markdown et Word (`.doc`).
   - Images : recadrage, rotation, ajout par adresse web.
   - Flèches tirées depuis les 4 bords d'une carte.
   - Galerie de 17 modèles en 4 catégories.
   - Mode présentation plein écran, zoom au pincement sur écran tactile.
3. **Troisième passe.**
   - **Demande d'Anne :** un titre s'agrandit en glissant sa poignée, et le texte suit (Maj : largeur seule). Une barre propose aussi A−/A+, les tailles S à XXL, la couleur et l'alignement.
   - Glisser des cartes sur le fil d'Ariane les envoie dans une planche parente.
   - Mémo vocal (outil « Audio »).
   - Zoom sur la sélection (Maj 2).
   - Raccourcis H, D et A.
4. **Bugs corrigés en route.**
   - Texte perdu dans une nouvelle note quand on tapait trop vite.
   - Titre de planche enregistré en majuscules.
   - Entrée dans un titre qui ouvrait la planche.
   - Trait de dessin perdu quand on levait le stylet.
   - Ligne courbe exportée remplie de noir.
   - Barre d'outils qui couvrait les poignées des lignes.
   - Conflit de la classe CSS `ghost` qui empilait des boutons.
   - Une erreur d'affichage faisait tomber toute l'app : des garde-fous `Safe` ont été ajoutés.

## Tests

Un test automatique de 17 points passe. Il couvre :
- les types de cartes ;
- annuler/rétablir ;
- la sécurité XSS ;
- dupliquer, les colonnes, la corbeille et les lignes rattachées ;
- l'alignement, les déplacements et « À trier » ;
- le copier-coller et la duplication de planche ;
- la lecture seule et la sauvegarde.

Toutes les nouveautés ont aussi été essayées dans le navigateur.

**Pas testé en vrai :**
- l'enregistrement au micro ;
- l'ajout d'une image depuis une vraie adresse web ;
- Ctrl+V au clavier (la logique de collage, elle, est testée).

## Règles à respecter

- **Les données de l'utilisateur sont dans son navigateur.** Pour tester, crée une planche à part et supprime-la ensuite. Ne vide jamais la base. En mode dev, `window.__store` et `window.__api` (tout `store.ts`) sont dispos dans la console pour ça.
- Aujourd'hui, l'historique d'annulation a été vidé deux fois après les tests. L'utilisateur l'a remarqué et n'a pas aimé. La prochaine fois, ne vide pas tout : retire seulement les entrées qui concernent ta planche de test.
- Tout reste **local, sans serveur** tant que l'utilisateur n'a pas choisi de passer à Supabase.
- L'utilisateur veut un travail **complet et fluide**, pas bâclé. Teste avant d'annoncer que c'est fini.

## Idées en attente (rien n'est validé)

- Garder l'historique d'annulation après un rechargement de page (proposé, pas de réponse).
- Version Supabase : comptes, collaboration en direct, synchronisation, vrais aperçus de liens. Ça demande un serveur.
- Pousser le projet sur git : pas encore de dépôt, à faire seulement si l'utilisateur le demande.
