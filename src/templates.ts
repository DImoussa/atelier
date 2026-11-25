import type { Draft } from 'immer';
import type { Doc, CardType, Board } from './types';
import { ROOT_ID } from './types';
import { makeCard, addCardDraft, mutate, get, uid, topCardsOf } from './store';
import { contentBounds } from './interaction';

export interface Spec {
  type: CardType; x?: number; y?: number; w?: number; color?: string | null; data?: any; key?: string;
  children?: Spec[]; board?: Partial<Board>; boardContent?: Spec[]; from?: string; to?: string;
}

const p = (t: string) => `<p>${t}</p>`;
const todo = (title: string, items: string[], done = 0) => ({ title, items: items.map((text, i) => ({ id: uid(), text, done: i < done })) });

/** Construit des cartes à partir d'une description, dans un brouillon. */
export function buildSpecs(d: Draft<Doc>, parent: string, specs: Spec[], ox = 0, oy = 0) {
  const keys = new Map<string, string>();
  const lines: Spec[] = [];
  let z = 1;
  for (const s of specs) {
    if (s.type === 'line') { lines.push(s); continue; }
    const c = makeCard(s.type, parent, (s.x || 0) + ox, (s.y || 0) + oy, s.data, { color: s.color ?? null, z: z++ });
    if (s.w) c.w = s.w;
    addCardDraft(d, c, s.board);
    if (s.key) keys.set(s.key, c.id);
    if (s.children) s.children.forEach((ch, i) => {
      const k = makeCard(ch.type, c.id, 0, 0, ch.data, { order: i, color: ch.color ?? null });
      addCardDraft(d, k, ch.board);
    });
    if (s.type === 'board' && s.boardContent) buildSpecs(d, c.data.boardId, s.boardContent);
  }
  for (const l of lines) {
    const c = makeCard('line', parent, 0, 0, {
      from: { cardId: keys.get(l.from!) || null, x: 0, y: 0 }, to: { cardId: keys.get(l.to!) || null, x: 0, y: 0 }, ...(l.data || {}),
    }, { z: z++ });
    addCardDraft(d, c);
  }
}

export const TEMPLATE_CATS = ['Création', 'Projet', 'Réflexion', 'Personnel'] as const;

