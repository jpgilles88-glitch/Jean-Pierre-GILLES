import { saleTypes, margin, slots } from "./domain.js";
const $ = (s) => document.querySelector(s),
  money = (n) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    }).format(n),
  date = (s) =>
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(s));
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let categories = [],
  products = [],
  revision = null,
  orderRevision = null,
  editorRevision = null,
  authenticated = false,
  family = "",
  photo = "",
  newPhoto = null,
  photoBusy = false,
  photoVersion = 0,
  savingProduct = false,
  refreshing = null,
  catalogGeneration = 0,
  changingCategory = false,
  noticeTimer;
let cart = {};
try {
  cart = JSON.parse(localStorage.getItem("herblay-cart") || "{}");
  if (!cart || Array.isArray(cart) || typeof cart !== "object") cart = {};
} catch {
  cart = {};
}
function notice(message, error = false) {
  clearTimeout(noticeTimer);
  $("#notice").textContent = message;
  $("#notice").classList.toggle("error", error);
  $("#notice").hidden = false;
  noticeTimer = setTimeout(
    () => ($("#notice").hidden = true),
    error ? 11000 : 5000,
  );
}
async function api(path, options = {}) {
  const response = await fetch("/api/" + path, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.body && !(options.body instanceof Blob)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(
      "Réponse du serveur illisible. Vérifiez le déploiement Netlify.",
    );
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("customer/")) {
      authenticated = false;
      renderAuth();
    }
    throw Error(data.error || "Service indisponible");
  }
  if (
    options.method &&
    ["products", "categories", "orders"].includes(path.split("/")[0])
  ) {
    // Invalidate reads started before this write, including background polling.
    catalogGeneration++;
    revision = data.revision;
  }
  return data;
}
function applyCatalog(data) {
  products = data.products;
  revision = data.revision;
  categories = data.categories;
  renderCategories();
  renderProducts();
}
function saveCart() {
  try {
    localStorage.setItem("herblay-cart", JSON.stringify(cart));
  } catch {}
  $("#basket-count").textContent = Object.values(cart)
    .filter(Number.isInteger)
    .reduce((s, n) => s + Math.max(0, n), 0);
}
function card(p, admin = false) {
  const m = admin ? margin(p) : null;
  return `<article class="product-card">${p.photo ? `<img class="product-photo" src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy">` : '<div class="no-photo">Photo non renseignée</div>'}<div class="product-info"><span class="tag">${esc(p.family)}</span><h3>${esc(p.name)}</h3><p>${[p.brand, p.category, p.origin].filter(Boolean).map(esc).join(" · ")}</p><p>${esc(p.quantity)}${p.quantity ? " · " : ""}${esc(p.saleType)} · ${p.stock > 0 ? p.stock + " en stock" : "Épuisé"}</p>${admin ? `<p>Achat HT : ${money(p.purchasePrice)} · TVA ${p.vat} %</p><p class="margin ${m !== null && m < 30 ? "warning" : ""}">Marge : ${m === null ? "non calculable" : m.toFixed(1) + " %"}${m !== null && m < 30 ? " · sous 30 %" : ""}</p>` : ""}<div class="price-row"><span class="price">${money(p.salePrice)}<small>le ${esc(p.saleType)} · TTC</small></span>${admin ? "" : `<button class="green" data-add="${p.id}" ${p.stock < 1 ? "disabled" : ""}>${p.stock < 1 ? "Épuisé" : "+ Ajouter"}</button>`}</div></div>${admin ? `<div class="admin-actions"><button data-edit="${p.id}">Modifier</button><button class="danger" data-delete="${p.id}">Supprimer</button></div>` : ""}</article>`;
}
function renderProducts() {
  const q = $("#search").value.trim().toLocaleLowerCase("fr");
  const visible = products.filter(
    (p) =>
      (!family || p.family === family) &&
      [p.name, p.brand, p.category, p.origin]
        .join(" ")
        .toLocaleLowerCase("fr")
        .includes(q),
  );
  $("#product-count").textContent =
    visible.length + " produit" + (visible.length > 1 ? "s" : "");
  $("#products").innerHTML =
    visible.map((p) => card(p)).join("") ||
    '<div class="empty"><h3>' +
      (products.length
        ? "Aucun produit trouvé"
        : "Le marché prépare ses rayons") +
      "</h3><p>" +
      (products.length
        ? "Essayez une autre recherche ou une autre famille."
        : "Les produits seront visibles ici dès leur ajout par le marché.") +
      "</p></div>";
  if (authenticated)
    $("#admin-products").innerHTML =
      products.map((p) => card(p, true)).join("") ||
      '<p class="empty">Ajoutez votre premier produit pour ouvrir les rayons.</p>';
}
async function refresh(quiet = false) {
  if (refreshing) {
    await refreshing;
    return;
  }
  if (changingCategory) return;
  const generation = catalogGeneration;
  if (!quiet) $("#admin-sync").textContent = "Actualisation…";
  refreshing = (async () => {
    try {
      const data = await api("products");
      if (generation !== catalogGeneration) return;
      applyCatalog(data);
      const time = new Intl.DateTimeFormat("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date());
      $("#sync-state").textContent = "Synchronisé à " + time;
      $("#admin-sync").textContent = "Synchronisé à " + time;
      if (authenticated) await loadOrders();
      if (!quiet && location.hash === "#gestion")
        notice("Catalogue actualisé");
    } catch (e) {
      $("#sync-state").textContent = "Hors connexion · données non actualisées";
      $("#admin-sync").textContent = "Échec de synchronisation";
      if (!quiet) notice(e.message, true);
    }
  })();
  try {
    await refreshing;
  } finally {
    refreshing = null;
  }
}

async function catalogWrite(path, options, retry = false) {
  try {
    return await api(path, options);
  } catch (e) {
    if (
      retry &&
      /catalogue a changé|autre modification/i.test(e.message || "")
    ) {
      const latest = await api("products");
      applyCatalog(latest);
      const headers = {
        ...(options.headers || {}),
        "If-Match": revision || "",
      };
      return catalogWrite(path, { ...options, headers }, false);
    }
    throw e;
  }
}
function renderAuth() {
  $("#login").hidden = authenticated;
  $("#admin-content").hidden = !authenticated;
  $("#logout").hidden = !authenticated;
  if (!authenticated) {
    $("#admin-products").replaceChildren();
    $("#orders").replaceChildren();
    products = products.map(({ purchasePrice, vat, ...p }) => p);
    if ($("#product-dialog").open) $("#product-dialog").close();
  }
}
async function session() {
  try {
    const data = await api("session");
    authenticated = data.authenticated;
    renderAuth();
    if (!data.configured && location.hash === "#gestion")
      notice(
        "Ajoutez HERBLAY_ADMIN_CODE dans les variables Netlify pour activer la gestion.",
        true,
      );
  } catch (e) {
    notice(e.message, true);
  }
}
function route() {
  const admin = location.hash === "#gestion";
  $("#shop").hidden = admin;
  $("#admin").hidden = !admin;
  if (admin) session().then(() => refresh());
}
function renderCategories() {
  if (!categories.some((c) => c.name === family)) family = "";
  $("#filters").innerHTML = ["", ...categories.map((c) => c.name)]
    .map(
      (f) =>
        `<button data-family="${esc(f)}" class="${f === family ? "active" : ""}" aria-pressed="${f === family}">${esc(f || "Tout le marché")}</button>`,
    )
    .join("");
  const selected = $("#family-select").value;
  $("#family-select").innerHTML = categories
    .map((c) => `<option>${esc(c.name)}</option>`)
    .join("");
  if (categories.some((c) => c.name === selected))
    $("#family-select").value = selected;
  if (authenticated)
    $("#category-list").innerHTML = categories
      .map(
        (c, i) =>
          `<article class="category-row"><strong>${esc(c.name)}</strong><span>${c.count} produit(s)</span><div><button data-category-rename="${esc(c.id)}">Renommer</button> <button data-category-up="${esc(c.id)}" ${i === 0 ? "disabled" : ""}>Monter</button> <button data-category-down="${esc(c.id)}" ${i === categories.length - 1 ? "disabled" : ""}>Descendre</button> <button class="danger" data-category-delete="${esc(c.id)}">Supprimer la catégorie</button></div></article>`,
      )
      .join("");
}
async function changeCategory(path, method, body, expectedRevision = revision) {
  if (changingCategory) return;
  try {
    changingCategory = true;
    catalogGeneration++;
    setCategoryBusy(true);
    const data = await catalogWrite("categories" + path, {
      method,
      headers: { "If-Match": expectedRevision || "" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    applyCatalog(data);
    notice("Catégories enregistrées et synchronisées");
  } catch (e) {
    notice(e.message, true);
  } finally {
    changingCategory = false;
    setCategoryBusy(false);
  }
}
function setCategoryBusy(busy) {
  for (const button of document.querySelectorAll(
    "#category-list button, #category-form button, #refresh",
  ))
    button.disabled = busy;
  if (!busy) renderCategories();
}
$("#category-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  e.submitter.disabled = true;
  await changeCategory("", "POST", { name: e.target.elements.name.value });
  e.submitter.disabled = false;
});
$("#category-list").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b || changingCategory) return;
  const id =
    b.dataset.categoryRename ||
    b.dataset.categoryDelete ||
    b.dataset.categoryUp ||
    b.dataset.categoryDown;
  const c = categories.find((c) => c.id === id);
  if (!c) return;
  const expected = revision;
  if (b.dataset.categoryRename) {
    const name = prompt("Nouveau nom de la catégorie", c.name);
    if (name !== null)
      await changeCategory("/" + id, "PUT", { name }, expected);
  } else if (b.dataset.categoryDelete) {
    if (c.count)
      return notice(
        `${c.count} produit(s) associé(s). Déplacez d’abord les produits vers une autre catégorie en les modifiant.`,
        true,
      );
    if (confirm("Supprimer la catégorie « " + c.name + " » ?"))
      await changeCategory("/" + id, "DELETE", null, expected);
  } else {
    const ids = categories.map((c) => c.id),
      i = ids.indexOf(id),
      j = i + (b.dataset.categoryUp ? -1 : 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await changeCategory("/order", "PUT", { ids }, expected);
  }
});
$("#sale-select").innerHTML = saleTypes
  .map((f) => `<option>${f}</option>`)
  .join("");
$("#filters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-family]");
  if (!b) return;
  family = b.dataset.family;
  for (const x of $("#filters").children) {
    x.classList.toggle("active", x === b);
    x.setAttribute("aria-pressed", String(x === b));
  }
  renderProducts();
});
$("#search").addEventListener("input", renderProducts);
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.close) $("#" + b.dataset.close).close();
  if (b.dataset.add) {
    const p = products.find((p) => p.id === b.dataset.add);
    const count = (cart[p.id] || 0) + 1;
    if (count > p.stock)
      return notice(
        "Tout le stock disponible est déjà dans votre panier.",
        true,
      );
    cart[p.id] = count;
    saveCart();
    notice(p.name + " ajouté au panier");
  }
  if (b.dataset.edit)
    editProduct(products.find((p) => p.id === b.dataset.edit));
  if (b.dataset.delete) {
    const p = products.find((p) => p.id === b.dataset.delete);
    if (!confirm("Supprimer « " + p.name + " » du catalogue ?")) return;
    b.disabled = true;
    try {
      await catalogWrite("products/" + p.id, {
        method: "DELETE",
        headers: { "If-Match": revision || "" },
      });
      await refresh();
      notice("Produit supprimé");
    } catch (e) {
      notice(e.message, true);
      await refresh(true);
    } finally {
      b.disabled = false;
    }
  }
  if (b.dataset.remove) {
    delete cart[b.dataset.remove];
    saveCart();
    renderCart();
  }
});
document.addEventListener(
  "error",
  (e) => {
    if (e.target.matches?.(".product-photo")) {
      const div = document.createElement("div");
      div.className = "no-photo";
      div.textContent = "Photo indisponible";
      e.target.replaceWith(div);
    }
  },
  true,
);
function fillSlots() {
  const selected = $("#pickup").value;
  $("#pickup").innerHTML =
    '<option value="">Choisissez votre créneau</option>' +
    slots()
      .map((s) => `<option value="${s}">${date(s)}</option>`)
      .join("");
  if ([...$("#pickup").options].some((o) => o.value === selected))
    $("#pickup").value = selected;
}
function renderCart() {
  const entries = Object.entries(cart).filter(
    ([, count]) => Number.isInteger(count) && count > 0,
  );
  let total = 0;
  $("#cart-items").innerHTML =
    entries
      .map(([id, count]) => {
        const p = products.find((p) => p.id === id);
        if (!p)
          return `<div class="cart-line"><span>Produit retiré du catalogue</span><button data-remove="${esc(id)}">Retirer</button></div>`;
        total += p.salePrice * count;
        return `<div class="cart-line">${p.photo ? `<img class="product-photo cart-photo" src="${esc(p.photo)}" alt="${esc(p.name)}">` : '<span class="cart-photo no-photo">Photo non renseignée</span>'}<div><strong>${esc(p.name)}</strong><p>${money(p.salePrice)} / ${esc(p.saleType)} · ${esc(p.quantity)}</p>${count > p.stock ? '<p class="danger">Stock disponible : ' + p.stock + "</p>" : ""}</div><div class="cart-controls"><label>Quantité<input type="number" min="1" max="${p.stock}" step="1" data-count="${id}" value="${count}"></label><button data-remove="${id}">Retirer</button></div></div>`;
      })
      .join("") || "<p>Votre panier attend les bonnes affaires du marché.</p>";
  $("#cart-total").textContent = money(total);
  $("#checkout").hidden = !entries.length;
}
$("#cart-items").addEventListener("change", (e) => {
  if (!e.target.dataset.count) return;
  const n = Number(e.target.value),
    p = products.find((p) => p.id === e.target.dataset.count);
  if (!Number.isInteger(n) || n < 1 || n > p.stock) {
    notice("La quantité doit respecter le stock disponible.", true);
    return renderCart();
  }
  cart[p.id] = n;
  saveCart();
  renderCart();
});
$("#basket-toggle").addEventListener("click", async () => {
  await refresh(true);
  $("#confirmation").hidden = true;
  renderCart();
  fillSlots();
  $("#cart-dialog").showModal();
});
$("#checkout").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(e.target));
    payload.items = Object.entries(cart).map(([id, count]) => ({ id, count }));
    const result = await api("orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    cart = {};
    saveCart();
    $("#cart-items").replaceChildren();
    $("#checkout").hidden = true;
    $("#cart-total").textContent = money(result.total);
    $("#confirmation").hidden = false;
    $("#confirmation").innerHTML =
      `<h3>Votre commande est enregistrée !</h3><p>Référence : <strong>${esc(result.id)}</strong></p><p>Retrait : <strong>${date(result.pickup)}</strong> (heure de Paris)</p><p>Total : ${money(result.total)} · paiement au retrait.</p><p>Conservez cette référence ou faites une capture d’écran. Aucun email automatique n’est envoyé.</p>`;
    await refresh(true);
  } catch (e) {
    notice(e.message, true);
    await refresh(true);
    renderCart();
    fillSlots();
  } finally {
    button.disabled = false;
  }
});
$("#login").addEventListener("submit", async (e) => {
  e.preventDefault();
  e.submitter.disabled = true;
  try {
    await api("session", {
      method: "POST",
      body: JSON.stringify({ code: new FormData(e.target).get("code") }),
    });
    e.target.reset();
    authenticated = true;
    renderAuth();
    await refresh();
    notice("Gestion connectée");
  } catch (e) {
    notice(e.message, true);
  } finally {
    e.submitter.disabled = false;
  }
});
$("#logout").addEventListener("click", async () => {
  try {
    await api("session", { method: "DELETE" });
    authenticated = false;
    renderAuth();
    await refresh();
  } catch (e) {
    notice(e.message, true);
  }
});
$("#refresh").addEventListener("click", () => refresh());
function editProduct(p) {
  if (savingProduct) return;
  const form = $("#product-form");
  form.reset();
  // Hidden inputs retain programmatically assigned values across form.reset().
  form.elements.namedItem("id").value = "";
  photoVersion++;
  photoBusy = false;
  $("#product-form .save").disabled = false;
  photo = p?.photo || "";
  newPhoto = null;
  editorRevision = revision;
  for (const [k, v] of Object.entries(p || {}))
    if (form.elements.namedItem(k)) form.elements.namedItem(k).value = v;
  $("#editor-title").textContent = p
    ? "Modifier le produit"
    : "Ajouter un produit";
  $("#photo-preview").hidden = !photo;
  if (photo) $("#photo-preview").src = photo;
  else $("#photo-preview").removeAttribute("src");
  updateMargin();
  $("#product-dialog").showModal();
}
$("#product-dialog").addEventListener("close", () => {
  photoVersion++;
});
$("#new-product").addEventListener("click", () => editProduct());
function updateMargin() {
  const f = $("#product-form");
  const p = {
    purchasePrice: Number(f.purchasePrice.value),
    salePrice: Number(f.salePrice.value),
    vat: Number(f.vat.value),
  };
  const value = margin(p);
  $("#margin").textContent =
    value === null
      ? "Renseignez les prix pour calculer la marge."
      : `Marge : ${value.toFixed(1)} %${value < 30 ? " — Attention : inférieure à 30 % (enregistrement autorisé)." : ""}`;
  $("#margin").classList.toggle("warning", value !== null && value < 30);
}
for (const name of ["purchasePrice", "salePrice", "vat"])
  $("#product-form")
    .elements.namedItem(name)
    .addEventListener("input", updateMargin);
