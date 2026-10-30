/// <reference types="vite/client" />

declare module '*.asset.json' {
  const value: { url: string; asset_id: string; version: number; project_id: string };
  export default value;
}


// Browser build of the React server renderer (used for the admin e-mail preview).
declare module 'react-dom/server.browser' {
  export { renderToStaticMarkup } from 'react-dom/server';
}
