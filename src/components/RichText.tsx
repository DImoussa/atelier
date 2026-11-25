import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { checkpoint, get, set } from '../store';
import { sanitizeHtml, escapeHtml } from '../sanitize';

/** Place le curseur au point cliqué (ou à la fin). */
export function placeCaret(el: HTMLElement, point: { x: number; y: number } | null) {
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) return;
  let range: Range | null = null;
  if (point) {
    const anyDoc = document as any;
    if (anyDoc.caretRangeFromPoint) range = anyDoc.caretRangeFromPoint(point.x, point.y);
    else if (anyDoc.caretPositionFromPoint) {
      const p = anyDoc.caretPositionFromPoint(point.x, point.y);
      if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); }
    }
    if (range && !el.contains(range.startContainer)) range = null;
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Session d'édition : un seul point d'historique par session de frappe. */
function useEditSession(editing: boolean) {
  const dirty = useRef(false);
  useEffect(() => { if (!editing) dirty.current = false; }, [editing]);
  return () => { if (!dirty.current) { checkpoint(); dirty.current = true; } };
}

const MD_RULES: [RegExp, () => void][] = [
  [/^#$/, () => document.execCommand('formatBlock', false, 'h1')],
  [/^##$/, () => document.execCommand('formatBlock', false, 'h2')],
  [/^[-*]$/, () => document.execCommand('insertUnorderedList')],
  [/^1\.$/, () => document.execCommand('insertOrderedList')],
  [/^>$/, () => document.execCommand('formatBlock', false, 'blockquote')],
];

export function RichText({ html, editing, onChange, placeholder, className, autoFocusPoint = true, autoFocus = true }: {
  html: string; editing: boolean; onChange: (html: string) => void; placeholder?: string; className?: string; autoFocusPoint?: boolean; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const begin = useEditSession(editing);

  useLayoutEffect(() => {
    const el = ref.current!;
    if (document.activeElement === el) return;
    const clean = sanitizeHtml(html || '');
    if (el.innerHTML !== clean) el.innerHTML = clean;
  }, [html, editing]);

  useEffect(() => {
    if (!editing || !autoFocus) return;
    const el = ref.current!;
    const pt = autoFocusPoint ? get().editPoint : null;
    placeCaret(el, pt);
  }, [editing]);

  const emit = () => {
    begin();
    onChange(ref.current!.innerHTML);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); ref.current!.blur(); set({ editingId: null }); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const url = prompt('Adresse du lien :', 'https://');
      if (url) document.execCommand('createLink', false, url);
      emit();
      return;
    }
    if (e.key === ' ') {
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      if (node && node.nodeType === 3 && !node.previousSibling) {
        const before = (node.textContent || '').slice(0, sel!.anchorOffset);
        const rule = MD_RULES.find(([re]) => re.test(before));
        const block = node.parentElement;
        if (rule && block && !['LI', 'H1', 'H2', 'BLOCKQUOTE'].includes(block.tagName)) {
          e.preventDefault();
          const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, before.length);
          sel!.removeAllRanges(); sel!.addRange(r);
          document.execCommand('delete');
          rule[1]();
          emit();
        }
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand(e.shiftKey ? 'outdent' : 'indent');
      emit();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const htmlData = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!htmlData && !text) return;
    e.preventDefault();
    e.stopPropagation();
    if (htmlData) document.execCommand('insertHTML', false, sanitizeHtml(htmlData));
    else document.execCommand('insertHTML', false, escapeHtml(text).replace(/\n/g, '<br>'));
    emit();
  };

  return (
    <div
      ref={ref}
      className={'rich ' + (className || '')}
      contentEditable={editing}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={emit}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      spellCheck={editing}
    />
  );
}

/** Champ texte simple (sans mise en forme), éditable uniquement en mode édition. */
export function PlainText({ value, editing, onChange, placeholder, className, onKeyDown, focusOnEdit, inputRef, tag = 'div' }: {
  value: string; editing: boolean; onChange: (v: string) => void; placeholder?: string; className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void; focusOnEdit?: boolean; inputRef?: (el: HTMLElement | null) => void; tag?: 'div' | 'span';
}) {
  const ref = useRef<HTMLElement | null>(null);
  const begin = useEditSession(editing);
  useLayoutEffect(() => {
    const el = ref.current!;
    if (document.activeElement === el) return;
    if (el.textContent !== (value || '')) el.textContent = value || '';
  }, [value, editing]);
  useEffect(() => {
    if (editing && focusOnEdit && ref.current) placeCaret(ref.current, get().editPoint);
  }, [editing]);
  const Tag: any = tag;
  return (
    <Tag
      ref={(el: HTMLElement | null) => { ref.current = el; inputRef?.(el); }}
      className={'plain ' + (className || '')}
      contentEditable={editing ? 'plaintext-only' : false}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      spellCheck={editing}
      onInput={() => { begin(); onChange((ref.current!.textContent || '').replace(/\n$/, '')); }}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        // les touches tapées dans un champ ne doivent jamais déclencher les raccourcis globaux
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); (e.target as HTMLElement).blur(); set({ editingId: null }); return; }
        onKeyDown?.(e);
      }}
      onPaste={(e: React.ClipboardEvent) => e.stopPropagation()}
    />
  );
}
