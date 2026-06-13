type EntityLike = { id: string; components: Record<string, unknown> };

/** Component names present on EVERY given entity, in the first entity's order. */
export function commonComponents(entities: EntityLike[]): string[] {
  const first = entities[0];
  if (first === undefined) return [];
  const rest = entities.slice(1);
  return Object.keys(first.components).filter((name) =>
    rest.every((e) => name in e.components),
  );
}
