import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validSlot,
  slots,
  product,
  margin,
  makeOrder,
  publicProduct,
} from "../lib/domain.js";
const p = {
  name: "Pommes",
  family: "fruits",
  category: "Gala",
  brand: "",
  origin: "France",
  purchasePrice: 2,
  salePrice: 3.5,
  vat: 5.5,
  stock: 5,
  saleType: "kilo",
  quantity: "1 kg",
  photo: "",
};
test("validation des produits, des nombres et des photos", () => {
  assert.equal(product(p).name, "Pommes");
  for (const change of [
    { stock: 1.5 },
    { salePrice: 0 },
    { family: "inconnue" },
    { saleType: "litre" },
    { purchasePrice: -1 },
    { photo: "https://example.com/faux.jpg" },
    { name: " " },
  ])
    assert.throws(() => product({ ...p, ...change }));
  assert.ok(!("purchasePrice" in publicProduct(p)));
  assert.ok(!("vat" in publicProduct(p)));
});
test("marge HT calculée avec TVA, alerte sans blocage", () => {
  assert.ok(Math.abs(margin(p) - 39.714) < 0.01);
  const low = { ...p, purchasePrice: 3 };
  assert.ok(margin(low) < 30);
  assert.doesNotThrow(() => product(low));
});
test("créneaux Paris : délai 2 h, bornes 8h–20h et pas 30 min", () => {
  const now = Date.parse("2026-11-01T05:00:00Z");
  assert.ok(validSlot("2026-11-01T07:00:00Z", now));
  assert.ok(!validSlot("2026-11-01T06:30:00Z", now));
  assert.ok(validSlot("2026-11-01T19:00:00Z", now));
  assert.ok(!validSlot("2026-11-01T19:30:00Z", now));
  assert.ok(!validSlot("2026-11-01T08:15:00Z", now));
  assert.ok(!validSlot("2026-11-01T08:00:01Z", now));
  assert.ok(!validSlot("nope", now));
  assert.ok(!validSlot("2026-11-10T09:00:00Z", now));
});
test("créneaux été, hiver et changements heure", () => {
  for (const now of [
    "2026-03-28T23:00:00Z",
    "2026-10-24T23:00:00Z",
    "2026-07-01T04:01:00Z",
  ]) {
    const list = slots(Date.parse(now));
    assert.ok(list.length > 100);
    assert.ok(list.every((s) => validSlot(s, Date.parse(now))));
  }
  assert.ok(
    validSlot("2026-07-01T06:00:00Z", Date.parse("2026-07-01T04:00:00Z")),
  );
  assert.ok(
    !validSlot("2026-07-01T18:30:00Z", Date.parse("2026-07-01T04:00:00Z")),
  );
});
test("commande : prix serveur et contrôle stock, quantités, doublons", () => {
  const now = Date.parse("2026-11-01T05:00:00Z"),
    input = {
      name: "Client",
      phone: "0600000000",
      email: "client@example.com",
      pickup: "2026-11-01T07:00:00Z",
      items: [{ id: "a", count: 2, price: 0.01 }],
    };
  const order = makeOrder(input, [{ ...p, id: "a" }], now);
  assert.equal(order.total, 7);
  for (const items of [
    [{ id: "a", count: 6 }],
    [{ id: "a", count: 1.5 }],
    [{ id: "a", count: -1 }],
    [
      { id: "a", count: 1 },
      { id: "a", count: 1 },
    ],
    [],
  ])
    assert.throws(() =>
      makeOrder({ ...input, items }, [{ ...p, id: "a" }], now),
    );
});
