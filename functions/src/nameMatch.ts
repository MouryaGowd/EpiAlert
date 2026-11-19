const HONORIFICS = new Set(["dr", "doctor", "mr", "mrs", "ms", "prof"]);

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t));
}

// A one-letter token is an initial and matches any name starting with it.
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

/** Last name token equal. Used to tell "ambiguous" (same family name) from "different person". */
export function surnameMatches(submitted: string, registry: string): boolean {
  const a = tokens(submitted);
  const b = tokens(registry);
  if (a.length === 0 || b.length === 0) return false;
  return a[a.length - 1] === b[b.length - 1];
}

/**
 * Tolerant on case, honorifics and initials; strict on everything else.
 * Same number of tokens, matched position by position, so a different
 * surname or given name never matches.
 */
export function namesMatch(submitted: string, registry: string): boolean {
  const a = tokens(submitted);
  const b = tokens(registry);
  if (a.length === 0 || a.length !== b.length) return false;
  return a.every((t, i) => tokenMatches(t, b[i]));
}
