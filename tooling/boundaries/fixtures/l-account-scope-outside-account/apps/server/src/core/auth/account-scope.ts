export async function runInAccountScope<T>(_id: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}
