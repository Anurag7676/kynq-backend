// Generic Mongo-backed key/value collection — mirrors the frontend's
// lib/server/json-store `collection<T>(name)` API so route handlers port 1:1.
// Documents are stored as { _key, ...value } in a Mongo collection.

import mongoose from "mongoose";
import crypto from "crypto";

function coll(name) {
  return mongoose.connection.collection(name);
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
