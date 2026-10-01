// Extracts plain text from uploaded training files in the browser.
export const TRAINING_FILE_ACCEPT = '.txt,.md,.csv,.pdf,.docx';
export const MAX_TRAINING_FILE_BYTES = 10 * 1024 * 1024;

export async function extractFileText(file: File): Promise<string> {
  if (file.size > MAX_TRAINING_FILE_BYTES) throw new Error(`${file.name} is larger than 10 MB`);
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 100); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it: any) => it.str ?? '').join(' '));
    }
    return pages.join('\n\n').replace(/[ \t]+/g, ' ').trim();
  }
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return res.value.trim();
  }
  if (/\.(txt|md|csv)$/.test(name)) return (await file.text()).trim();
  throw new Error(`${file.name}: only TXT, MD, CSV, PDF or DOCX files are supported`);
}
