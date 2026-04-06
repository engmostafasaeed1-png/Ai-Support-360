/// <reference types="vite/client" />

declare module '*.asset.json' {
  const value: { url: string; asset_id: string; version: number; project_id: string };
  export default value;
}