$("#photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (savingProduct) return;
  const version = ++photoVersion;
  photoBusy = true;
  $("#product-form .save").disabled = true;
  try {
    if (file.size > 25000000)
      throw Error("Photo trop volumineuse (25 Mo maximum avant compression).");
    const img = new Image(),
      url = URL.createObjectURL(file);
    try {
      img.src = url;
      await img.decode();
      const ratio = Math.min(
        1,
        1400 / Math.max(img.naturalWidth, img.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const converted = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82),
      );
      if (version !== photoVersion) return;
      if (!converted || converted.size > 2000000)
        throw Error("Choisissez une photo plus petite.");
      newPhoto = converted;
      $("#photo-preview").src = canvas.toDataURL("image/jpeg", 0.82);
      $("#photo-preview").hidden = false;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    if (version !== photoVersion) return;
    notice(
      "Photo non importée. " +
        e.message +
        " Sur iPhone, utilisez une photo JPEG si le format HEIC n’est pas pris en charge.",
      true,
    );
    e.target.value = "";
    newPhoto = null;
  } finally {
    if (version === photoVersion) {
      photoBusy = false;
      $("#product-form .save").disabled = false;
    }
  }
});
$("#remove-photo").addEventListener("click", () => {
  if (savingProduct) return;
  photoVersion++;
  photoBusy = false;
  $("#product-form .save").disabled = false;
  photo = "";
  newPhoto = null;
  $("#photo-input").value = "";
  $("#photo-preview").hidden = true;
});
$("#product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (photoBusy || savingProduct) return;
  savingProduct = true;
  $("#photo-input").disabled = true;
  $("#remove-photo").disabled = true;
  const button = e.submitter;
  button.disabled = true;
  try {
    const p = Object.fromEntries(new FormData(e.target));
    for (const key of ["purchasePrice", "salePrice", "stock", "vat"])
      p[key] = Number(p[key]);
    if (newPhoto) {
      const uploaded = await api("photo", {
        method: "POST",
        body: newPhoto,
        headers: { "Content-Type": "image/jpeg" },
      });
      photo = uploaded.photo;
      newPhoto = null;
    }
    p.photo = photo;
    const saved = await catalogWrite("products" + (p.id ? "/" + p.id : ""), {
      method: p.id ? "PUT" : "POST",
      headers: p.id ? { "If-Match": revision || editorRevision || "" } : {},
      body: JSON.stringify(p),
    });
    // The write response already carries the new catalogue revision. Do not let
    // a concurrent/background refresh overwrite it before the confirmation read.
    if (saved.revision) revision = saved.revision;
    catalogGeneration++;
    $("#product-dialog").close();
    await refresh(true);
    notice("Produit enregistré et synchronisé");
  } catch (e) {
    notice(e.message, true);
  } finally {
    savingProduct = false;
    $("#photo-input").disabled = false;
    $("#remove-photo").disabled = false;
    button.disabled = false;
  }
});
async function loadOrders() {
  const data = await api("orders");
  orderRevision = data.revision;
  $("#orders").innerHTML =
    data.orders
      .map(
        (o) =>
          `<article class="order"><h3>${esc(o.name)} · ${money(o.total)}</h3><p>Référence : ${esc(o.id)}<br>Retrait : ${date(o.pickup)}<br>${esc(o.phone)} · ${esc(o.email)}</p><ul>${o.items.map((i) => `<li>${i.count} × ${esc(i.name)} (${esc(i.saleType)}${i.quantity ? " · " + esc(i.quantity) : ""}) — ${money(i.price * i.count)}</li>`).join("")}</ul><label>État de la commande<select data-order="${o.id}">${["à préparer", "prête", "retirée"].map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select></label></article>`,
      )
      .join("") || '<p class="empty">Aucune commande pour le moment.</p>';
}
$("#orders").addEventListener("change", async (e) => {
  if (!e.target.dataset.order) return;
  e.target.disabled = true;
  try {
    await api("orders/" + e.target.dataset.order, {
      method: "PUT",
      headers: { "If-Match": orderRevision || "" },
      body: JSON.stringify({ status: e.target.value }),
    });
    await refresh();
    notice("État enregistré");
  } catch (e) {
    notice(e.message, true);
    await loadOrders().catch(() => {});
  }
});
window.addEventListener("hashchange", route);
window.addEventListener("online", () => refresh(true));
window.addEventListener("focus", () => {
  session().then(() => refresh(true));
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) session().then(() => refresh(true));
});
setInterval(() => {
  if (!document.hidden && !$("#product-dialog").open) refresh(true);
}, 10000);
window.addEventListener("storage", (e) => {
  if (e.key === "herblay-cart") {
    try {
      const c = JSON.parse(e.newValue || "{}");
      if (c && typeof c === "object" && !Array.isArray(c)) cart = c;
    } catch {}
    saveCart();
    if ($("#cart-dialog").open) renderCart();
  }
});
saveCart();
route();
session().then(() => refresh());


