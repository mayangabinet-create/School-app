/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // pdf.js and tesseract.js are both loaded lazily, in the browser, and only
  // when a student actually picks a file — see lib/extract/. Neither belongs
  // in a server bundle, and tesseract in particular pulls a worker and a WASM
  // core that Next would otherwise try to trace.
  serverExternalPackages: ["pdfjs-dist", "tesseract.js"],

  async headers() {
    // The OCR worker and the WASM core are fetched from a CDN at run time. If
    // that loader ever changes, this list changes in the same commit — a CSP
    // that has fallen behind its loader produces a page that silently fails to
    // work rather than an error anyone can read.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' blob: data: https://*.supabase.co https://cdn.jsdelivr.net https://tessdata.projectnaptha.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
};

export default nextConfig;