export const TEMPLATES: { id: string; name: string; desc: string; icon: string; cat?: string; specs: () => Spec[] }[] = [
  {
    id: 'moodboard', name: 'Moodboard', icon: '🎨', desc: 'Ambiance, palette de couleurs et références visuelles.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Moodboard' } },
      { type: 'note', x: 0, y: 90, data: { html: p('<b>Ambiance</b>') + p('Décrivez le ressenti recherché : chaleureux, brut, onirique…') } },
      { type: 'color', x: 310, y: 90, data: { hex: '#2f3a45', name: 'Nuit' } },
      { type: 'color', x: 460, y: 90, data: { hex: '#e9643b', name: 'Braise' } },
      { type: 'color', x: 610, y: 90, data: { hex: '#f3e3c3', name: 'Sable' } },
      { type: 'color', x: 760, y: 90, data: { hex: '#7fa65a', name: 'Mousse' } },
      { type: 'column', x: 0, y: 300, data: { title: 'Références' }, children: [
        { type: 'note', data: { html: p('Déposez ici des images (glisser-déposer depuis votre ordinateur).') } },
        { type: 'link', data: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Exemple de vidéo de référence' } },
      ] },
      { type: 'column', x: 330, y: 300, data: { title: 'Typographies' }, children: [{ type: 'note', data: { html: p('Titres : serif élégante') + p('Texte : sans-serif lisible') } }] },
      { type: 'column', x: 660, y: 300, data: { title: 'Textures & matières' }, children: [{ type: 'note', data: { html: p('Grain argentique, papier, lumière naturelle…') } }] },
    ],
  },
  {
    id: 'video', name: 'Projet vidéo', icon: '🎬', desc: 'Idées, script, tournage et montage, du concept à la publication.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Projet vidéo' } },
      { type: 'column', x: 0, y: 90, data: { title: 'Idées' }, children: [
        { type: 'note', data: { html: p('<b>Concept</b>') + p('En une phrase : de quoi parle la vidéo ?') } },
        { type: 'note', color: 'yellow', data: { html: p('Accroche des 3 premières secondes') } },
      ] },
      { type: 'column', x: 330, y: 90, data: { title: 'Script' }, children: [
        { type: 'document', data: { title: 'Script', html: '<h1>Script</h1>' + p('Scène 1 — …') } },
        { type: 'note', data: { html: p('Plans clés à ne pas oublier') } },
      ] },
      { type: 'column', x: 660, y: 90, data: { title: 'Tournage' }, children: [
        { type: 'todo', data: todo('Préparation', ['Repérer le lieu', 'Charger les batteries', 'Vérifier le son', 'Liste de plans']) },
      ] },
      { type: 'column', x: 990, y: 90, data: { title: 'Montage & publication' }, children: [
        { type: 'todo', data: todo('Post-production', ['Dérushage', 'Montage', 'Étalonnage', 'Sous-titres', 'Miniature', 'Publication']) },
      ] },
    ],
  },
  {
    id: 'brainstorm', name: 'Brainstorming', icon: '💡', desc: 'Une idée centrale et des pistes reliées autour.',
    specs: () => [
      { type: 'note', key: 'c', x: 360, y: 220, color: 'yellow', data: { html: '<h2>Idée centrale</h2>' } },
      { type: 'note', key: 'a', x: 0, y: 0, data: { html: p('Piste 1') } },
      { type: 'note', key: 'b', x: 720, y: 0, data: { html: p('Piste 2') } },
      { type: 'note', key: 'd', x: 0, y: 440, data: { html: p('Piste 3') } },
      { type: 'note', key: 'e', x: 720, y: 440, data: { html: p('Piste 4') } },
      { type: 'line', from: 'c', to: 'a' }, { type: 'line', from: 'c', to: 'b' }, { type: 'line', from: 'c', to: 'd' }, { type: 'line', from: 'c', to: 'e' },
    ],
  },
  {
    id: 'kanban', name: 'Suivi de projet', icon: '📋', desc: 'Colonnes À faire, En cours, Terminé.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Suivi de projet' } },
      { type: 'column', x: 0, y: 90, data: { title: 'À faire' }, children: [{ type: 'note', data: { html: p('Nouvelle tâche') } }, { type: 'note', data: { html: p('Autre tâche') } }] },
      { type: 'column', x: 330, y: 90, color: 'yellow', data: { title: 'En cours' }, children: [{ type: 'note', data: { html: p('Tâche en cours') } }] },
      { type: 'column', x: 660, y: 90, color: 'green', data: { title: 'Terminé' }, children: [{ type: 'note', data: { html: p('<s>Tâche terminée</s>') } }] },
    ],
  },
  {
    id: 'writing', name: "Plan d'écriture", icon: '✍️', desc: 'Personnages, intrigue et chapitres.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: "Plan d'écriture" } },
      { type: 'column', x: 0, y: 90, data: { title: 'Personnages' }, children: [{ type: 'note', data: { html: p('<b>Personnage principal</b>') + p('Motivation, conflit, évolution') } }] },
      { type: 'column', x: 330, y: 90, data: { title: 'Intrigue' }, children: [{ type: 'note', data: { html: p('Acte I — mise en place') } }, { type: 'note', data: { html: p('Acte II — confrontation') } }, { type: 'note', data: { html: p('Acte III — résolution') } }] },
      { type: 'document', x: 660, y: 90, data: { title: 'Chapitre 1', html: '<h1>Chapitre 1</h1>' + p('Il était une fois…') } },
      { type: 'table', x: 660, y: 330, data: { header: true, rows: [['Lieu', 'Ambiance', 'Scènes'], ['', '', ''], ['', '', '']] } },
    ],
  },
  {
    id: 'social', name: 'Planning réseaux sociaux', icon: '📱', cat: 'Création', desc: 'Idées de posts et reels, tournage, montage, publication et calendrier.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 700, data: { text: 'Planning de contenu' } },
      { type: 'column', x: 0, y: 90, data: { title: '💡 Idées' }, children: [
        { type: 'note', data: { html: p('<b>Reel coulisses</b>') + p("Montrer la préparation d'un tournage") } },
        { type: 'note', data: { html: p('<b>Avant / après</b>') + p("Étalonnage d'une scène") } },
      ] },
      { type: 'column', x: 330, y: 90, color: 'yellow', data: { title: '🎥 À tourner' }, children: [{ type: 'todo', data: todo('Tournage', ['Plans larges', 'Plans serrés', "Son d'ambiance"]) }] },
      { type: 'column', x: 660, y: 90, color: 'blue', data: { title: '✂️ Montage' }, children: [{ type: 'note', data: { html: p('Sous-titres + musique libre de droits') } }] },
      { type: 'column', x: 990, y: 90, color: 'green', data: { title: '✅ Publié' }, children: [{ type: 'link', data: { url: 'https://www.instagram.com/', title: 'Lien du post' } }] },
      { type: 'table', x: 0, y: 420, w: 700, data: { header: true, rows: [['Jour', 'Plateforme', 'Format', 'Sujet'], ['Lundi', 'Instagram', 'Reel', ''], ['Mercredi', 'TikTok', 'Vidéo', ''], ['Vendredi', 'YouTube', 'Short', '']] } },
    ],
  },
  {
    id: 'storyboard', name: 'Storyboard', icon: '🎞️', cat: 'Création', desc: 'Six cases à dessiner avec description, cadrage et son.',
    specs: () => {
      const out: Spec[] = [{ type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Storyboard' } }];
      for (let i = 0; i < 6; i++) {
        const x = (i % 3) * 330, y = 90 + Math.floor(i / 3) * 420;
        out.push({ type: 'sketch', x, y, w: 300 });
        out.push({ type: 'note', x, y: y + 230, w: 300, data: { html: p(`<b>Plan ${i + 1}</b>`) + p('Cadrage : plan moyen') + p('Action : …') + p('Son : …') } });
      }
      return out;
    },
  },
  {
    id: 'branding', name: 'Identité de marque', icon: '🏷️', cat: 'Création', desc: 'Mission, ton, logo, couleurs et typographies.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Identité de marque' } },
      { type: 'note', x: 0, y: 90, w: 300, data: { html: '<h2>Mission</h2>' + p('Pourquoi la marque existe, en une phrase.') } },
      { type: 'note', x: 330, y: 90, w: 300, data: { html: "<h2>Ton de voix</h2><ul><li>Chaleureux</li><li>Direct</li><li>Un brin d'humour</li></ul>" } },
      { type: 'note', x: 660, y: 90, w: 300, data: { html: '<h2>Public</h2>' + p('Qui sont les personnes visées ?') } },
      { type: 'color', x: 0, y: 330, data: { hex: '#15181c', name: 'Principal' } },
      { type: 'color', x: 150, y: 330, data: { hex: '#e9643b', name: 'Accent' } },
      { type: 'color', x: 300, y: 330, data: { hex: '#f4ecdf', name: 'Fond' } },
      { type: 'color', x: 450, y: 330, data: { hex: '#7c63c4', name: 'Secondaire' } },
      { type: 'column', x: 660, y: 330, data: { title: 'Logo & typographies' }, children: [{ type: 'note', data: { html: p('Déposez ici les versions du logo') } }, { type: 'note', data: { html: p('<b>Titres</b> : serif') + p('<b>Texte</b> : sans-serif') } }] },
    ],
  },
  {
    id: 'roadmap', name: 'Feuille de route', icon: '🗺️', cat: 'Projet', desc: 'Objectifs répartis par trimestre.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Feuille de route' } },
      ...['T1', 'T2', 'T3', 'T4'].map((t, i): Spec => ({ type: 'column', x: i * 330, y: 90, data: { title: t }, children: [{ type: 'note', data: { html: p('<b>Objectif</b>') + p('Résultat attendu') } }] })),
    ],
  },
  {
    id: 'event', name: "Organisation d'événement", icon: '🎉', cat: 'Projet', desc: 'Budget, invités, lieu, programme et checklist.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Événement' } },
      { type: 'todo', x: 0, y: 90, w: 300, data: todo('Checklist', ['Réserver le lieu', 'Envoyer les invitations', 'Traiteur', 'Musique', 'Décoration']) },
      { type: 'table', x: 330, y: 90, w: 420, data: { header: true, rows: [['Poste', 'Prévu', 'Réel'], ['Lieu', '', ''], ['Traiteur', '', ''], ['Divers', '', '']] } },
      { type: 'column', x: 780, y: 90, data: { title: 'Programme' }, children: [{ type: 'note', data: { html: p('18h — Accueil') } }, { type: 'note', data: { html: p('19h — Discours') } }, { type: 'note', data: { html: p('20h — Dîner') } }] },
      { type: 'note', x: 0, y: 360, w: 300, data: { html: '<h2>Lieu</h2>' + p('Adresse, accès, contact') } },
    ],
  },
  {
    id: 'meeting', name: 'Réunion', icon: '🗓️', cat: 'Projet', desc: 'Ordre du jour, notes, décisions et actions.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Réunion du …' } },
      { type: 'todo', x: 0, y: 90, w: 300, data: todo('Ordre du jour', ['Point 1', 'Point 2', 'Questions diverses']) },
      { type: 'note', x: 330, y: 90, w: 340, data: { html: '<h2>Notes</h2>' + p('…') } },
      { type: 'note', x: 700, y: 90, w: 300, color: 'green', data: { html: '<h2>Décisions</h2><ul><li>…</li></ul>' } },
      { type: 'todo', x: 700, y: 300, w: 300, data: todo('Actions', ['Qui fait quoi, pour quand']) },
    ],
  },
  {
    id: 'swot', name: 'Analyse SWOT', icon: '🧭', cat: 'Réflexion', desc: 'Forces, faiblesses, opportunités, menaces.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Analyse SWOT' } },
      { type: 'column', x: 0, y: 90, color: 'green', data: { title: 'Forces' }, children: [{ type: 'note', data: { html: p('…') } }] },
      { type: 'column', x: 330, y: 90, color: 'red', data: { title: 'Faiblesses' }, children: [{ type: 'note', data: { html: p('…') } }] },
      { type: 'column', x: 0, y: 330, color: 'blue', data: { title: 'Opportunités' }, children: [{ type: 'note', data: { html: p('…') } }] },
      { type: 'column', x: 330, y: 330, color: 'orange', data: { title: 'Menaces' }, children: [{ type: 'note', data: { html: p('…') } }] },
    ],
  },
  {
    id: 'retro', name: 'Rétrospective', icon: '🔁', cat: 'Réflexion', desc: "Ce qui a marché, ce qui coince, ce qu'on change.",
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Rétrospective' } },
      { type: 'column', x: 0, y: 90, color: 'green', data: { title: '👍 Ce qui a marché' }, children: [{ type: 'note', data: { html: p('…') } }] },
      { type: 'column', x: 330, y: 90, color: 'red', data: { title: '👎 Ce qui coince' }, children: [{ type: 'note', data: { html: p('…') } }] },
      { type: 'column', x: 660, y: 90, color: 'yellow', data: { title: '💡 À essayer' }, children: [{ type: 'todo', data: todo('Actions', ['…']) }] },
    ],
  },
  {
    id: 'persona', name: 'Persona', icon: '🧑', cat: 'Réflexion', desc: 'Profil type : objectifs, frustrations, habitudes.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Persona' } },
      { type: 'note', x: 0, y: 90, w: 300, data: { html: '<h2>Camille, 28 ans</h2>' + p('Monteuse vidéo indépendante') + p("<i>« Je veux gagner du temps sur l'organisation. »</i>") } },
      { type: 'note', x: 330, y: 90, w: 300, color: 'green', data: { html: '<h2>Objectifs</h2><ul><li>…</li></ul>' } },
      { type: 'note', x: 660, y: 90, w: 300, color: 'red', data: { html: '<h2>Frustrations</h2><ul><li>…</li></ul>' } },
      { type: 'note', x: 330, y: 300, w: 300, data: { html: '<h2>Habitudes</h2><ul><li>…</li></ul>' } },
      { type: 'note', x: 660, y: 300, w: 300, data: { html: '<h2>Outils utilisés</h2><ul><li>…</li></ul>' } },
    ],
  },
  {
    id: 'travel', name: 'Voyage', icon: '✈️', cat: 'Personnel', desc: 'Itinéraire, valise, budget et réservations.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Voyage' } },
      { type: 'column', x: 0, y: 90, data: { title: 'Itinéraire' }, children: [{ type: 'note', data: { html: p('<b>Jour 1</b> — Arrivée') } }, { type: 'note', data: { html: p('<b>Jour 2</b> — …') } }] },
      { type: 'todo', x: 330, y: 90, w: 300, data: todo('Valise', ['Passeport', 'Chargeurs', 'Adaptateur', 'Trousse de toilette']) },
      { type: 'table', x: 660, y: 90, w: 380, data: { header: true, rows: [['Dépense', 'Montant'], ['Transport', ''], ['Logement', ''], ['Sur place', '']] } },
      { type: 'column', x: 330, y: 360, data: { title: 'Réservations' }, children: [{ type: 'link', data: { url: 'https://www.google.com/travel/', title: 'Lien de réservation' } }] },
    ],
  },
  {
    id: 'study', name: 'Révisions', icon: '🎓', cat: 'Personnel', desc: 'Chapitres, fiches, ressources et planning.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Révisions' } },
      { type: 'todo', x: 0, y: 90, w: 300, data: todo('Chapitres', ['Chapitre 1', 'Chapitre 2', 'Chapitre 3', 'Chapitre 4']) },
      { type: 'column', x: 330, y: 90, data: { title: 'Fiches' }, children: [{ type: 'note', data: { html: '<h2>Notion clé</h2>' + p('Définition…') } }] },
      { type: 'column', x: 660, y: 90, data: { title: 'Ressources' }, children: [{ type: 'link', data: { url: 'https://fr.wikipedia.org/', title: 'Wikipédia' } }] },
    ],
  },
  {
    id: 'reading', name: 'Veille & lectures', icon: '📚', cat: 'Personnel', desc: 'Articles, vidéos et livres à lire, en cours, terminés.',
    specs: () => [
      { type: 'heading', x: 0, y: 0, w: 600, data: { text: 'Veille & lectures' } },
      { type: 'column', x: 0, y: 90, data: { title: 'À lire / voir' }, children: [{ type: 'link', data: { url: 'https://www.youtube.com/', title: 'Vidéo à regarder' } }] },
      { type: 'column', x: 330, y: 90, color: 'yellow', data: { title: 'En cours' }, children: [{ type: 'note', data: { html: p('Livre en cours — page 120') } }] },
      { type: 'column', x: 660, y: 90, color: 'green', data: { title: 'Terminé' }, children: [{ type: 'note', data: { html: p('<b>À retenir</b>') + p('…') } }] },
    ],
  },
];

