// Nom de l'application : change-le ici, il est utilisé partout dans l'interface.
export const APP_NAME = 'Atelier';
export const ROOT_ID = 'root';
export const UNSORTED = 'unsorted';

export type CardType =
  | 'note' | 'todo' | 'link' | 'image' | 'file' | 'column' | 'board' | 'line'
  | 'heading' | 'color' | 'sketch' | 'table' | 'comment' | 'document';

export interface LineEnd { cardId?: string | null; x: number; y: number }

export interface Card {
  id: string;
  type: CardType;
  /** id de planche, id de carte colonne, ou UNSORTED */
  parent: string;
  x: number;
  y: number;
  w: number;
  z: number;
  order: number;
  color?: string | null;
  data: any;
  createdAt: number;
  updatedAt: number;
  trashed?: { at: number } | null;
}

export interface Board {
  id: string;
  title: string;
  icon: string;
  color: string;
  createdAt: number;
  /** image de couverture (id de fichier) affichée à la place de l'icône */
  cover?: string | null;
  /** couleur de fond du canevas */
  bgColor?: string | null;
  /** image de fond du canevas (id de fichier) */
  bgImage?: string | null;
}

export interface TodoItem { id: string; text: string; done: boolean; due?: string | null; assignee?: string | null }

export const BG_COLORS: { id: string | null; label: string; value: string }[] = [
  { id: null, label: 'Par défaut', value: 'var(--canvas)' },
  { id: 'white', label: 'Blanc', value: '#ffffff' },
  { id: 'sand', label: 'Sable', value: '#f4ecdf' },
  { id: 'rose', label: 'Rose', value: '#f7e6e4' },
  { id: 'sage', label: 'Sauge', value: '#e5ede1' },
  { id: 'sky', label: 'Ciel', value: '#e3ecf5' },
  { id: 'lilac', label: 'Lilas', value: '#ebe6f4' },
  { id: 'slate', label: 'Ardoise', value: '#2b3036' },
  { id: 'night', label: 'Nuit', value: '#15181c' },
];

export interface Doc {
  boards: Record<string, Board>;
  cards: Record<string, Card>;
}

export interface Viewport { x: number; y: number; zoom: number }

export interface Settings { userName: string; theme: 'light' | 'dark'; font?: 'inter' | 'system' }

export const CARD_COLORS: { id: string | null; label: string; bg: string; fg?: string }[] = [
  { id: null, label: 'Par défaut', bg: 'var(--card)' },
  { id: 'grey', label: 'Gris', bg: '#e6e6e3' },
  { id: 'yellow', label: 'Jaune', bg: '#fbefb3' },
  { id: 'orange', label: 'Orange', bg: '#fbd8b5' },
  { id: 'red', label: 'Rouge', bg: '#f8c4c0' },
  { id: 'pink', label: 'Rose', bg: '#f6cde3' },
  { id: 'purple', label: 'Violet', bg: '#ddd2f6' },
  { id: 'blue', label: 'Bleu', bg: '#c8dcf7' },
  { id: 'teal', label: 'Turquoise', bg: '#c3ebe4' },
  { id: 'green', label: 'Vert', bg: '#d0ecc4' },
  { id: 'dark', label: 'Sombre', bg: '#33393f', fg: '#f2f2f0' },
];

export function colorStyle(id?: string | null): { background?: string; color?: string } {
  const c = CARD_COLORS.find(c => c.id === (id ?? null));
  if (!c || !c.id) return {};
  return { background: c.bg, color: c.fg || '#1f2328' };
}

export const BOARD_COLORS = ['#e9643b', '#d9a03f', '#7fa65a', '#3e9e8f', '#4a86c7', '#7c63c4', '#c4588f', '#8a6f5a', '#5d6b78', '#2f3a45'];

export const LINE_COLORS = ['#5d6b78', '#e9643b', '#d9a03f', '#7fa65a', '#4a86c7', '#7c63c4', '#c4588f', '#1f2328'];

export const DEFAULT_W: Record<CardType, number> = {
  note: 280, todo: 280, link: 280, image: 280, file: 280, column: 300, board: 120, line: 0,
  heading: 420, color: 130, sketch: 300, table: 420, comment: 280, document: 210,
};

export const TYPE_LABEL: Record<CardType, string> = {
  note: 'Note', todo: 'Liste de tâches', link: 'Lien', image: 'Image', file: 'Fichier', column: 'Colonne',
  board: 'Planche', line: 'Ligne', heading: 'Titre', color: 'Couleur', sketch: 'Dessin', table: 'Tableau',
  comment: 'Commentaire', document: 'Document',
};

/** Types dont le contenu s'édite directement dans la carte. */
export const EDITABLE_TYPES: CardType[] = ['note', 'todo', 'heading', 'table', 'comment', 'column', 'board', 'link', 'image', 'color'];
