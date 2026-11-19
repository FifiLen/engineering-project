/** Adres strony do metadanych, mapy strony i robots (`PUBLIC_SITE_URL`, ten sam co w kodach QR, ADR 0041). */
export const siteUrl = () => (process.env.PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
