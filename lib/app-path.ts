/** Keep links inside the repository path on GitHub Pages. */
export const appPath = (path = '') => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/${path.replace(/^\/+/, '')}`;
