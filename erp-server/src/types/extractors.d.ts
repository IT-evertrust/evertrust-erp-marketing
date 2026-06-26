// Minimal ambient types for the two pure-JS text extractors used by the Engage
// knowledge base (KnowledgeService). pdf-parse ships no types; mammoth's are declared
// here too so the import is typed without an extra @types dependency.
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
  }
  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdfParse;
}

declare module 'mammoth' {
  const mammoth: {
    extractRawText(input: { buffer: Buffer }): Promise<{
      value: string;
      messages: unknown[];
    }>;
  };
  export default mammoth;
}
