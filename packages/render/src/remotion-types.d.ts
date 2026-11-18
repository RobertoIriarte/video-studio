// Remotion 4.0.544 publishes an unqualified Bun `Timer` in browser declarations.
// Its actual implementation uses setTimeout. Keep the runtime's timer type,
// without adding Node globals to the browser or weakening library checking.
export {};
declare global { type Timer = ReturnType<typeof setTimeout>; }
