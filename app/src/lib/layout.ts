/**
 * LAYOUT ENGINE
 * ------------------------------------------------------------------
 * A tidy, top-down family-tree layout. A "union" is one row of cards:
 * a primary person, their direct spouse(s), and — nested one level —
 * each spouse's OWN additional spouse(s) (how step-parents render).
 * All of a union's children pool into a single row below it (regardless
 * of which specific couple parented them — see EffectiveNode/SpouseSlot
 * in lib/structure.ts for the precise parent bookkeeping used to compute
 * each person's OWN parents/spouses/children for their dossier).
 *
 * Subtree widths are measured bottom-up, then x-positions are assigned
 * centered over each child block. This recursion is what lets branches
 * grow arbitrarily wide/deep (new siblings, their own descendants, a new
 * ancestor's other children, …) without any special-casing — the tree
 * just gets wider/taller automatically.
 */
import type { Person } from "../data/family";
import type { EffectiveNode } from "./structure";

export const CARD_W = 126;
export const CARD_H = 168;
export const COUPLE_GAP = 24;
export const H_GAP = 30;
export const V_GAP = 250;
export const PAD = 140;

export interface CardBox {
  person: Person;
  x: number;
  y: number;
  isPrimary: boolean;
  isInLaw: boolean;
  relationLabel: string | null;
}

export interface PositionedUnion {
  id: number;
  depth: number;
  cx: number;
  y: number;
  cards: CardBox[];
  ref: EffectiveNode;
}

export interface Edge {
  d: string;
  gender?: "f";
  flow?: boolean;
  marriage?: boolean;
}

export interface LayoutResult {
  nodes: PositionedUnion[];
  edges: Edge[];
  width: number;
  height: number;
  maxDepth: number;
}

/** Flat row of every person in a union (primary, direct spouses, and their nested sub-spouses), in draw order. */
function rowOf(n: EffectiveNode): Person[] {
  const row: Person[] = [n.person];
  n.spouseSlots.forEach((slot) => {
    row.push(slot.person);
    slot.subSpouses.forEach((ss) => row.push(ss));
  });
  return row;
}

/** Every row member's own direct partner(s) (primary↔direct spouses, spouse↔their own sub-spouses). */
function partnerMap(n: EffectiveNode): Map<string, Person[]> {
  const m = new Map<string, Person[]>();
  m.set(
    n.person.name,
    n.spouseSlots.map((s) => s.person),
  );
  n.spouseSlots.forEach((slot) => {
    m.set(slot.person.name, [n.person, ...slot.subSpouses]);
    slot.subSpouses.forEach((ss) => m.set(ss.name, [slot.person]));
  });
  return m;
}

type Internal = EffectiveNode & {
  _id?: number;
  _depth?: number;
  _parent?: Internal | null;
  _cx?: number;
  _y?: number;
  _w?: number;
};

const relationLabel = (relation: Person["relation"]): string | null => {
  if (relation === "son") return "Son";
  if (relation === "daughter") return "Daughter";
  if (relation === "son-in-law") return "Son-in-law";
  if (relation === "daughter-in-law") return "Daughter-in-law";
  return null;
};

