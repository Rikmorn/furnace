// The CHROME's half of `session.query` — the answerer row, on its own.
//
// HERE AND NOT IN `tests/chrome/`, for `session-capture.test.ts`' and
// `session-mutation.test.ts`' reason exactly: this row needs no shell and no DOM. It reads
// one ref and calls one host verb.
//
// WHAT IT PINS is the RELAY — that the request reaches the host unreshaped, that the answer
// comes back untouched, and that a chrome with no engine THROWS rather than inventing an
// empty world. What the verb MEASURES is pinned where it lives
// (`tests/field-host/query.test.ts`); what the daemon ACCEPTS is pinned in
// `tests/backchannel.test.ts`.
import { expect, test } from "bun:test";
import type { FieldHost, QueryAnswer } from "../src/field-host/index.ts";
import { createSessionAnswerers } from "../src/frontend/lib/session-answerers.ts";

/** A fixed answer, deliberately not one any real world would produce, so a row that
 *  substituted its own could not pass by coincidence. */
const ANSWER: QueryAnswer = {
  about: "entities",
  entities: [],
  props: {
    total: 3,
    scanned: 3,
    floating: [],
    overlapping: [],
    truncated: false,
  },
};

/** A host that records the query calls. Boundary cast: this row reaches exactly one member
 *  of the facade, and a whole `FieldHost` here would be seventy stubs proving nothing. */
function stubHost(): { host: FieldHost; asked: unknown[] } {
  const asked: unknown[] = [];
  const host = {
    query: (req: unknown) => {
      asked.push(req);
      return ANSWER;
    },
  } as unknown as FieldHost;
  return { host, asked };
}

const row = (host: FieldHost | undefined): ((params: unknown) => unknown) => {
  const answerers = createSessionAnswerers(
    { current: null },
    { current: host },
    { current: null },
  );
  const handler = answerers["session.query"];
  if (handler === undefined) throw new Error("test: no session.query answerer");
  return handler;
};

test("session.query hands the request to the host UNRESHAPED and returns its answer", () => {
  const { host, asked } = stubHost();
  const req = {
    about: "ray" as const,
    origin: [0, 1, 0] as [number, number, number],
    dir: [0, -1, 0] as [number, number, number],
  };
  expect(row(host)(req)).toBe(ANSWER);
  // THE SAME OBJECT BY IDENTITY on both legs, and `toBe` rather than `toEqual` is the whole
  // assertion — `session-mutation.test.ts` measured that deep equality stays GREEN over a row
  // that rebuilt its argument, which is exactly where a field silently stops being forwarded.
  expect(asked.length).toBe(1);
  expect(asked[0]).toBe(req);
});

test("session.query with no engine THROWS — the read has no honest empty answer", () => {
  // THE OPPOSITE POSTURE FROM THE TWO WRITE ROWS, and it is decided by what an honest answer
  // would be rather than by taste. `edit.apply` and `generate` refuse, because "I did not do
  // it, and here is why" is a true thing to say. This row cannot: an empty entity list is a
  // POSITIVE claim that the world has nothing in it, and "nothing is wrong" is precisely what
  // a caller asks this verb to confirm. `useSessionAnswer` turns the throw into a typed
  // refusal, so the failure still lands as an answer at the door.
  expect(() => row(undefined)({ about: "entities" })).toThrow(/no engine yet/);
});

test("session.query with no `about` throws rather than silently answering about entities", () => {
  // The one shape assertion the row keeps. The daemon's schema is what REJECTS a bad request;
  // this exists so a hole in it becomes a sentence instead of a WRONG ANSWER — without the
  // guard, `undefined` falls through the union switch to the entities arm and a caller that
  // asked nothing is told about the whole world.
  const { host, asked } = stubHost();
  expect(() => row(host)(undefined)).toThrow(/`about`/);
  expect(() => row(host)({})).toThrow(/`about`/);
  expect(asked).toEqual([]);
});
