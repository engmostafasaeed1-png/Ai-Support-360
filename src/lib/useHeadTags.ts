import { useEffect } from 'react';

export const CONSULTANT_SEO = {
  title: 'SAP Consultant Jobs: Keep 100% of Your Rate | AI Support 360',
  description: 'Set your SAP consulting rate and keep 100% of it. Clients pay the fees on top. Verified consultants get matched requests, payouts and visible trust badges.',
};

export const PRICING_SEO = {
  title: 'Support Plans & Pricing — AI Support 360',
  description: 'SAP support priced on the hours you approve: you accept the hourly rate and each timesheet, and invoices show platform fees and VAT.',
};

type HeadTags = {
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  jsonLd?: unknown;
};

/** Own these tags synchronously; restore static defaults when the page leaves. */
export function useHeadTags({ description, canonical, ogTitle, ogDescription, ogUrl, jsonLd }: HeadTags) {
  const serialized = jsonLd === undefined ? undefined : JSON.stringify(jsonLd).replace(/</g, '\\u003c');
  useEffect(() => {
    const restore: (() => void)[] = [];
    function replace(selector: string, tag: string, attributes: Record<string, string>, text?: string) {
      const previous = Array.from(document.head.querySelectorAll(selector));
      previous.forEach((node) => node.remove());
      const node = document.createElement(tag);
      Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
      node.setAttribute('data-seo', '1');
      if (text !== undefined) node.textContent = text;
      document.head.appendChild(node);
      restore.push(() => {
        node.remove();
        previous.forEach((original) => document.head.appendChild(original));
      });
    }
    replace('meta[name="description"]', 'meta', { name: 'description', content: description });
    replace('link[rel="canonical"]', 'link', { rel: 'canonical', href: canonical });
    for (const [property, content] of [['og:title', ogTitle], ['og:description', ogDescription], ['og:url', ogUrl]]) {
      replace(`meta[property="${property}"]`, 'meta', { property, content });
    }
    for (const [name, content] of [['twitter:title', ogTitle], ['twitter:description', ogDescription]]) {
      replace(`meta[name="${name}"]`, 'meta', { name, content });
    }
    if (serialized !== undefined) {
      replace('script[type="application/ld+json"][data-seo="1"]', 'script', { type: 'application/ld+json' }, serialized);
    }
    return () => restore.reverse().forEach((undo) => undo());
  }, [description, canonical, ogTitle, ogDescription, ogUrl, serialized]);
}