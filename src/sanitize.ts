const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'H1', 'H2', 'H3', 'P', 'DIV', 'BR', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'SPAN', 'FONT', 'MARK', 'HR']);
const ALLOWED_ATTR: Record<string, string[]> = {
  A: ['href'], SPAN: ['style'], FONT: ['color'], MARK: ['style'], P: ['style'], DIV: ['style'], H1: ['style'], H2: ['style'], H3: ['style'], LI: ['style', 'data-checked'], UL: ['data-checklist'],
};
const SAFE_STYLE = /^(color|background-color|text-align|text-decoration)\s*:\s*[#a-z0-9(),.\s%-]+$/i;
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'svg', 'TEMPLATE', 'LINK', 'META']);

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement;
  if (!root) return '';
  const walk = (el: Element) => {
    let child = el.firstElementChild;
    while (child) {
      const next = child.nextElementSibling;
      if (DROP.has(child.tagName)) { child.remove(); child = next; continue; }
      if (!ALLOWED.has(child.tagName)) {
        const first = child.firstElementChild;
        while (child.firstChild) el.insertBefore(child.firstChild, child);
        child.remove();
        // re-traiter les enfants remontés
        child = first || next;
        continue;
      }
      const ok = ALLOWED_ATTR[child.tagName] || [];
      for (const attr of Array.from(child.attributes)) {
        if (!ok.includes(attr.name)) { child.removeAttribute(attr.name); continue; }
        if (attr.name === 'href' && !/^(https?:|mailto:)/i.test(attr.value.trim())) child.removeAttribute('href');
        if (attr.name === 'style') {
          const safe = attr.value.split(';').map(s => s.trim()).filter(s => s && SAFE_STYLE.test(s)).join(';');
          if (safe) child.setAttribute('style', safe); else child.removeAttribute('style');
        }
      }
      if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
      walk(child);
      child = next;
    }
  };
  walk(root);
  return root.innerHTML;
}

export function htmlToText(html: string): string {
  if (!html) return '';
  const d = new DOMParser().parseFromString(html.replace(/<(br|\/p|\/div|\/li|\/h\d)>/gi, '$&\n'), 'text/html');
  return (d.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

export function textToHtml(text: string) {
  return text.split(/\n/).map(l => `<p>${escapeHtml(l) || '<br>'}</p>`).join('');
}
