export async function previewBatch<Item, Preview>(items: Item[], load: (item: Item, index: number) => Promise<Preview>) {
  const successes: Array<{ item: Item; preview: Preview }> = [];
  const failures: Array<{ item: Item; cause: unknown }> = [];
  for (const [index, item] of items.entries()) {
    try {
      successes.push({ item, preview: await load(item, index) });
    } catch (cause) {
      failures.push({ item, cause });
    }
  }
  return { successes, failures };
}
