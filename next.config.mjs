/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self'; font-src 'self' data:; upgrade-insecure-requests" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path((?!telegram|max).*)', headers: securityHeaders },
      { source: '/telegram/:path*', headers: securityHeaders.filter(h => h.key !== 'X-Frame-Options' && h.key !== 'Content-Security-Policy').concat([{ key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org; object-src 'none'; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self';" }]) },
      { source: '/max/:path*', headers: securityHeaders.filter(h => h.key !== 'X-Frame-Options' && h.key !== 'Content-Security-Policy').concat([{ key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'self'; frame-ancestors https://max.ru https://*.max.ru; object-src 'none'; script-src 'self' 'unsafe-inline' https://st.max.ru; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self';" }]) },
      { source: '/admin/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};
export default nextConfig;
