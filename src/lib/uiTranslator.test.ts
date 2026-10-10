import { afterEach, describe, expect, it } from 'vitest';
import {
  compileDictionary,
  startUiTranslator,
  translateDates,
  translateRelativeTime,
  translateText,
  translateTitle,
  translateValue,
} from './uiTranslator';

const dict = compileDictionary({
  Dashboard: 'لوحة التحكم',
  Client: 'العميل',
  Tickets: 'التذاكر',
  'in progress': 'قيد التنفيذ',
  'Add Task': 'إضافة مهمة',
  'Search tickets...': 'ابحث في التذاكر...',
  'A new ticket "{0}" ({1}) has been submitted.': 'تم إرسال تذكرة جديدة "{0}" ({1}).',
  'Ticket "{0}" status changed to "{1}".': 'تغيّرت حالة التذكرة "{0}" إلى "{1}".',
  'Due {0}': 'الاستحقاق {0}',
});

describe('translateText', () => {
  it('translates a whole text, whatever the spaces around and inside it', () => {
    expect(translateText('Dashboard', dict)).toBe('لوحة التحكم');
    expect(translateText('  Add \n  Task ', dict)).toBe('إضافة مهمة');
  });

  it('gives null for an unknown text and for a text without Latin letters', () => {
    expect(translateText('Something else', dict)).toBeNull();
    expect(translateText('لوحة التحكم', dict)).toBeNull();
    expect(translateText('   ', dict)).toBeNull();
  });

  it('keeps the parts of a pattern (names, titles) and translates them when they are known', () => {
    expect(translateText('A new ticket "QA 1" (SAP MM) has been submitted.', dict)).toBe('تم إرسال تذكرة جديدة "QA 1" (SAP MM).');
    expect(translateText('Ticket "X" status changed to "in progress".', dict)).toBe('تغيّرت حالة التذكرة "X" إلى "قيد التنفيذ".');
  });

  it('translates a date inside a pattern', () => {
    expect(translateText('Due Oct 22, 2026', dict)).toBe('الاستحقاق 22 أكتوبر 2026');
  });
});

describe('translateValue', () => {
  it('keeps the spaces around the text', () => {
    expect(translateValue('  Dashboard ', dict)).toBe('  لوحة التحكم ');
    expect(translateValue('Nothing', dict)).toBeNull();
  });
});

describe('translateRelativeTime', () => {
  it('translates the texts of "x ago" and "in x"', () => {
    expect(translateRelativeTime('about 2 hours ago')).toBe('منذ حوالي ساعتين');
    expect(translateRelativeTime('1 day ago')).toBe('منذ يوم');
    expect(translateRelativeTime('15 minutes ago')).toBe('منذ 15 دقيقة');
    expect(translateRelativeTime('5 days ago')).toBe('منذ 5 أيام');
    expect(translateRelativeTime('less than a minute ago')).toBe('منذ أقل من دقيقة');
    expect(translateRelativeTime('in 3 days')).toBe('خلال 3 أيام');
  });

  it('leaves every other text alone', () => {
    expect(translateRelativeTime('2 hours')).toBeNull();
    expect(translateRelativeTime('hello')).toBeNull();
  });
});

describe('translateDates', () => {
  it('translates month names, weekdays and AM / PM', () => {
    expect(translateDates('Oct 12, 2026')).toBe('12 أكتوبر 2026');
    expect(translateDates('Mon, Oct 12 · 10:00 AM')).toBe('الإثنين، 12 أكتوبر · 10:00 ص');
    expect(translateDates('Saturday, October 10, 2026')).toBe('السبت، 10 أكتوبر 2026');
    expect(translateDates('October 2026')).toBe('أكتوبر 2026');
    expect(translateDates('Dec 2025')).toBe('ديسمبر 2025');
    expect(translateDates('7:58:34 PM')).toBe('7:58:34 م');
  });

  it('does nothing for a text without digits or without a date', () => {
    expect(translateDates('May the force be with you')).toBeNull();
    expect(translateDates('Version 12')).toBeNull();
  });
});

describe('translateTitle', () => {
  it('translates every part of the title and keeps the brand', () => {
    expect(translateTitle('Tickets · Client — AI Support 360', dict)).toBe('التذاكر · العميل — AI Support 360');
    expect(translateTitle('Unknown — AI Support 360', dict)).toBeNull();
  });
});

describe('startUiTranslator', () => {
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = '';
    document.title = '';
  });

  it('translates the page, what is added later, the attributes and the title, and gives the English text back on stop', async () => {
    document.body.innerHTML = '<main><h1>Dashboard</h1><input placeholder="Search tickets..." /><textarea placeholder="Add Task"></textarea></main>';
    document.title = 'Tickets · Client — AI Support 360';
    const handle = startUiTranslator({
      Dashboard: 'لوحة التحكم',
      Client: 'العميل',
      Tickets: 'التذاكر',
      'Add Task': 'إضافة مهمة',
      'Search tickets...': 'ابحث في التذاكر...',
    });
    stop = handle.stop;
    expect(document.querySelector('h1')?.textContent).toBe('لوحة التحكم');
    expect(document.querySelector('input')?.getAttribute('placeholder')).toBe('ابحث في التذاكر...');
    expect(document.querySelector('textarea')?.getAttribute('placeholder')).toBe('إضافة مهمة');
    expect(document.title).toBe('التذاكر · العميل — AI Support 360');

    const added = document.createElement('p');
    added.textContent = 'Add Task';
    document.querySelector('main')?.appendChild(added);
    await tick();
    expect(added.textContent).toBe('إضافة مهمة');

    added.firstChild!.nodeValue = 'Dashboard';
    await tick();
    expect(added.textContent).toBe('لوحة التحكم');

    handle.stop();
    stop = undefined;
    expect(document.querySelector('h1')?.textContent).toBe('Dashboard');
    expect(document.querySelector('input')?.getAttribute('placeholder')).toBe('Search tickets...');
    expect(added.textContent).toBe('Dashboard');
    expect(document.title).toBe('Tickets · Client — AI Support 360');
  });

  it('does not touch text areas, code, or what is marked as not to translate', () => {
    document.body.innerHTML = '<div><textarea>Dashboard</textarea><code>Dashboard</code><span data-no-translate>Dashboard</span><span>Dashboard</span></div>';
    const handle = startUiTranslator({ Dashboard: 'لوحة التحكم' });
    stop = handle.stop;
    expect(document.querySelector('textarea')?.value).toBe('Dashboard');
    expect(document.querySelector('code')?.textContent).toBe('Dashboard');
    expect(document.querySelector('[data-no-translate]')?.textContent).toBe('Dashboard');
    expect(document.querySelectorAll('span')[1].textContent).toBe('لوحة التحكم');
  });

  it('translates the texts that were missing when a new dictionary arrives', () => {
    document.body.innerHTML = '<p>Dashboard</p><p>Tickets</p>';
    const handle = startUiTranslator({ Dashboard: 'لوحة التحكم' });
    stop = handle.stop;
    expect(document.querySelectorAll('p')[1].textContent).toBe('Tickets');
    handle.setDictionary({ Dashboard: 'لوحة التحكم', Tickets: 'التذاكر' });
    expect(document.querySelectorAll('p')[1].textContent).toBe('التذاكر');
  });
});
