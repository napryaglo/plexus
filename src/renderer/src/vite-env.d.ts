// Ambient declaration for Vite's `?worker` imports (Monaco's web worker). Vite
// bundles these as same-origin worker files; the default export is a zero-arg
// Worker constructor. Kept local (rather than referencing vite/client) so it
// resolves regardless of how the renderer tsconfig is configured.
declare module '*?worker' {
    const workerConstructor: { new (): Worker }
    export default workerConstructor
}
