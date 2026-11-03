// Generic Mongo-backed key/value collection — mirrors the frontend's
// lib/server/json-store `collection<T>(name)` API so route handlers port 1:1.
// Documents are stored as { _key, ...value } in a Mongo collection.

import mongoose from "mongoose";
import crypto from "crypto";

// Every lookup is by `_key`, so each collection needs that index. Atlas used to add it on
// its own (the "_key_1_autocreated" name); self-hosted Mongo doesn't, and without it every
// get/set is a full collection scan. Created once per collection per process, in the background.
const keyIndexed = new Set();
function coll(name) {
  const c = mongoose.connection.collection(name);
  if (!keyIndexed.has(name) && mongoose.connection.readyState === 1) {
    keyIndexed.add(name);
    c.createIndex({ _key: 1 }, { name: "_key_1_autocreated" }).catch((err) => {
      if (err.code === 85) return; // already indexed under another name (e.g. "_key_1"): fine
      keyIndexed.delete(name);
      console.error(`[store] _key index on ${name}:`, err.message);
    });
  }
  return c;
}

function strip(doc) {
  if (!doc) return null;
  const { _id, _key, ...rest } = doc;
  return rest;
}

export function collection(name) {
  return {
    async list() {
      const docs = await coll(name).find({}).toArray();
      return docs.map(strip);
    },
    async get(key) {
      const doc = await coll(name).findOne({ _key: key });
      return strip(doc);
    },
    async set(key, value) {
      await coll(name).updateOne(
        { _key: key },
        { $set: { ...value, _key: key } },
        { upsert: true }
      );
      return value;
    },
    async delete(key) {
      const r = await coll(name).deleteOne({ _key: key });
      return r.deletedCount > 0;
    },
    async find(predicate) {
      const docs = await coll(name).find({}).toArray();
      return docs.map(strip).filter(predicate);
    },
    // A real, indexed query — for looking a document up by a field OTHER than `_key`
    // (e.g. `id`) without pulling the whole collection into memory to filter in JS.
    // The field being queried needs its own index (see ensureConsoleIndexes-style
    // setup) or this degrades to the same full scan `find()` above does.
    async findOne(query) {
      const doc = await coll(name).findOne(query);
      return strip(doc);
    },
    async count() {
      return coll(name).countDocuments();
    },
  };
}

export function makeId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}

export function makeToken() {
  return crypto.randomBytes(24).toString("base64url");
}
