export const THEME_KEY = "rvos-theme";

/** Runs before paint (server-rendered with the CSP nonce) so there is no light/dark flash. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}')||'dark';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light'}catch(_){document.documentElement.classList.add('dark')}})()`;
