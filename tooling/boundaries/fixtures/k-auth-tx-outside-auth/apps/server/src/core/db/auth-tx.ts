export async function authTx<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}
