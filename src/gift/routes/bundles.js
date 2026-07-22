import express from "express";
import { collection } from "../store.js";
import { ok, notFound, wrap } from "../http.js";

const router = express.Router();
const bundles = collection("bundles");

router.get("/", wrap(async (_req, res) => {
  const list = await bundles.list();
  ok(res, { bundles: list, total: list.length });
}));

router.get("/:slug", wrap(async (req, res) => {
  const bundle = await bundles.get(req.params.slug);
  if (!bundle) return notFound(res, "bundle not found");
  ok(res, { bundle });
}));

export default router;
