/**
 * A string of its own (P10). V8 keeps a cut of 13 or more characters as a view of the whole string it was cut from, so
 * a short id cut from a long digest, a file name or a request's body keeps all of that alive for as long as the id is
 * kept. A store that keeps many such ids keeps each as its own copy. For text of ASCII characters only (ids, codes,
 * hex), which this copies byte for byte.
 */
export const own = (text: string): string => Buffer.from(text, "latin1").toString("latin1");
