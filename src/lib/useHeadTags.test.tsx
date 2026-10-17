import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { CONSULTANT_SEO, useHeadTags } from './useHeadTags';

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('[data-head-test]').forEach((node) => node.remove());
});

describe('useHeadTags', () => {
  it('replaces duplicate defaults, updates tags, safely serializes JSON-LD and restores defaults on unmount', () => {
    for (let i = 0; i < 2; i++) {
      const fallback = document.createElement('meta');
      fallback.name = 'description';
      fallback.content = 'Home description';
      fallback.setAttribute('data-head-test', '1');
      document.head.appendChild(fallback);
    }
    const originalCount = document.head.querySelectorAll('meta[name="description"]').length;
    const props = {
      description: 'Consultant description', canonical: 'https://www.aisupport360.com/for-consultants',
      ogTitle: 'Consultant title', ogDescription: 'Consultant description',
      ogUrl: 'https://www.aisupport360.com/for-consultants', jsonLd: { '@type': 'FAQPage', text: '</script>' },
    };
    const { rerender, unmount } = renderHook((input) => useHeadTags(input), { initialProps: props });
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('[data-seo="1"]')).toHaveLength(8);
    for (const [selector, value] of [
      ['meta[name="description"]', props.description], ['meta[property="og:title"]', props.ogTitle],
      ['meta[property="og:description"]', props.ogDescription], ['meta[property="og:url"]', props.ogUrl],
      ['meta[name="twitter:title"]', props.ogTitle], ['meta[name="twitter:description"]', props.ogDescription],
    ]) expect(document.head.querySelector(selector)?.getAttribute('content')).toBe(value);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(props.canonical);
    const text = document.head.querySelector('script[data-seo="1"]')?.textContent ?? '';
    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toEqual(props.jsonLd);
    rerender({ ...props, description: 'Updated description' });
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Updated description');
    unmount();
    expect(document.head.querySelectorAll('[data-seo="1"]')).toHaveLength(0);
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(originalCount);
    expect(document.head.querySelector('meta[data-head-test]')?.getAttribute('content')).toBe('Home description');
  });

  it('uses a 150-character consultant description', () => {
    expect(CONSULTANT_SEO.description.length).toBe(150);
  });
});