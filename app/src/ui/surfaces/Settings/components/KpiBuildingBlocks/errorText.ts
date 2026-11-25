/** A thrown value's message, for showing next to the action that failed. */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
