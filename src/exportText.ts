// Export d'une planche en Markdown ou en document Word (.doc HTML lisible par Word, LibreOffice, Pages).
import { get, topCardsOf, childrenOf, toast } from './store';
import { blobGet, blobToDataUrl } from './db';
import { downloadBlob, formatSize } from './files';
import { sanitizeHtml, escapeHtml } from './sanitize';
import { formatDue } from './components/cards/TodoCard';
import { strokePath } from './components/modals/SketchModal';
import { APP_NAME, type Card } from './types';

const sortReading = (cards: Card[]) => [...cards].sort((a, b) => (Math.abs(a.y - b.y) < 30 ? a.x - b.x : a.y - b.y));

// ---------- HTML → Markdown ----------
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${sanitizeHtml(html || '')}</div>`, 'text/html');
  const walk = (n: Node, ctx: { list?: 'ul' | 'ol'; index?: number; depth: number }): string => {
    if (n.nodeType === 3) return (n.textContent || '').replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const el = n as HTMLElement;
    const kids = (c = ctx) => Array.from(el.childNodes).map(k => walk(k, c)).join('');
    switch (el.tagName) {
      case 'H1': return `\n### ${kids().trim()}\n\n`;
      case 'H2': case 'H3': return `\n#### ${kids().trim()}\n\n`;
      case 'B': case 'STRONG': { const t = kids(); return t.trim() ? `**${t.trim()}**` + (t.endsWith(' ') ? ' ' : '') : t; }
      case 'I': case 'EM': { const t = kids(); return t.trim() ? `*${t.trim()}*` : t; }
      case 'S': case 'STRIKE': case 'DEL': { const t = kids(); return t.trim() ? `~~${t.trim()}~~` : t; }
      case 'CODE': return '`' + kids() + '`';
      case 'PRE': return '\n```\n' + (el.textContent || '') + '\n```\n\n';
      case 'A': return `[${kids().trim() || el.getAttribute('href')}](${el.getAttribute('href') || ''})`;
      case 'BR': return '  \n';
      case 'BLOCKQUOTE': return kids().trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
      case 'UL': case 'OL': {
        let i = 0;
        const items = Array.from(el.children).filter(c => c.tagName === 'LI').map(li => {
          i++;
          const inner = Array.from(li.childNodes).map(k => walk(k, { list: el.tagName === 'OL' ? 'ol' : 'ul', index: i, depth: ctx.depth + 1 })).join('').trim();
          return `${'  '.repeat(ctx.depth)}${el.tagName === 'OL' ? `${i}.` : '-'} ${inner}`;
        });
        return (ctx.depth ? '\n' : '') + items.join('\n') + (ctx.depth ? '' : '\n\n');
      }
      case 'P': case 'DIV': { const t = kids().trim(); return t ? t + '\n\n' : ''; }
      case 'HR': return '\n---\n\n';
      default: return kids();
    }
  };
  return walk(doc.body.firstChild!, { depth: 0 }).replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Parcours de la planche ----------
interface Renderer {
  heading(level: number, text: string): string;
  html(html: string): string;
  todo(card: Card): string;
  link(card: Card): string;
  image(card: Card, dataUrl: string | null): string;
  file(card: Card): string;
  color(card: Card): string;
  table(card: Card): string;
  comment(card: Card): string;
  sketch(card: Card): string;
  text(t: string): string;
}

