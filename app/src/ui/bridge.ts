import { invoke } from '@forge/bridge';

/**
 * Typed wrapper over the Forge bridge `invoke`. The real bridge returns
 * `InvokeResponse<T>` (a union with a metadata variant); our resolvers always
 * return the payload directly, so we narrow to `T` here in one place. The
 * harness mock aliases `@forge/bridge` and returns `T` as-is.
 */
export async function call<T>(key: string, payload?: unknown): Promise<T> {
  return (await invoke<T>(key, payload as Parameters<typeof invoke>[1])) as T;
}
