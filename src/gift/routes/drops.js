import express from "express";
import { collection } from "../store.js";
import { ok, notFound, wrap } from "../http.js";

const router = express.Router();
const drops = collection("drops");

router.get("/", wrap(async (req, res) => {
  const status = req.query.status;
  let list = await drops.list();
  if (status) list = list.filter((d) => d.status === status);
  list.sort((a, b) => b.opensAt - a.opensAt);
  ok(res, { drops: list, total: list.length });
}));

router.get("/:slug", wrap(async (req, res) => {
  const drop = await drops.get(req.params.slug);
  if (!drop) return notFound(res, "drop not found");
  ok(res, { drop });
}));

export default router;
