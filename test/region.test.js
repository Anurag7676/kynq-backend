// Same region first, then worldwide (matchmaker.js): different regions only match once both
// people have waited; same region is preferred when both are on offer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findMatchFor, regionOf } from "../src/kynqExtra/matchmaker.js";

const person = (scopedId, country, waitedMs) => ({ scopedId, region: regionOf(country), joinedAt: Date.now() - waitedMs, topics: [], locationScope: "worldwide", location: {}, gender: null, genderPref: null });
const none = new Set();

test("regions: grouping, waiting, preference", () => {
  assert.equal(regionOf("PK"), "south-asia");
  assert.equal(regionOf("IN"), "south-asia");
  assert.equal(regionOf("BR"), "latin-america");
  assert.equal(regionOf("ZZ"), "other");
  assert.equal(regionOf("usa"), null, "anything but a 2-letter code is ignored");

  const us = person("us", "US", 2000), inFresh = person("in", "IN", 2000);
  assert.equal(findMatchFor(us, [inFresh], none, none), null, "different regions, nobody has waited: no match yet");

  const usWaited = person("us", "US", 20_000), inWaited = person("in", "IN", 20_000);
  assert.equal(findMatchFor(usWaited, [inWaited], none, none)?.scopedId, "in", "both waited: worldwide");

  const ca = person("ca", "CA", 20_000);
  assert.equal(findMatchFor(usWaited, [inWaited, ca], none, none)?.scopedId, "ca", "same region preferred");

  const pk = person("pk", "PK", 1000);
  assert.equal(findMatchFor(person("bd", "BD", 1000), [pk], none, none)?.scopedId, "pk", "same region matches at once");
  assert.equal(findMatchFor({ ...us, region: null }, [inFresh], none, none)?.scopedId, "in", "no region = anyone");
});