async function renderBoard(boardId: string, r: Renderer, level: number, seen: Set<string>, withImages: boolean): Promise<string> {
  if (seen.has(boardId) || level > 6) return '';
  seen.add(boardId);
  const s = get();
  const out: string[] = [];
  const renderCard = async (c: Card, lvl: number) => {
    const d = c.data || {};
    switch (c.type) {
      case 'heading': out.push(r.heading(Math.min(lvl, 6), d.text || '')); break;
      case 'note': if (d.html) out.push(r.html(d.html)); break;
      case 'document': out.push(r.heading(Math.min(lvl, 6), d.title || 'Document')); if (d.html) out.push(r.html(d.html)); break;
      case 'todo': out.push(r.todo(c)); break;
      case 'link': if (d.url) out.push(r.link(c)); break;
      case 'image': {
        let url: string | null = d.src || null;
        if (withImages && d.blobId) { const b = await blobGet(d.blobId); if (b) url = await blobToDataUrl(b); }
        out.push(r.image(c, url));
        break;
      }
      case 'file': out.push(r.file(c)); break;
      case 'color': out.push(r.color(c)); break;
      case 'table': out.push(r.table(c)); break;
      case 'comment': if ((d.thread || []).length) out.push(r.comment(c)); break;
      case 'sketch': out.push(r.sketch(c)); break;
      case 'column': {
        out.push(r.heading(Math.min(lvl, 6), d.title || 'Colonne'));
        for (const k of childrenOf(c.id)) await renderCard(k, lvl + 1);
        break;
      }
      case 'board': {
        const b = s.boards[d.boardId];
        if (!b) break;
        out.push(r.heading(Math.min(lvl, 6), `${b.icon || ''} ${b.title}`.trim()));
        const inner = await renderBoard(b.id, r, lvl + 1, seen, withImages);
        if (inner.trim()) out.push(inner); else out.push(r.text('(planche vide)'));
        break;
      }
    }
  };
  for (const c of sortReading(topCardsOf(boardId).filter(c => c.type !== 'line'))) await renderCard(c, level);
  return out.filter(Boolean).join('\n\n');
}

// ---------- Markdown ----------
const mdEsc = (t: string) => (t || '').replace(/\|/g, '\\|');
const MD: Renderer = {
  heading: (l, t) => `${'#'.repeat(l)} ${t}`,
  html: h => htmlToMarkdown(h),
  text: t => `*${t}*`,
  todo: c => {
    const lines = [c.data.title ? `**${c.data.title}**` : ''];
    for (const i of c.data.items || []) {
      const meta = [i.due ? `📅 ${formatDue(i.due)}` : '', i.assignee ? `👤 ${i.assignee}` : ''].filter(Boolean).join(' · ');
      lines.push(`- [${i.done ? 'x' : ' '}] ${i.text}${meta ? ` — ${meta}` : ''}`);
    }
    return lines.filter(Boolean).join('\n');
  },
  link: c => `[${c.data.title || c.data.url}](${c.data.url})${c.data.description ? `\n${c.data.description}` : ''}`,
  image: c => `![${c.data.caption || c.data.name || 'image'}](${c.data.src || c.data.name || 'image'})${c.data.caption ? `\n*${c.data.caption}*` : ''}`,
  file: c => `📎 ${c.data.name}${c.data.size ? ` (${formatSize(c.data.size)})` : ''}`,
  color: c => `🎨 ${c.data.name ? c.data.name + ' — ' : ''}\`${(c.data.hex || '').toUpperCase()}\``,
  table: c => {
    const rows: string[][] = c.data.rows || [];
    if (!rows.length) return '';
    const cols = Math.max(...rows.map(r => r.length));
    const line = (r: string[]) => '| ' + Array.from({ length: cols }, (_, i) => mdEsc(r[i] || '')).join(' | ') + ' |';
    const head = c.data.header !== false ? rows[0] : Array(cols).fill('');
    const body = c.data.header !== false ? rows.slice(1) : rows;
    return [line(head), '| ' + Array(cols).fill('---').join(' | ') + ' |', ...body.map(line)].join('\n');
  },
  comment: c => (c.data.thread || []).map((m: any) => `> **${m.author}** : ${m.text}`).join('\n>\n'),
  sketch: () => '*(dessin)*',
};

