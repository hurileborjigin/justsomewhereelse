import assert from "node:assert/strict";
import { test } from "node:test";
import { KNOCK_TTL_MS } from "../shared/protocol.ts";
import { Ownership, buildingPhrase, doorChoice, letIn, signText } from "./ownership.ts";

const NAMES: [string, string] = ["gloria", "khurlee"];

function mirror(now = () => 1000) {
  const o = new Ownership(now);
  o.reset({ buildings: [{ id: "hive", owner: 0 }, { id: "hall", owner: 1 }], doors: [], knocks: [] });
  return o;
}

test("the fixed houses belong to their owners even before a welcome", () => {
  const o = new Ownership();
  assert.equal(o.ownerOf("hive"), 0);
  assert.equal(o.ownerOf("hall"), 1);
  assert.equal(o.ownerOf("b3"), null);
});

test("an open building lets both players in", () => {
  const o = mirror();
  assert.equal(doorChoice(0, "b3", o), "enter");
  assert.equal(doorChoice(1, "b3", o), "enter");
});

test("the owner enters, the partner knocks", () => {
  const o = mirror();
  o.setOwner("b3", 0);
  assert.equal(doorChoice(0, "b3", o), "enter");
  assert.equal(doorChoice(1, "b3", o), "knock");
  assert.equal(doorChoice(0, "hall", o), "knock");
  assert.equal(doorChoice(1, "hall", o), "enter");
});

test("a grant lets the guest enter until it ends", () => {
  const o = mirror();
  o.door("hive", 1, true);
  assert.equal(doorChoice(1, "hive", o), "enter");
  o.door("hive", 1, false);
  assert.equal(doorChoice(1, "hive", o), "knock");
});

test("a grant for the other building does not open this one", () => {
  const o = mirror();
  o.setOwner("b3", 0);
  o.door("hive", 1, true);
  assert.equal(doorChoice(1, "b3", o), "knock");
});

test("the welcome carries owners, grants and knocks", () => {
  const o = new Ownership(() => 1000);
  o.reset({ buildings: [{ id: "b3", owner: 1 }], doors: [{ id: "b3", guest: 0 }], knocks: [] });
  assert.equal(o.ownerOf("b3"), 1);
  assert.equal(doorChoice(0, "b3", o), "enter");
  o.reset({ buildings: [], doors: [], knocks: [{ id: "hive", from: 1 }] });
  assert.equal(o.ownerOf("b3"), null, "a later welcome replaces everything");
  assert.equal(letIn(0, "hive", o), 1);
});

test("letIn names the pending knocker to the owner only", () => {
  const o = mirror();
  assert.equal(letIn(0, "hive", o), null);
  o.knocked("hive", 1);
  assert.equal(letIn(0, "hive", o), 1);
  assert.equal(letIn(1, "hive", o), null, "the knocker never sees a let-in");
  assert.equal(letIn(0, "b3", o), null, "only at the building knocked at");
});

test("opening the door answers the knock", () => {
  const o = mirror();
  o.knocked("hive", 1);
  o.door("hive", 1, true);
  assert.equal(letIn(0, "hive", o), null);
});

test("a knock expires after ten minutes, and knocking again renews it", () => {
  let t = 1000;
  const o = mirror(() => t);
  o.knocked("hive", 1);
  t += KNOCK_TTL_MS - 1;
  assert.equal(letIn(0, "hive", o), 1);
  o.knocked("hive", 1);
  t += KNOCK_TTL_MS - 1;
  assert.equal(letIn(0, "hive", o), 1);
  t += 1;
  assert.equal(letIn(0, "hive", o), null);
});

test("opening a building to both drops its knock", () => {
  const o = mirror();
  o.setOwner("b3", 0);
  o.knocked("b3", 1);
  o.setOwner("b3", null);
  assert.equal(letIn(0, "b3", o), null);
  o.setOwner("b3", 0);
  assert.equal(letIn(0, "b3", o), null, "claiming again does not bring the old knock back");
});

test("a knock the player sent is remembered until answered, refused or stale", () => {
  let t = 1000;
  const o = mirror(() => t);
  o.knockSent("hive");
  assert.equal(o.waiting(1, "hive"), true);
  o.knockDenied("hive");
  assert.equal(o.waiting(1, "hive"), false);
  o.knockSent("hive");
  t += KNOCK_TTL_MS;
  assert.equal(o.waiting(1, "hive"), false);
  o.knockSent("hive");
  o.door("hive", 1, true);
  assert.equal(o.waiting(1, "hive"), true, "a guest holding a grant is still waiting to go in");
  o.door("hive", 1, false);
  assert.equal(o.waiting(1, "hive"), false);
});

test("the snapshot lists owners, grants and knocks", () => {
  const o = mirror();
  o.setOwner("b3", 1);
  o.door("b3", 0, true);
  o.knocked("hive", 1);
  assert.deepEqual(o.snapshot(), {
    owners: { hive: 0, hall: 1, b3: 1 },
    grants: [{ id: "b3", guest: 0 }],
    knocks: [{ id: "hive", from: 1 }],
  });
});

test("the building phrase names the owner from the player's view", () => {
  assert.equal(buildingPhrase("crooked house", null, 0, NAMES), "the crooked house");
  assert.equal(buildingPhrase("crooked house", 0, 0, NAMES), "your crooked house");
  assert.equal(buildingPhrase("crooked house", 0, 1, NAMES), "gloria's crooked house");
  assert.equal(buildingPhrase("Hive", 0, 1, NAMES), "gloria's Hive");
  assert.equal(buildingPhrase("Copper Hall", 1, 0, NAMES), "khurlee's Copper Hall");
});

test("the sign reads the spec's sentences", () => {
  assert.deepEqual(signText("b3", "crooked house", null, 0, NAMES), {
    text: "The crooked house is open to both.",
    action: "claim",
  });
  assert.deepEqual(signText("b3", "crooked house", 1, 1, NAMES), {
    text: "The crooked house is yours.",
    action: "open",
  });
  assert.deepEqual(signText("b3", "crooked house", 0, 1, NAMES), {
    text: "The crooked house is gloria's. Knock and she can let you in.",
    action: null,
  });
  assert.deepEqual(signText("b3", "crooked house", 1, 0, NAMES), {
    text: "The crooked house is khurlee's. Knock and he can let you in.",
    action: null,
  });
  assert.deepEqual(signText("hive", "Hive", 0, 1, NAMES), { text: "This is gloria's Hive.", action: null });
  assert.deepEqual(signText("hall", "Copper Hall", 1, 1, NAMES), { text: "This is your Copper Hall.", action: null });
  assert.deepEqual(signText("opera", "opera house", null, 1, NAMES).text, "The opera house is open to both.");
});
