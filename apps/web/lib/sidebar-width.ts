export const sidebarWidthKey = 'vows.sidebar-width';
export const defaultSidebarWidth = 208;
export const clampSidebarWidth = (width: number) =>
	Math.min(320, Math.max(168, width));

// Run while parsing the head, before either the loading shell or dashboard paints.
// Only a bounded number is written to CSS; storage contents are never executed.
export const sidebarWidthScript = `(()=>{try{const saved=localStorage.getItem(${JSON.stringify(sidebarWidthKey)});const width=Number(saved);if(saved?.trim()&&Number.isFinite(width)){document.documentElement.style.setProperty('--sidebar-width',Math.min(320,Math.max(168,width))+'px')}}catch{}})()`;