// ---------- HTML pour Word ----------
const H: Renderer = {
  heading: (l, t) => `<h${l}>${escapeHtml(t)}</h${l}>`,
  html: h => sanitizeHtml(h),
  text: t => `<p><i>${escapeHtml(t)}</i></p>`,
  todo: c => {
    const title = c.data.title ? `<p><b>${escapeHtml(c.data.title)}</b></p>` : '';
    const items = (c.data.items || []).map((i: any) => {
      const meta = [i.due ? `échéance : ${formatDue(i.due)}` : '', i.assignee ? `pour : ${i.assignee}` : ''].filter(Boolean).join(', ');
      return `<p style="margin:2px 0">${i.done ? '☑' : '☐'} ${i.done ? `<s>${escapeHtml(i.text)}</s>` : escapeHtml(i.text)}${meta ? ` <span style="color:#777">(${escapeHtml(meta)})</span>` : ''}</p>`;
    }).join('');
    return title + items;
  },
  link: c => `<p><a href="${escapeHtml(c.data.url)}">${escapeHtml(c.data.title || c.data.url)}</a>${c.data.description ? `<br>${escapeHtml(c.data.description)}` : ''}</p>`,
  image: (c, url) => url ? `<p><img src="${url}" width="480" alt="${escapeHtml(c.data.caption || '')}"></p>${c.data.caption ? `<p><i>${escapeHtml(c.data.caption)}</i></p>` : ''}` : `<p>[image : ${escapeHtml(c.data.name || '')}]</p>`,
  file: c => `<p>📎 ${escapeHtml(c.data.name || '')}${c.data.size ? ` (${formatSize(c.data.size)})` : ''}</p>`,
  color: c => `<p><span style="background:${escapeHtml(c.data.hex)};color:${escapeHtml(c.data.hex)}">████</span> ${escapeHtml(c.data.name || '')} ${escapeHtml((c.data.hex || '').toUpperCase())}</p>`,
  table: c => {
    const rows: string[][] = c.data.rows || [];
    const cols = Math.max(0, ...rows.map(r => r.length));
    return `<table border="1" cellpadding="5" style="border-collapse:collapse">${rows.map((r, i) => `<tr>${Array.from({ length: cols }, (_, j) => {
      const tag = i === 0 && c.data.header !== false ? 'th' : 'td';
      return `<${tag}>${escapeHtml(r[j] || '')}</${tag}>`;
    }).join('')}</tr>`).join('')}</table>`;
  },
  comment: c => `<blockquote>${(c.data.thread || []).map((m: any) => `<p><b>${escapeHtml(m.author)}</b> : ${escapeHtml(m.text)}</p>`).join('')}</blockquote>`,
  sketch: c => {
    const { strokes = [], width = 600, height = 400 } = c.data;
    return `<p><svg xmlns="http://www.w3.org/2000/svg" width="400" viewBox="0 0 ${width} ${height}">${strokes.map((s: any) => `<path d="${strokePath(s.points)}" stroke="${s.color}" stroke-width="${s.size}" fill="none" stroke-linecap="round"/>`).join('')}</svg></p>`;
  },
};

const safeName = (s: string) => (s || 'planche').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);

export async function exportMarkdown(boardId = get().boardId) {
  const b = get().boards[boardId];
  const body = await renderBoard(boardId, MD, 2, new Set(), false);
  const md = `# ${b.title}\n\n${body}\n`;
  downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${safeName(b.title)}.md`);
  toast('Export Markdown téléchargé');
  return md;
}

export async function exportWord(boardId = get().boardId) {
  toast('Préparation du document Word…');
  const b = get().boards[boardId];
  const body = await renderBoard(boardId, H, 2, new Set(), true);
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(b.title)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4}h1{font-family:Georgia,serif;font-size:24pt}h2{font-size:16pt;margin-top:18pt}h3{font-size:13pt}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:10px;color:#555}table{margin:6pt 0}th{background:#f1f1f1}</style>
</head><body><h1>${escapeHtml(b.title)}</h1>${body}<p style="color:#999;font-size:8pt">Exporté depuis ${escapeHtml(APP_NAME)} le ${new Date().toLocaleDateString('fr-FR')}</p></body></html>`;
  downloadBlob(new Blob(['﻿', html], { type: 'application/msword' }), `${safeName(b.title)}.doc`);
  toast('Document Word téléchargé');
  return html;
}
