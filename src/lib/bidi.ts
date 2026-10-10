/**
 * Keeps a date in the order it was typed when it sits inside right-to-left text:
 * "2026-10-09" inside an Arabic sentence is read as "09-10-2026" without help. A left-to-right isolate around the date fixes the order.
 */
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

const DATE_LIKE = /\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}/g;

export function isolateDates(text: string | null | undefined): string {
  return (text ?? '').replace(DATE_LIKE, (m) => `${LRI}${m}${PDI}`);
}
