import React from 'react';

const P: Record<string, React.ReactNode> = {
  note: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  todo: <><rect x="4" y="4.5" width="5" height="5" rx="1" /><path d="M5.3 7l1.2 1.2L8.5 6" /><path d="M12 7h8" /><rect x="4" y="14.5" width="5" height="5" rx="1" /><path d="M12 17h8" /></>,
  line: <><path d="M5 19L19 5" /><path d="M12 5h7v7" /></>,
  board: <><rect x="4" y="4" width="16" height="16" rx="3" /><rect x="7.5" y="7.5" width="4" height="4" rx="1" /><rect x="12.5" y="12.5" width="4" height="4" rx="1" /></>,
  column: <><rect x="6" y="3.5" width="12" height="17" rx="2" /><path d="M8.5 7.5h7M9 11h6M9 14.5h6" /></>,
  comment: <><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8l-4 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" /></>,
  table: <><rect x="3.5" y="5" width="17" height="14" rx="1.5" /><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14" /></>,
  image: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.7" /><path d="M20.5 16l-5-5-8.5 8" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></>,
  sketch: <><path d="M4 20c2-1 3-4 5.5-4s2 3 4.5 3 3-3 6-6" /><path d="M14.5 4.5l3 3L10 15l-3.5.5.5-3.5z" /></>,
  color: <><path d="M12 3.5c3 4 6 7 6 10.5a6 6 0 0 1-12 0c0-3.5 3-6.5 6-10.5z" /></>,
  document: <><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4M9 12h6M9 15.5h6" /></>,
  heading: <><path d="M6 5v14M18 5v14M6 12h12" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /><path d="M10.5 11v5.5M13.5 11v5.5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>,
  share: <><circle cx="17.5" cy="6" r="2.5" /><circle cx="6.5" cy="12" r="2.5" /><circle cx="17.5" cy="18" r="2.5" /><path d="M8.7 10.8l6.6-3.6M8.7 13.2l6.6 3.6" /></>,
  more: <><circle cx="5.5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="18.5" cy="12" r="1.3" fill="currentColor" /></>,
  undo: <><path d="M9 7L4.5 11.5 9 16" /><path d="M4.5 11.5h10a5 5 0 0 1 0 10H11" /></>,
  redo: <><path d="M15 7l4.5 4.5L15 16" /><path d="M19.5 11.5h-10a5 5 0 0 0 0 10H13" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <><path d="M5 12h14" /></>,
  fit: <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  inbox: <><path d="M3.5 13.5l3-8h11l3 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M3.5 13.5h5l1 2.5h5l1-2.5h5" /></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 19.5h16" /></>,
  play: <><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>,
  file: <><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4" /></>,
  home: <><path d="M4 11l8-7 8 7" /><path d="M6 9.5V20h12V9.5" /></>,
  chevron: <><path d="M9 6l6 6-6 6" /></>,
  collapse: <><path d="M7 14l5-5 5 5" /></>,
  expand: <><path d="M7 10l5 5 5-5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  bold: <><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" strokeWidth="2.2" /></>,
  italic: <><path d="M10 5h8M6 19h8M14 5l-4 14" /></>,
  underline: <><path d="M7 4.5v6a5 5 0 0 0 10 0v-6M5.5 20h13" /></>,
  strike: <><path d="M4.5 12h15M16 7.5c-.6-1.8-2.2-3-4.2-3-2.5 0-4.3 1.4-4.3 3.4 0 1.6 1.1 2.6 3 3.2M8 16.5c.6 1.9 2.3 3 4.4 3 2.6 0 4.4-1.4 4.4-3.5 0-.8-.2-1.5-.7-2" /></>,
  h1: <><path d="M4 6v12M12 6v12M4 12h8M16 9l3-2v11" /></>,
  h2: <><path d="M3.5 6v12M11 6v12M3.5 12H11M15 9.5a2.5 2.5 0 0 1 5 0c0 2.5-5 4.5-5 8.5h5" /></>,
  ul: <><circle cx="5" cy="7" r="1.2" fill="currentColor" /><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="5" cy="17" r="1.2" fill="currentColor" /><path d="M9.5 7h10M9.5 12h10M9.5 17h10" /></>,
  ol: <><path d="M4 5.5h1.5V10M4 10h3M4 14.5a1.5 1.5 0 0 1 3 0c0 1.2-3 2.3-3 4h3" /><path d="M10 7h10M10 12h10M10 17h10" /></>,
  quote: <><path d="M5 17c0-4 1-7 4.5-9M5 17h4v-4H5M13.5 17c0-4 1-7 4.5-9M13.5 17h4v-4h-4" /></>,
  code: <><path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5" /></>,
  textcolor: <><path d="M7 16L12 4l5 12M8.6 12h6.8" /><path d="M5 20h14" strokeWidth="2.6" /></>,
  highlight: <><path d="M9 15l-3 3h5M9 15l7.5-7.5 2.5 2.5L11.5 17.5z" /><path d="M4 21h16" /></>,
  clear: <><path d="M6 5h12M12 5l-3 14M16 15l4 4M20 15l-4 4" /></>,
  arrowEnd: <><path d="M4 12h15M14 7l5 5-5 5" /></>,
  arrowStart: <><path d="M20 12H5M10 7l-5 5 5 5" /></>,
  dashed: <><path d="M3 12h4M10 12h4M17 12h4" /></>,
  label: <><path d="M4 7h16M4 12h10M4 17h13" /></>,
  pen: <><path d="M15.5 4.5l4 4L9 19l-5 1 1-5z" /></>,
  marker: <><path d="M14 5l5 5-7 7H7v-5z" /><path d="M4 21h9" /></>,
  eraser: <><path d="M8 20l-4-4 10-10 6 6-8 8zM9.5 9.5l6 6M8 20h12" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14.5h10" /></>,
  template: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  move: <><path d="M5 12h14M15 8l4 4-4 4" /><rect x="3" y="4" width="6" height="5" rx="1" /></>,
  restore: <><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  export: <><path d="M12 15V3.5M7.5 8L12 3.5 16.5 8" /><path d="M5 12v7.5h14V12" /></>,
  import: <><path d="M12 3.5V15M7.5 10.5L12 15l4.5-4.5" /><path d="M5 12v7.5h14V12" /></>,
  moon: <><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>,
  present: <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M12 16v4M8 20h8M10 8.5v4l3.5-2z" /></>,
  crop: <><path d="M6 2.5V18h15.5M2.5 6H18v15.5" /></>,
  rotate: <><path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4.5h-4.5" /></>,
  markdown: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 15V9l2.5 3L11 9v6M15.5 9v6M13.5 13l2 2 2-2" /></>,
  word: <><path d="M6 3.5h8l4 4v13H6z" /><path d="M8.5 11l1.2 5 1.8-4 1.8 4 1.2-5" /></>,
  photo: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.7" /><path d="M20.5 16l-5-5-8.5 8" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></>,
  grip: <><circle cx="9" cy="7" r="1.2" fill="currentColor" /><circle cx="15" cy="7" r="1.2" fill="currentColor" /><circle cx="9" cy="12" r="1.2" fill="currentColor" /><circle cx="15" cy="12" r="1.2" fill="currentColor" /><circle cx="9" cy="17" r="1.2" fill="currentColor" /><circle cx="15" cy="17" r="1.2" fill="currentColor" /></>,
};

export function Icon({ name, size = 20, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name] || P.note}
    </svg>
  );
}

export function AppLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#2f3a45" />
      <path d="M8 23V9l8 8 8-8v14" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
