function getBackendOrigin() {
  const value = process.env.BACKEND_ORIGIN?.trim();
  if (!value) {
    throw new Error('Set BACKEND_ORIGIN to the HTTPS origin of the persistent API service before deploying to Vercel.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('BACKEND_ORIGIN must be an HTTPS origin, such as the live backend service address.');
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash) {
    throw new Error('BACKEND_ORIGIN must be an HTTPS origin without a path, query, fragment, or credentials.');
  }
  return url.origin;
}

const backendOrigin = getBackendOrigin();

export const config = {
  framework: 'vite',
  installCommand: 'npm ci && npm --prefix client ci',
  buildCommand: 'npm run build',
  outputDirectory: 'client/dist',
  rewrites: [
    { source: '/api/:path*', destination: `${backendOrigin}/api/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
};
