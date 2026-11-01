import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createHandler } from "../netlify/functions/api.mjs";
import { families } from "../lib/domain.js";
test("migration, catégories partagées, renommage atomique, ordre, suppression et conservation", async () => {
  const original = {
    id: "p1",
    name: "Pomme",
    family: "fruits",
    category: "Ancien détail",
    stock: 8,
    salePrice: 3,
    purchasePrice: 1,
    vat: 5.5,
    photo: "/api/photo/existant",
  };
  let state = {
      products: [original],
      orders: [{ id: "commande", items: [{ name: "Pomme" }] }],
    },
    version = 1;
  const factory = () => ({
    async getWithMetadata() {
      return { data: structuredClone(state), etag: String(version) };
    },
    async setJSON(key, next, options) {
      if (options.onlyIfMatch !== String(version)) return { modified: false };
      state = structuredClone(next);
      version++;
      return { modified: true };
    },
  });
  const expiry = String(Date.now() + 3600000);
  const cookie = `herblay_session=${expiry}.${createHmac("sha256", "secret").update(expiry).digest("base64url")}`;
  let handler = createHandler(factory, { HERBLAY_ADMIN_CODE: "secret" });
  const call = async (
    path,
    method = "GET",
    body,
    auth = true,
    match = String(version),
  ) => {
    const response = await handler(
      new Request("https://test/api/" + path, {
        method,
        headers: { ...(auth ? { cookie } : {}), "If-Match": match },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    return { status: response.status, data: await response.json() };
  };
  let c = (await call("categories")).data.categories;
  assert.deepEqual(
    c.map((c) => c.name),
    families,
  );
  assert.equal(c[0].count, 1);
  assert.equal(
    (await call("categories", "POST", { name: "Nouveau" }, false)).status,
    401,
  );
  let created = await call("categories", "POST", { name: "Nouveau" });
  assert.equal(created.status, 201);
  assert.deepEqual(state.products, [original]);
  assert.equal(
    (await call("categories", "POST", { name: " nouveau " })).status,
    400,
  );
  const stale = String(version);
  assert.equal(
    (await call("categories/" + c[0].id, "PUT", { name: "Vergers" })).status,
    200,
  );
  assert.deepEqual(state.products, [{ ...original, family: "Vergers" }]);
  assert.equal(
    (await call("categories/" + c[0].id, "DELETE", null, true, stale)).status,
    409,
  );
  assert.equal((await call("categories/" + c[0].id, "DELETE")).status, 409);
  assert.equal(state.products.length, 1);
  const ids = state.categories.map((c) => c.id).reverse();
  assert.equal((await call("categories/order", "PUT", { ids })).status, 200);
  assert.deepEqual(
    state.categories.map((c) => c.id),
    ids,
  );
  assert.equal(
    (await call("categories/order", "PUT", { ids: [ids[0]] })).status,
    400,
  );
  handler = createHandler(factory, { HERBLAY_ADMIN_CODE: "secret" });
  const pub = (await call("products", "GET", null, false)).data;
  assert.equal(pub.categories.find((c) => c.name === "Vergers").count, 1);
  assert.ok(!("purchasePrice" in pub.products[0]));
  assert.equal(
    (await call("categories/" + created.data.id, "DELETE")).status,
    200,
  );
  assert.deepEqual(state.products, [{ ...original, family: "Vergers" }]);
  assert.deepEqual(state.orders, [
    { id: "commande", items: [{ name: "Pomme" }] },
  ]);
  assert.ok(
    !(await call("categories")).data.categories.some(
      (c) => c.id === created.data.id,
    ),
  );
});
