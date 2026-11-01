import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { localStoreFactory } from "../scripts/local-store.mjs";
import { createHandler } from "../netlify/functions/api.mjs";
import { slots } from "../lib/domain.js";
let server, dir, factory;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "herblay-api-"));
  server = new BlobsServer({ directory: dir });
  const { port } = await server.start();
  factory = localStoreFactory(port, "test");
});
after(async () => {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
});
const data = {
  name: "Tomates",
  family: "légumes",
  category: "",
  brand: "",
  origin: "France",
  purchasePrice: 2,
  salePrice: 4,
  stock: 3,
  vat: 5.5,
  saleType: "kilo",
  quantity: "1 kg",
  photo: "",
};
test("API avec vrai SDK et émulateur Blobs : auth, CRUD, concurrence, commandes et persistance", async () => {
  let handler = createHandler(factory, {
      HERBLAY_ADMIN_CODE: "test-long-code",
    }),
    cookie = "";
  const call = async (path, method = "GET", body, headers = {}) => {
    const res = await handler(
      new Request("https://marche.test/api/" + path, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      { ip: "127.0.0.1" },
    );
    return { status: res.status, data: await res.json(), headers: res.headers };
  };
  assert.equal((await call("products", "POST", data)).status, 401);
  assert.equal((await call("session", "POST", { code: "faux" })).status, 401);
  let r = await call("session", "POST", { code: "test-long-code" });
  assert.equal(r.status, 200);
  assert.match(
    r.headers.get("set-cookie"),
    /HttpOnly; Secure; SameSite=Strict/,
  );
  cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("session")).data.authenticated, true);
  assert.equal(
    (await call("products", "POST", data, { origin: "https://evil.test" }))
      .status,
    403,
  );
  r = await call("products", "POST", data);
  assert.equal(r.status, 201);
  const id = r.data.id;
  let catalog = (await call("products")).data;
  assert.equal(catalog.products[0].purchasePrice, 2);
  const privateCookie = cookie;
  cookie = "";
  r = await call("products");
  assert.ok(!("purchasePrice" in r.data.products[0]));
  assert.equal((await call("orders")).status, 401);
  cookie = privateCookie;
  r = await call(
    "products/" + id,
    "PUT",
    { ...data, salePrice: 5 },
    { "If-Match": catalog.revision },
  );
  assert.equal(r.status, 200);
  assert.equal(
    (
      await call("products/" + id, "DELETE", undefined, {
        "If-Match": catalog.revision,
      })
    ).status,
    409,
  );
  const bad = await call("orders", "POST", {
    name: "Client",
    phone: "0600000000",
    email: "test@example.com",
    pickup: new Date().toISOString(),
    items: [{ id, count: 1 }],
  });
  assert.equal(bad.status, 400);
  cookie = "";
  r = await call("orders", "POST", {
    name: "Client",
    phone: "0600000000",
    email: "test@example.com",
    pickup: slots()[0],
    items: [{ id, count: 2, price: 0.01 }],
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.total, 10);
  const orderId = r.data.id;
  assert.equal((await call("products")).data.products[0].stock, 1);
  assert.equal(
    (
      await call("orders", "POST", {
        name: "Client",
        phone: "0600000000",
        email: "test@example.com",
        pickup: slots()[0],
        items: [{ id, count: 2 }],
      })
    ).status,
    400,
  );
  handler = createHandler(factory, { HERBLAY_ADMIN_CODE: "test-long-code" });
  assert.equal((await call("products")).data.products.length, 1);
  cookie = privateCookie;
  let orders = (await call("orders")).data;
  assert.equal(orders.orders[0].id, orderId);
  assert.equal(
    (
      await call(
        "orders/" + orderId,
        "PUT",
        { status: "prête" },
        { "If-Match": orders.revision },
      )
    ).status,
    200,
  );
  const invalidPhoto = await handler(
    new Request("https://marche.test/api/photo", {
      method: "POST",
      headers: { cookie },
      body: "invalid",
    }),
  );
  assert.equal(invalidPhoto.status, 400);
  catalog = (await call("products")).data;
  assert.equal(
    (
      await call("products/" + id, "DELETE", undefined, {
        "If-Match": catalog.revision,
      })
    ).status,
    200,
  );
  assert.equal((await call("products")).data.products.length, 0);
  assert.equal((await call("orders")).data.orders[0].items[0].name, "Tomates");
  r = await call("session", "DELETE");
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  cookie = "herblay_session=9999999999999.bad";
  assert.equal((await call("session")).data.authenticated, false);
});
test("code absent : authentification fermée", async () => {
  const h = createHandler(factory, {});
  assert.equal(
    (
      await h(
        new Request("https://marche.test/api/session", {
          method: "POST",
          body: "{}",
        }),
      )
    ).status,
    503,
  );
});
test("limitation des tentatives de connexion", async () => {
  const h = createHandler(factory, { HERBLAY_ADMIN_CODE: "code" });
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await h(
          new Request("https://marche.test/api/session", {
            method: "POST",
            body: '{"code":"no"}',
          }),
          { ip: "rate-test" },
        )
      ).status,
      401,
    );
  assert.equal(
    (
      await h(
        new Request("https://marche.test/api/session", {
          method: "POST",
          body: '{"code":"code"}',
        }),
        { ip: "rate-test" },
      )
    ).status,
    429,
  );
});
test("écriture concurrente : une commande gagnante, aucun stock négatif", async () => {
  let state = { products: [{ ...data, id: "test-id", stock: 1 }], orders: [] },
    etag = "v1";
  const memory = {
    async getWithMetadata(key) {
      if (key !== "state") return null;
      return { data: structuredClone(state), etag };
    },
    async setJSON(key, next, condition) {
      if (condition.onlyIfMatch !== etag) return { modified: false };
      state = structuredClone(next);
      etag = "v2";
      return { modified: true, etag };
    },
  };
  const h = createHandler(() => memory, {});
  const order = {
    name: "Client",
    phone: "0600000000",
    email: "test@example.com",
    pickup: slots()[0],
    items: [{ id: "test-id", count: 1 }],
  };
  const send = () =>
    h(
      new Request("https://marche.test/api/orders", {
        method: "POST",
        body: JSON.stringify(order),
      }),
    );
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(state.products[0].stock, 0);
  assert.equal(state.orders.length, 1);
});
