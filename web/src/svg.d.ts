// Tabler icon SVGs are loaded as raw text via angular.json's `"loader": { ".svg": "text" }`.
declare module '*.svg' {
  const content: string;
  export default content;
}
