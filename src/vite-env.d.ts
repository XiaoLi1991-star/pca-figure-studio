/// <reference types="vite/client" />

declare module 'plotly.js-dist-min' {
  const Plotly: {
    react: (
      element: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => Promise<unknown>
    purge: (element: HTMLElement) => void
    downloadImage: (
      element: HTMLElement,
      options: Record<string, unknown>,
    ) => Promise<string>
    toImage: (
      element: HTMLElement,
      options: Record<string, unknown>,
    ) => Promise<string>
  }

  export default Plotly
}
