/**
 * One set of rules for files that are attached to a ticket: the new request, the edit dialog and the Documents tab all use it.
 * (The storage bucket also refuses executable files.)
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_LABEL = '10 MB';
export const ATTACHMENT_HINT = 'PDF, Word, Excel, CSV, text or image files, up to 10 MB each';

export const ALLOWED_ATTACHMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
  'text/plain',
  'text/csv',
];

// browsers often send no type at all for these
const TYPE_LESS_EXTENSIONS = ['log', 'txt', 'csv'];

export const BLOCKED_ATTACHMENT_EXTENSIONS = [
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'msp', 'dll', 'vbs', 'vbe', 'wsf', 'ps1', 'psm1', 'jar', 'apk', 'app', 'dmg', 'iso', 'lnk', 'reg', 'hta', 'cpl',
  'sh', 'php', 'js', 'html', 'htm', 'svg', 'xml',
];

export function attachmentExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

/** A message when the file may not be attached, otherwise null. */
export function validateAttachment(file: File): string | null {
  const ext = attachmentExtension(file.name);
  if (ext && BLOCKED_ATTACHMENT_EXTENSIONS.includes(ext)) return `${file.name}: files of type .${ext} are not allowed.`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name}: ${(file.size / 1048576).toFixed(1)} MB is too large (the limit is ${MAX_ATTACHMENT_LABEL}).`;
  }
  const typeOk = ALLOWED_ATTACHMENT_TYPES.includes(file.type) || (file.type === '' && TYPE_LESS_EXTENSIONS.includes(ext));
  if (!typeOk) return `${file.name}: this kind of file is not allowed. Use ${ATTACHMENT_HINT}.`;
  return null;
}

/** Splits a selection into the files that can be attached and one message for each refused file. */
export function checkAttachments(files: File[]): { accepted: File[]; problems: string[] } {
  const accepted: File[] = [];
  const problems: string[] = [];
  for (const f of files) {
    const problem = validateAttachment(f);
    if (problem) problems.push(problem);
    else accepted.push(f);
  }
  return { accepted, problems };
}