const CAT_OF: Record<string, string> = { moodboard: 'Création', video: 'Création', writing: 'Création', kanban: 'Projet', brainstorm: 'Réflexion' };
TEMPLATES.forEach(t => { if (!t.cat) t.cat = CAT_OF[t.id] || 'Projet'; });

/** Crée une nouvelle planche (au centre de la vue) contenant le modèle, et renvoie son id. */
export function templateInNewBoard(id: string, at: { x: number; y: number }) {
  const t = TEMPLATES.find(t => t.id === id);
  if (!t) return null;
  const s = get();
  let boardId: string | null = null;
  mutate(d => {
    const bc = makeCard('board', s.boardId, at.x - 60, at.y - 60, undefined, { z: 1e6 });
    addCardDraft(d, bc, { title: t.name, icon: t.icon });
    boardId = bc.data.boardId;
    buildSpecs(d, boardId!, t.specs());
  });
  return boardId as string | null;
}

export function applyTemplate(boardId: string, id: string) {
  const t = TEMPLATES.find(t => t.id === id);
  if (!t) return;
  const b = get().boardId === boardId ? contentBounds(boardId) : null;
  const ox = b ? b.x + b.w + 120 : 0, oy = b ? b.y : 0;
  mutate(d => buildSpecs(d, boardId, t.specs(), ox, oy));
}