export function buildLayout(root: EffectiveNode): LayoutResult {
  let uid = 0;
  const nodes: PositionedUnion[] = [];
  const edges: Edge[] = [];

  const rowLen = (n: EffectiveNode) =>
    1 + n.spouseSlots.reduce((sum, s) => sum + 1 + s.subSpouses.length, 0);
  const unitW = (n: EffectiveNode) => {
    const len = rowLen(n);
    return len * CARD_W + (len - 1) * COUPLE_GAP;
  };

  function measure(n: Internal): number {
    const uw = unitW(n);
    if (!n.children.length) {
      n._w = uw;
      return uw;
    }
    let cw = 0;
    n.children.forEach((c, i) => {
      cw += measure(c as Internal);
      if (i) cw += H_GAP;
    });
    n._w = Math.max(uw, cw);
    return n._w;
  }

  function assign(n: Internal, left: number, depth: number, parent: Internal | null): void {
    n._id = uid++;
    n._depth = depth;
    n._parent = parent;
    n._cx = left + n._w! / 2;
    n._y = PAD + depth * V_GAP;
    if (n.children.length) {
      let tot = 0;
      n.children.forEach((c, i) => {
        tot += (c as Internal)._w!;
        if (i) tot += H_GAP;
      });
      let cl = n._cx - tot / 2;
      n.children.forEach((c) => {
        assign(c as Internal, cl, depth + 1, n);
        cl += (c as Internal)._w! + H_GAP;
      });
    }
  }

  measure(root as Internal);
  assign(root as Internal, PAD, 0, null);

  let maxDepth = 0;

  (function collect(n: Internal): void {
    maxDepth = Math.max(maxDepth, n._depth!);
    const cx = n._cx!;
    const y = n._y!;
    const row = rowOf(n);
    const uw = unitW(n);
    const startX = cx - uw / 2;

    const cards: CardBox[] = row.map((p, i) => {
      const isPrimary = i === 0;
      const inferredRelation = isPrimary
        ? p.gender === "f"
          ? "Daughter"
          : "Son"
        : p.gender === "f"
          ? "Daughter-in-law"
          : "Son-in-law";
      return {
        person: p,
        x: startX + i * (CARD_W + COUPLE_GAP),
        y,
        isPrimary,
        isInLaw: !isPrimary,
        relationLabel: n._depth === 0 && isPrimary ? null : relationLabel(p.relation) ?? inferredRelation,
      };
    });
    nodes.push({ id: n._id!, depth: n._depth!, cx, y, cards, ref: n });

    // Marriage spine: one line spanning the whole union row, with a ring
    // marker at each gap (schematic — precise "who's married to whom"
    // lives in the data / dossier, not the connector art).
    if (row.length > 1) {
      const my = y + CARD_H / 2;
      edges.push({ d: `M ${startX} ${my} H ${startX + uw}`, gender: "f", marriage: true });
    }

    // Parent → children orthogonal bus
    if (n.children.length) {
      const py = y + CARD_H;
      const busY = y + CARD_H + (V_GAP - CARD_H) * 0.42;
      edges.push({ d: `M ${cx} ${py} V ${busY}`, flow: true }); // trunk
      const cxs = n.children.map((c) => (c as Internal)._cx!);
      const minx = Math.min(...cxs);
      const maxx = Math.max(...cxs);
      if (n.children.length > 1) edges.push({ d: `M ${minx} ${busY} H ${maxx}` }); // bus
      n.children.forEach((c) => {
        const ccx = (c as Internal)._cx!;
        const cy = (c as Internal)._y!;
        edges.push({ d: `M ${ccx} ${busY} V ${cy}`, flow: true }); // drops
      });
      n.children.forEach((c) => collect(c as Internal));
    }
  })(root as Internal);

  const width = (root as Internal)._w! + PAD * 2; // measure() already takes the max with unitW(root)
  const height = PAD + (maxDepth + 1) * V_GAP + CARD_H * 0.4;
  return { nodes, edges, width, height, maxDepth };
}

/** A single searchable person + their own precise relationship context. */
export interface PersonEntry {
  person: Person;
  union: PositionedUnion;
  gen: number;
  cardX: number;
  cardY: number;
  spouses: Person[];
  parents: Person[];
  children: Person[];
  /** The blood primary of the parent union — i.e. where a NEW sibling of
   *  this person must be stored (childrenOf bucket), regardless of which
   *  specific couple within that union actually parented them. */
  parentUnionPrimary: string | null;
}

export function indexPeople(nodes: PositionedUnion[]): PersonEntry[] {
  const list: PersonEntry[] = [];
  const byId: Record<number, PositionedUnion> = {};
  nodes.forEach((u) => (byId[u.id] = u));

  nodes.forEach((u) => {
    const partners = partnerMap(u.ref);
    const parentRef = (u.ref as Internal)._parent;
    const parentU = parentRef ? byId[parentRef._id!] : null;
    const findInParentRow = (name?: string): Person | null => {
      if (!name || !parentU) return null;
      return parentU.cards.find((c) => c.person.name === name)?.person ?? null;
    };

    u.cards.forEach((card) => {
      const name = card.person.name;
      const isPrimaryOfThisUnion = card.isPrimary;
      const parents = isPrimaryOfThisUnion
        ? [findInParentRow(u.ref.parentA), findInParentRow(u.ref.parentB)].filter(
            (p): p is Person => !!p,
          )
        : [];
      const children = (u.ref.children ?? [])
        .filter((c) => c.parentA === name || c.parentB === name || (!c.parentA && !c.parentB))
        .map((c) => c.person);

      list.push({
        person: card.person,
        union: u,
        gen: u.depth,
        cardX: card.x,
        cardY: card.y,
        spouses: partners.get(name) ?? [],
        parents,
        children,
        parentUnionPrimary: isPrimaryOfThisUnion && parentU ? parentU.cards[0].person.name : null,
      });
    });
  });
  return list;
}