let customer = null, savedLists = [], listsRevision = null;
function renderCustomer() {
  $("#customer-form").hidden = !!customer;
  $("#customer-space").hidden = !customer;
  $("#customer-greeting").textContent = customer ? `Bonjour ${customer.name}` : "";
  $("#saved-lists").innerHTML = savedLists.map(list => `<article class="saved-list"><h4>${esc(list.name)}</h4>${list.items.map(item => {
    const p = products.find(p => p.id === item.id);
    return `<div class="saved-list-item">${p?.photo ? `<img class="cart-photo product-photo" src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy">` : '<span class="cart-photo no-photo">Sans photo</span>'}<span>${esc(p?.name || "Produit retiré du catalogue")} × ${item.count}${p ? ` · ${money(p.salePrice)} / ${esc(p.saleType)}${p.stock < item.count ? ' · Stock insuffisant' : ''}` : ''}</span></div>`;
  }).join("")}<button data-restore-list="${list.id}" class="green">Ajouter au panier</button><button data-delete-list="${list.id}">Supprimer la liste</button></article>`).join("") || '<p>Aucune liste pour le moment. Composez un panier puis enregistrez-le ici.</p>';
  $("#list-suggestions").innerHTML = products.filter(p => p.stock > 0 && !cart[p.id]).slice(0,4).map(p=>card(p)).join("") || '<p>Aucune suggestion disponible pour le moment.</p>';
}
async function loadCustomer() {
  const session = await api("customer/session");
  customer = session.user;
  savedLists = []; listsRevision = null;
  if(customer) {
    const data = await api("customer/lists");
    savedLists = data.lists; listsRevision = data.revision;
  }
  renderCustomer();
}
async function customerAction(action) {
  $("#customer-message").textContent = "Chargement…";
  try { await action(); $("#customer-message").textContent = ""; }
  catch(e) { $("#customer-message").textContent = e.message; }
}
$("#customer-toggle").onclick = () => {
  $("#customer-dialog").showModal();
  customerAction(async()=>{ await refresh(true); await loadCustomer(); });
};
$("#customer-form").onsubmit = e => {
  e.preventDefault();
  const action=e.submitter.value;
  const body=Object.fromEntries(new FormData(e.target));
  const buttons=[...e.target.querySelectorAll('button')];
  buttons.forEach(b=>b.disabled=true);
  customerAction(async()=>{
    await api("customer/"+action,{method:"POST",body:JSON.stringify(body)});
    e.target.reset(); await loadCustomer();
  }).finally(()=>buttons.forEach(b=>b.disabled=false));
};
$("#customer-logout").onclick=()=>customerAction(async()=>{
  await api("customer/session",{method:"DELETE"});
  customer=null; savedLists=[]; listsRevision=null; renderCustomer();
});
$("#refresh-lists").onclick=()=>customerAction(loadCustomer);
$("#save-list").onsubmit=e=>{
  e.preventDefault(); const button=e.submitter; button.disabled=true;
  customerAction(async()=>{
    const items=Object.entries(cart).filter(([,n])=>Number.isInteger(n)&&n>0).map(([id,count])=>({id,count}));
    if(!items.length) throw Error("Ajoutez d’abord des produits à votre panier.");
    const data=await api("customer/lists",{method:"POST",headers:{"If-Match":listsRevision},body:JSON.stringify({name:new FormData(e.target).get("name"),items})});
    savedLists=data.lists; listsRevision=data.revision; e.target.reset(); renderCustomer();
  }).finally(()=>button.disabled=false);
};
$("#saved-lists").onclick=e=>{
  const button=e.target.closest('button'); if(!button) return;
  if(button.dataset.restoreList) {
    const list=savedLists.find(l=>l.id===button.dataset.restoreList); let skipped=0;
    for(const item of list.items) {
      const p=products.find(p=>p.id===item.id);
      if(!p || p.stock<1) { skipped++; continue; }
      const wanted=(Number.isInteger(cart[p.id])?cart[p.id]:0)+item.count;
      cart[p.id]=Math.min(wanted,p.stock); if(wanted>p.stock) skipped++;
    }
    saveCart(); renderCustomer();
    $("#customer-message").textContent=skipped ? "Liste ajoutée au panier, avec des quantités ajustées selon les disponibilités. Certains produits sont indisponibles." : "Liste ajoutée au panier. Vous pouvez poursuivre vos courses.";
  }
  if(button.dataset.deleteList && confirm("Supprimer cette liste ?")) {
    button.disabled=true;
    customerAction(async()=>{
      const data=await api("customer/lists/"+button.dataset.deleteList,{method:"DELETE",headers:{"If-Match":listsRevision}});
      savedLists=data.lists; listsRevision=data.revision; renderCustomer();
    }).finally(()=>button.disabled=false);
  }
};