/** Contenu de démarrage la toute première fois. */
export function seed(d: Draft<Doc>) {
  buildSpecs(d, ROOT_ID, [
    { type: 'heading', x: 0, y: 0, w: 640, data: { text: 'Bienvenue 👋' } },
    { type: 'note', x: 0, y: 80, w: 320, data: { html: p('Voici votre espace. Chaque <b>planche</b> est une toile infinie où organiser notes, images, liens, tâches et fichiers.') + '<ul><li>Glissez un outil depuis la barre de gauche</li><li>Double-cliquez sur le fond pour écrire</li><li>Déposez des fichiers depuis votre ordinateur</li><li>Ctrl + molette pour zoomer</li></ul>' } },
    {
      type: 'board', x: 360, y: 80, board: { title: 'Mon premier projet', icon: '🎬', color: '#e9643b' },
      boardContent: TEMPLATES[1].specs(),
    },
    { type: 'board', x: 500, y: 80, board: { title: 'Inspiration', icon: '🎨', color: '#7c63c4' }, boardContent: TEMPLATES[0].specs() },
    { type: 'board', x: 640, y: 80, board: { title: 'Idées', icon: '💡', color: '#d9a03f' }, boardContent: TEMPLATES[2].specs() },
    { type: 'todo', x: 360, y: 260, w: 400, data: todo('Pour bien démarrer', ['Créer une planche', 'Ajouter une note', 'Relier deux cartes avec une ligne', 'Glisser une image', 'Essayer la recherche (Ctrl K)'], 1) },
  ]);
}

export { topCardsOf };
