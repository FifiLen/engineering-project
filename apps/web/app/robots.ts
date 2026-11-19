import type { MetadataRoute } from 'next';
import { siteUrl } from '../lib/site/url';

/** Robots (ADR 0065): mapa strony, bez panelu i punktów API strony. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api'] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
