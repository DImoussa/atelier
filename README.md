# Atelier (nom provisoire)

Tableau visuel infini façon « moodboard / planches » : notes, liens, tâches, images, fichiers, colonnes, lignes, planches imbriquées…
Tout est enregistré **localement dans le navigateur** (IndexedDB), sans serveur.

## Lancer

```
npm install
npm run dev      # http://localhost:5173
npm run build    # version de production dans dist/
```

## Changer le nom / l'identité

| Quoi | Où |
|---|---|
| Nom de l'app | `APP_NAME` dans `src/types.ts` + `<title>` dans `index.html` |
| Logo | `AppLogo` dans `src/icons.tsx` + favicon dans `index.html` |
| Couleurs, polices | variables en haut de `src/styles.css` (`--orange`, `--accent`, `--serif`…) |
| Palettes de cartes / planches / lignes | `CARD_COLORS`, `BOARD_COLORS`, `LINE_COLORS` dans `src/types.ts` |
| Contenu de bienvenue et modèles | `src/templates.ts` |

## Organisation du code

- `src/store.ts` — données, historique annuler/rétablir, sauvegarde, actions (créer, déplacer, dupliquer, corbeille…)
- `src/components/Canvas.tsx` — canevas infini : défilement, zoom, sélection, glisser, aimantation, dépôts
- `src/components/cards/` — chaque type de carte
- `src/components/LinesLayer.tsx` — lignes et flèches
- `src/components/Menus.tsx` — menu clic droit, barre de sélection, barre de mise en forme
- `src/components/Panels.tsx` — À trier, corbeille, recherche
- `src/components/modals/` — dessin, document plein écran, visionneuse, partage, réglages…
- `src/exporter.ts` — export PNG / PDF / planche .json / sauvegarde complète
- `src/exportText.ts` — export Markdown et Word
- `src/presentation.tsx` — mode présentation plein écran
- `src/templates.ts` — galerie de modèles (17) et contenu de bienvenue

## Limites de la version locale

- Pas de comptes ni de collaboration en temps réel : le partage passe par un export (.json, PDF, PNG) ou la vue lecture seule sur le même appareil.
- Les aperçus de liens n'affichent que le domaine et le favicon (les titres de pages web ne peuvent pas être lus sans serveur) ; les vidéos YouTube et Vimeo ont une vignette et se lisent dans la carte.
- Les données vivent dans le navigateur utilisé : pensez à « Sauvegarde complète » (menu ⋯) de temps en temps.
