// Site-wide rule: no em dashes (or en dashes) ever appear on the website.
// Numeric ranges collapse to a plain hyphen; everything else becomes " - ".
export function noDashes(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2').replace(/\s*[—–]\s*/g, ' - ');
}

export function noDashesDeep(v) {
  if (typeof v === 'string') return noDashes(v);
  if (Array.isArray(v)) return v.map(noDashesDeep);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noDashesDeep(x)]));
  return v;
}
