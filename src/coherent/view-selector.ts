export function assertPageId(pageId: number): number {
  if (!Number.isInteger(pageId) || pageId < 0) {
    throw new Error("pageId must be a non-negative integer");
  }

  return pageId;
}
