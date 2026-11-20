/** Minimal file shape shared by the CLI (reads from disk) and the browser playground (pasted text). */
export interface SourceFile {
  abs?: string;
  rel: string;
  ext: string;
  text: string;
}
