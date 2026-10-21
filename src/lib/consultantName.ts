// Feature X: consultant name formats, shared with the edge functions and mirrored by the database
// (public.format_consultant_name). The database decides what each viewer receives; the browser only previews.
export {
  DEFAULT_NAME_FORMAT, NAME_FORMATS, formatConsultantName, isNameFormat, maskingFromSetting, nameWords, publicConsultantName, starsFor,
  type NameFormat, type NameViewer,
} from '../../supabase/functions/_shared/consultantName';
import type { NameFormat } from '../../supabase/functions/_shared/consultantName';

/** Labels of the four formats (English, Arabic). */
export const NAME_FORMAT_LABEL: Record<NameFormat, [string, string]> = {
  masked: ['First initial and hidden family name', 'الحرف الأول واسم العائلة مخفي'],
  initial_family: ['First initial and family name', 'الحرف الأول واسم العائلة'],
  initials: ['Initials only', 'الأحرف الأولى فقط'],
  full: ['Full name', 'الاسم الكامل'],
};

/** Every string of the name privacy settings (English, Arabic). */
export const NAME_PRIVACY_STRINGS = {
  title: ['How clients see your name', 'كيف يرى العملاء اسمك'],
  hint: [
    'Before you are ready on a ticket and you and the client have both signed the NDA, clients, other consultants and visitors see only this format. After that, that client sees your full name. Administrators always see it.',
    'قبل أن تصبح جاهزاً في تذكرة ويوقّع كلٌّ منك ومن العميل اتفاقية عدم الإفصاح، يرى العملاء والمستشارون الآخرون والزوار هذا الشكل فقط. بعد ذلك يرى ذلك العميل اسمك الكامل. يرى المسؤولون اسمك دائماً.',
  ],
  preview: ['Visible to clients as:', 'يظهر للعملاء هكذا:'],
  recommended: ['Recommended', 'مُوصى به'],
  saved: ['Saved', 'تم الحفظ'],
  error: ['Your choice could not be saved', 'تعذّر حفظ اختيارك'],
  off: ['Name hiding is switched off by the platform: everyone sees full names for now.', 'إخفاء الأسماء متوقف من المنصة: يرى الجميع الأسماء الكاملة حالياً.'],
  adminHint: ['Visible to clients as:', 'يظهر للعملاء هكذا:'],
} as const;

export const pickLang = (pair: readonly [string, string], ar: boolean) => (ar ? pair[1] : pair[0]);
