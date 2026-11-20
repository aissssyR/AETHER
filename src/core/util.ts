export function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
