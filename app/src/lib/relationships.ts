import type { Gender } from "../data/family";
import type { PersonEntry } from "./layout";

const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth"];

const gendered = (gender: Gender, male: string, female: string, neutral: string) =>
  gender === "m" ? male : gender === "f" ? female : neutral;

function greatPrefix(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "great-";
  return `${"great-".repeat(count)}`;
}

function ancestorLabel(distance: number, gender: Gender): string {
  if (distance === 1) return gendered(gender, "father", "mother", "parent");
  if (distance === 2) return gendered(gender, "grandfather", "grandmother", "grandparent");
  return `${greatPrefix(distance - 2)}${gendered(gender, "grandfather", "grandmother", "grandparent")}`;
}

function descendantLabel(distance: number, gender: Gender): string {
  if (distance === 1) return gendered(gender, "son", "daughter", "child");
  if (distance === 2) return gendered(gender, "grandson", "granddaughter", "grandchild");
  return `${greatPrefix(distance - 2)}${gendered(gender, "grandson", "granddaughter", "grandchild")}`;
}

function removalLabel(n: number): string {
  if (n === 0) return "";
  if (n === 1) return " once removed";
  if (n === 2) return " twice removed";
  return ` ${n} times removed`;
}

function ancestorDistances(start: string, byName: Record<string, PersonEntry>): Map<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const queue = [start];

  while (queue.length) {
    const name = queue.shift()!;
    const nextDistance = (distances.get(name) ?? 0) + 1;
    for (const parent of byName[name]?.parents ?? []) {
      if (!distances.has(parent.name)) {
        distances.set(parent.name, nextDistance);
        queue.push(parent.name);
      }
    }
  }

  return distances;
}

export function describeRelationship(
  fromName: string,
  toName: string,
  people: PersonEntry[],
  displayName: (name: string) => string,
): string {
  if (!fromName || !toName) return "";
  const byName: Record<string, PersonEntry> = {};
  people.forEach((entry) => {
    byName[entry.person.name] = entry;
  });

  const from = byName[fromName];
  const to = byName[toName];
  if (!from || !to) return "Choose two people in the current tree.";

  const fromLabel = displayName(fromName);
  const toLabel = displayName(toName);
  const fromGender = from.person.gender;

  if (fromName === toName) return `${fromLabel} is the same person as ${toLabel}.`;

  if (from.spouses.some((spouse) => spouse.name === toName)) {
    return `${fromLabel} is ${toLabel}'s spouse.`;
  }

  const fromParents = new Set(from.parents.map((parent) => parent.name));
  const toParents = new Set(to.parents.map((parent) => parent.name));

  if (fromParents.has(toName)) {
    return `${fromLabel} is ${toLabel}'s ${descendantLabel(1, fromGender)}.`;
  }
  if (toParents.has(fromName)) {
    return `${fromLabel} is ${toLabel}'s ${ancestorLabel(1, fromGender)}.`;
  }

  const sharedParents = [...fromParents].filter((name) => toParents.has(name));
  if (sharedParents.length) {
    const half = sharedParents.length === 1 && (from.parents.length > 1 || to.parents.length > 1);
    return `${fromLabel} is ${toLabel}'s ${half ? "half-" : ""}${gendered(fromGender, "brother", "sister", "sibling")}.`;
  }

  const fromAncestors = ancestorDistances(fromName, byName);
  const toAncestors = ancestorDistances(toName, byName);

  const toAboveFrom = fromAncestors.get(toName);
  if (toAboveFrom) {
    return `${fromLabel} is ${toLabel}'s ${descendantLabel(toAboveFrom, fromGender)}.`;
  }

  const fromAboveTo = toAncestors.get(fromName);
  if (fromAboveTo) {
    return `${fromLabel} is ${toLabel}'s ${ancestorLabel(fromAboveTo, fromGender)}.`;
  }

  const common = [...fromAncestors.entries()]
    .filter(([name, distance]) => distance > 0 && (toAncestors.get(name) ?? 0) > 0)
    .map(([name, fromDistance]) => ({
      name,
      fromDistance,
      toDistance: toAncestors.get(name)!,
    }))
    .sort((a, b) => a.fromDistance + a.toDistance - (b.fromDistance + b.toDistance))[0];

  if (!common) return `${fromLabel} and ${toLabel} do not have a recorded blood relationship yet.`;

  if (common.fromDistance === 1 && common.toDistance >= 2) {
    const greats = common.toDistance - 2;
    return `${fromLabel} is ${toLabel}'s ${greatPrefix(greats)}${gendered(fromGender, "uncle", "aunt", "aunt/uncle")}.`;
  }

  if (common.fromDistance >= 2 && common.toDistance === 1) {
    const greats = common.fromDistance - 2;
    return `${fromLabel} is ${toLabel}'s ${greatPrefix(greats)}${gendered(fromGender, "nephew", "niece", "niece/nephew")}.`;
  }

  const degree = Math.max(1, Math.min(common.fromDistance, common.toDistance) - 1);
  const ordinal = ORDINALS[degree] ?? `${degree}th`;
  return `${fromLabel} is ${toLabel}'s ${ordinal} cousin${removalLabel(Math.abs(common.fromDistance - common.toDistance))}.`;
}
