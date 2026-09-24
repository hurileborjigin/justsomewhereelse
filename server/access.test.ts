import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXED_OWNERS, KNOCK_TTL_MS, type PlayerId } from "../shared/protocol.ts";
import { Access } from "./access.ts";

/** A tiny in-memory owner map, standing in for the store during unit tests. */
function make() {
  const owners = new Map<string, PlayerId>();
  const ownerOf = (id: string): PlayerId | null =>
    Object.hasOwn(FIXED_OWNERS, id) ? FIXED_OWNERS[id] : (owners.get(id) ?? null);
  const setOwner = (id: string, owner: PlayerId | null) => {
    if (owner === null) owners.delete(id);
    else owners.set(id, owner);
  };
  let t = 0;
  const clock = { now: () => t, tick: (ms: number) => (t += ms) };
  const access = new Access(ownerOf, clock.now);
  return { access, setOwner, ownerOf, clock };
}

test("claiming an open building makes it the claimer's", () => {
  const { access } = make();
  assert.equal(access.claim(0, "house1", 0), null);
});

test("claiming a building the other player owns is refused", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  assert.equal(access.claim(1, "house1", 1), "owner");
});

test("the owner may open their building to both again", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  assert.equal(access.claim(0, "house1", null), null);
});

test("the fixed houses refuse every change", () => {
  const { access } = make();
  assert.equal(access.claim(0, "hive", 0), "fixed");
  assert.equal(access.claim(0, "hive", null), "fixed");
  assert.equal(access.claim(1, "hall", 1), "fixed");
});

test("an invalid building id is refused for every op", () => {
  const { access } = make();
  assert.equal(access.claim(0, "Not Valid!", 0), "invalid");
  assert.equal(access.knock(0, "globe", false), "invalid");
  assert.equal(access.open(0, "globe"), "invalid");
});

test("knocking while the owner is offline is refused and leaves no knock behind", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  assert.equal(access.knock(1, "house1", false), "away");
  assert.equal(access.open(0, "house1"), "noknock");
});

test("knocking at an open building, or at one's own, is refused as already enterable", () => {
  const { access, setOwner } = make();
  assert.equal(access.knock(1, "house1", true), "open");
  setOwner("house1", 1);
  assert.equal(access.knock(1, "house1", true), "open");
});

test("a knock then an open grants entry and mayEnter answers true", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  assert.equal(access.mayEnter(1, "house1"), false);
  assert.equal(access.knock(1, "house1", true), null);
  assert.deepEqual(access.open(0, "house1"), { guest: 1 });
  assert.equal(access.mayEnter(1, "house1"), true);
});

test("only the owner may open the door", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  access.knock(1, "house1", true);
  assert.equal(access.open(1, "house1"), "owner");
});

test("moved marks entry then ends the grant once the guest steps back out", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  access.knock(1, "house1", true);
  access.open(0, "house1");
  assert.deepEqual(access.moved(1, "house1"), []);
  assert.deepEqual(access.moved(1, "globe"), [{ id: "house1", guest: 1 }]);
  assert.equal(access.mayEnter(1, "house1"), false);
});

test("the owner walking away never ends a grant that is not theirs", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  access.knock(1, "house1", true);
  access.open(0, "house1");
  assert.deepEqual(access.moved(0, "globe"), []);
  assert.equal(access.mayEnter(1, "house1"), true);
});

test("left ends every grant the departing player held", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  access.knock(1, "house1", true);
  access.open(0, "house1");
  assert.deepEqual(access.left(1), [{ id: "house1", guest: 1 }]);
  assert.equal(access.mayEnter(1, "house1"), false);
});

test("expire drops a stale knock and an unentered grant, but not an entered one", () => {
  const { access, setOwner, clock } = make();
  setOwner("house1", 0);
  setOwner("house2", 0);
  setOwner("house3", 0);
  access.knock(1, "house1", true); // never opened
  access.knock(1, "house2", true);
  access.open(0, "house2"); // grant, guest never enters
  access.knock(1, "house3", true);
  access.open(0, "house3");
  access.moved(1, "house3"); // guest enters house3

  clock.tick(10 * 60 * 1000);
  const ended = access.expire();
  assert.deepEqual(
    ended.sort((a, b) => a.id.localeCompare(b.id)),
    [{ id: "house2", guest: 1 }],
  );
  assert.equal(access.open(0, "house1"), "noknock", "the stale knock at house1 is gone");
  assert.equal(access.mayEnter(1, "house3"), true, "the entered grant at house3 survives");
});

test("opening a building to both ends any live grant, reported through lastEnded", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  access.knock(1, "house1", true);
  access.open(0, "house1");
  assert.equal(access.claim(0, "house1", null), null);
  assert.deepEqual(access.lastEnded(), [{ id: "house1", guest: 1 }]);
  setOwner("house1", null);
  assert.equal(access.mayEnter(1, "house1"), true);
});

test("lastEnded is empty when opening a building with nobody inside", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  assert.equal(access.claim(0, "house1", null), null);
  assert.deepEqual(access.lastEnded(), []);
});

test("opening a building to both drops a pending knock too", () => {
  const { access, setOwner } = make();
  setOwner("house1", 0);
  access.knock(1, "house1", true);
  assert.deepEqual(access.knocksFor(0), [{ id: "house1", from: 1, ageMs: 0 }]);
  access.claim(0, "house1", null);
  assert.deepEqual(access.knocksFor(0), []);
});

test("grants and knocksFor report the live state for each building's owner", () => {
  const { access, setOwner, clock } = make();
  setOwner("house1", 0);
  setOwner("house2", 1);
  access.knock(1, "house1", true);
  clock.tick(1500);
  access.knock(0, "house2", true);
  clock.tick(500);
  assert.deepEqual(access.knocksFor(0), [{ id: "house1", from: 1, ageMs: 2000 }], "each knock says how old it is");
  assert.deepEqual(access.knocksFor(1), [{ id: "house2", from: 0, ageMs: 500 }]);
  access.open(0, "house1");
  assert.deepEqual(access.grants(), [{ id: "house1", guest: 1 }]);
});

test("'constructor' and '__proto__' are ordinary open buildings, not prototype leaks", () => {
  const { access, setOwner, ownerOf } = make();
  for (const id of ["constructor", "__proto__"]) {
    assert.equal(access.knock(1, id, true), "open", `${id}: knocking at an open building is refused as already open`);
    assert.equal(access.claim(0, id, 0), null, `${id}: claiming an open building succeeds`);
    setOwner(id, 0);
    assert.equal(ownerOf(id), 0, `${id}: ownerOf now answers the claimer, not the prototype's property`);
    assert.equal(access.claim(1, id, 1), "owner", `${id}: the other player cannot take it`);
  }
});

test("a non-string id is refused as invalid instead of reaching the store", () => {
  const { access } = make();
  const bad = 123 as unknown as string;
  assert.equal(access.validBuildingId(bad), false);
  assert.equal(access.claim(0, bad, 0), "invalid");
  assert.equal(access.knock(0, bad, true), "invalid");
  assert.equal(access.open(0, bad), "invalid");
});

test("open refuses a stale knock on its own, even when expire() never ran", () => {
  const { access, setOwner, clock } = make();
  setOwner("house1", 0);
  access.knock(1, "house1", true);
  clock.tick(KNOCK_TTL_MS);
  assert.equal(access.open(0, "house1"), "noknock");
});
