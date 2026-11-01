export const families = [
  "fruits",
  "légumes",
  "pommes de terre",
  "oignons",
  "boucherie",
  "crèmerie",
  "surgelé",
  "poissonnerie",
  "épicerie",
  "boissons",
  "produits en promotion",
  "produits de saison",
  "déstockage",
];
export const saleTypes = ["colis", "sac", "kilo", "pièce", "plateau", "pack"];
export function parisParts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
}
export function validSlot(value, now = Date.now()) {
  const d = new Date(value);
  if (
    !Number.isFinite(+d) ||
    +d < +now + 7200000 ||
    +d > +now + 7 * 86400000 ||
    d.getUTCSeconds() ||
    d.getUTCMilliseconds()
  )
    return false;
  const p = parisParts(d),
    m = Number(p.hour) * 60 + Number(p.minute);
  return m >= 480 && m <= 1200 && m % 30 === 0;
}
export function slots(now = Date.now()) {
  const start = Math.ceil((+now + 7200000) / 1800000) * 1800000;
  const out = [];
  for (let t = start; t <= +now + 7 * 86400000; t += 1800000)
    if (validSlot(new Date(t).toISOString(), now))
      out.push(new Date(t).toISOString());
  return out;
}
export function margin(p) {
  const revenue = p.salePrice / (1 + p.vat / 100);
  return revenue ? ((revenue - p.purchasePrice) / revenue) * 100 : null;
}
export function product(
  input,
  categories = families.map((name) => ({ name })),
) {
  const p = {};
  for (const k of [
    "name",
    "family",
    "category",
    "brand",
    "origin",
    "quantity",
  ]) {
    if (typeof input[k] !== "string" || input[k].length > 160)
      throw Error("Champ produit invalide : " + k);
    p[k] = input[k].trim();
  }
  if (
    !p.name ||
    !categories.some((c) => c.name === p.family) ||
    !saleTypes.includes(input.saleType)
  )
    throw Error("Nom, famille ou type de vente invalide");
  p.saleType = input.saleType;
  for (const k of ["purchasePrice", "salePrice", "stock", "vat"]) {
    if (
      typeof input[k] !== "number" ||
      !Number.isFinite(input[k]) ||
      input[k] < 0 ||
      input[k] > 1000000
    )
      throw Error("Nombre invalide : " + k);
    p[k] = input[k];
  }
  if (!Number.isInteger(p.stock) || p.vat > 100 || p.salePrice <= 0)
    throw Error("Stock entier, TVA ou prix de vente invalide");
  p.photo = input.photo || "";
  if (
    typeof p.photo !== "string" ||
    (p.photo && !/^\/api\/photo\/[0-9a-f-]{36}$/.test(p.photo))
  )
    throw Error("Photo invalide");
  return p;
}
export function publicProduct(p) {
  const { purchasePrice, vat, ...safe } = p;
  return safe;
}
export function makeOrder(input, products, now = Date.now()) {
  if (!validSlot(input.pickup, now))
    throw Error(
      "Choisissez un retrait entre 8h et 20h, au moins 2 heures après la commande et dans les 7 jours.",
    );
  const customer = {};
  for (const k of ["name", "phone", "email"]) {
    if (typeof input[k] !== "string" || input[k].trim().length > 160)
      throw Error("Coordonnées invalides");
    customer[k] = input[k].trim();
  }
  if (
    !customer.name ||
    !/^\+?[\d ().-]{8,24}$/.test(customer.phone) ||
    !/^\S+@\S+\.\S+$/.test(customer.email)
  )
    throw Error("Nom, téléphone et email requis");
  if (
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > 100
  )
    throw Error("Panier invalide");
  const seen = new Set();
  const items = input.items.map((i) => {
    const p = products.find((p) => p.id === i.id);
    if (
      !p ||
      seen.has(i.id) ||
      !Number.isInteger(i.count) ||
      i.count < 1 ||
      i.count > p.stock
    )
      throw Error("Stock insuffisant ou panier invalide");
    seen.add(i.id);
    return {
      id: p.id,
      name: p.name,
      count: i.count,
      price: p.salePrice,
      saleType: p.saleType,
      quantity: p.quantity,
    };
  });
  return {
    ...customer,
    pickup: input.pickup,
    items,
    total:
      Math.round(items.reduce((s, i) => s + i.price * i.count, 0) * 100) / 100,
    status: "à préparer",
  };
}

// Seed legacy catalogues once; an existing (even empty) list is authoritative.
export function catalogCategories(state) {
  if (!Array.isArray(state.categories)) {
    state.categories = [
      ...new Set([
        ...families,
        ...state.products.map((p) => p.family).filter(Boolean),
      ]),
    ].map((name, index) => ({ id: "legacy-" + index, name }));
  }
  return state.categories;
}
export function categoryName(value, categories, except) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 160)
    throw Error("Nom de catégorie invalide");
  const name = value.trim();
  if (
    categories.some(
      (c) =>
        c.id !== except &&
        c.name.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"),
    )
  )
    throw Error("Nom de catégorie déjà utilisé, nom unique requis");
  return name;
}
