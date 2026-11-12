import { customerHandler } from "../../lib/customers.js";
import { getStore } from "@netlify/blobs";
import {
  createHmac,
  timingSafeEqual,
  randomUUID,
  createHash,
} from "node:crypto";
import {
  product,
  publicProduct,
  makeOrder,
  catalogCategories,
  categoryName,
} from "../../lib/domain.js";
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
const sign = (s, key) =>
  createHmac("sha256", key).update(s).digest("base64url");
function equal(a, b) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function authorized(req, key) {
  if (!key) return false;
  const token = (req.headers.get("cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("herblay_session="))
    ?.slice(16);
  if (!token) return false;
  const [expiry, signature] = token.split(".");
  return (
    Number(expiry) > Date.now() &&
    Number(expiry) < Date.now() + 9 * 3600000 &&
    equal(signature || "", sign(expiry, key))
  );
}
const cookie = (value, age) =>
  `herblay_session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
export function createHandler(storeFactory = getStore, env = process.env) {
  return async (req, context = {}) => {
    try {
      const url = new URL(req.url),
        path = url.pathname
          .replace(/^\/(?:\.netlify\/functions\/api|api)\/?/, "")
          .split("/")
          .filter(Boolean),
        method = req.method;
      const store = storeFactory({ name: "herblay-v6", consistency: "strong" }),
        key = env.HERBLAY_ADMIN_CODE,
        admin = authorized(req, key);
      if (!["GET", "HEAD"].includes(method)) {
        const origin = req.headers.get("origin");
        if (origin && origin !== url.origin)
          return json({ error: "Origine refusée" }, 403);
      }
      if (path[0] === "customer") return await customerHandler(req, path.slice(1), store, context, json);
      if (path[0] === "session") {
        if (method === "GET")
          return json({ authenticated: admin, configured: !!key });
        if (method === "DELETE")
          return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
        if (method !== "POST") return json({ error: "Méthode refusée" }, 405);
        if (!key)
          return json(
            { error: "HERBLAY_ADMIN_CODE doit être configuré dans Netlify." },
            503,
          );
        const ip = context.ip || "unknown",
          rateKey = "login/" + createHash("sha256").update(ip).digest("hex");
        for (let attempt = 0; attempt < 5; attempt++) {
          const old = await store.getWithMetadata(rateKey, { type: "json" });
          if (old && !old.etag) throw Error("Métadonnées Blobs indisponibles");
          const r =
            old && old.data.until > Date.now()
              ? old.data
              : { count: 0, until: Date.now() + 900000 };
          if (r.count >= 10)
            return json(
              { error: "Trop de tentatives. Réessayez dans 15 minutes." },
              429,
            );
          const result = await store.setJSON(
            rateKey,
            { ...r, count: r.count + 1 },
            old ? { onlyIfMatch: old.etag } : { onlyIfNew: true },
          );
          if (result.modified) break;
          if (attempt === 4)
            return json({ error: "Réessayez dans un instant" }, 429);
        }
        const body = await req.json();
        if (typeof body.code !== "string" || !equal(body.code, key))
          return json({ error: "Code incorrect" }, 401);
        const expiry = String(Date.now() + 8 * 3600000);
        return json({ ok: true }, 200, {
          "Set-Cookie": cookie(expiry + "." + sign(expiry, key), 8 * 3600),
        });
      }
      if (path[0] === "photo") {
        if (method === "GET" && /^[0-9a-f-]{36}$/.test(path[1] || "")) {
          const photo = await store.get("photo/" + path[1], {
            type: "arrayBuffer",
          });
          return photo
            ? new Response(photo, {
                headers: {
                  "Content-Type": "image/jpeg",
                  "Cache-Control": "public, max-age=31536000, immutable",
                  "X-Content-Type-Options": "nosniff",
                },
              })
            : json({ error: "Photo absente" }, 404);
        }
        if (method !== "POST") return json({ error: "Méthode refusée" }, 405);
        if (!admin) return json({ error: "Connexion requise" }, 401);
        if (Number(req.headers.get("content-length")) > 2000000)
          return json({ error: "Photo trop volumineuse" }, 413);
        const bytes = Buffer.from(await req.arrayBuffer());
        if (
          bytes.length > 2000000 ||
          bytes.length < 4 ||
          bytes[0] !== 255 ||
          bytes[1] !== 216 ||
          bytes.at(-2) !== 255 ||
          bytes.at(-1) !== 217
        )
          return json({ error: "Photo JPEG attendue (2 Mo maximum)" }, 400);
        const id = randomUUID();
        await store.set("photo/" + id, bytes);
        return json({ photo: "/api/photo/" + id }, 201);
      }
      const old = await store.getWithMetadata("state", { type: "json" });
      if (old && !old.etag) throw Error("Métadonnées Blobs indisponibles");
      const state = old?.data || { products: [], orders: [] };
      const categories = catalogCategories(state);
      const categoryList = () =>
        state.categories.map((c) => ({
          ...c,
          count: state.products.filter((p) => p.family === c.name).length,
        }));
      if (path[0] === "categories" && method === "GET")
        return json({
          categories: categoryList(),
          revision: old?.etag || null,
        });
      if (path[0] === "products" && method === "GET")
        return json({
          categories: categoryList(),
          products: admin ? state.products : state.products.map(publicProduct),
          revision: old?.etag || null,
        });
      if (path[0] === "orders" && method === "GET") {
        if (!admin) return json({ error: "Connexion requise" }, 401);
        return json({ orders: state.orders, revision: old?.etag || null });
      }
      if (!["products", "orders", "categories"].includes(path[0]))
        return json({ error: "Introuvable" }, 404);
      if (!admin && !(path[0] === "orders" && method === "POST"))
        return json({ error: "Connexion requise" }, 401);
      if (Number(req.headers.get("content-length")) > 100000)
        return json({ error: "Requête trop volumineuse" }, 413);
      if (["products", "categories"].includes(path[0]) && method !== "POST" && req.headers.get("if-match") !== (old?.etag || ""))
        return json({ error: "Le catalogue a changé. Actualisez." }, 409);
      const body = method === "DELETE" ? {} : await req.json();
      let result;
      if (path[0] === "categories") {
        if (!["POST", "PUT", "DELETE"].includes(method))
          return json({ error: "Méthode refusée" }, 405);
        if (method === "POST") {
          result = {
            id: randomUUID(),
            name: categoryName(body.name, categories),
          };
          categories.push(result);
        } else if (method === "PUT" && path[1] === "order") {
          if (
            !Array.isArray(body.ids) ||
            body.ids.length !== categories.length ||
            new Set(body.ids).size !== categories.length ||
            body.ids.some((id) => !categories.some((c) => c.id === id))
          )
            throw Error("Ordre invalide");
          state.categories = body.ids.map((id) =>
            categories.find((c) => c.id === id),
          );
          result = { ok: true };
        } else {
          const c = categories.find((c) => c.id === path[1]);
          if (!c) return json({ error: "Catégorie introuvable" }, 404);
          if (method === "DELETE") {
            const count = state.products.filter(
              (p) => p.family === c.name,
            ).length;
            if (count)
              return json(
                {
                  error: `${count} produit(s) associé(s). Déplacez d’abord les produits vers une autre catégorie.`,
                  count,
                },
                409,
              );
            state.categories = categories.filter((item) => item.id !== c.id);
            result = { ok: true };
          } else {
            const name = categoryName(body.name, categories, c.id);
            for (const p of state.products)
              if (p.family === c.name) p.family = name;
            c.name = name;
            result = c;
          }
        }
      } else if (path[0] === "products") {
        if (!["POST", "PUT", "DELETE"].includes(method))
          return json({ error: "Méthode refusée" }, 405);
        if (method === "POST") {
          result = { ...product(body, categories), id: randomUUID() };
          state.products.push(result);
        } else {
          const index = state.products.findIndex((p) => p.id === path[1]);
          if (index < 0) return json({ error: "Produit introuvable" }, 404);
          if (method === "DELETE") {
            state.products.splice(index, 1);
            result = { ok: true };
          } else {
            result = { ...product(body, categories), id: path[1] };
            state.products[index] = result;
          }
        }
      } else if (method === "POST") {
        result = {
          ...makeOrder(body, state.products),
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        };
        for (const i of result.items)
          state.products.find((p) => p.id === i.id).stock -= i.count;
        state.orders.unshift(result);
      } else if (method === "PUT") {
        if (req.headers.get("if-match") !== (old?.etag || ""))
          return json({ error: "Les commandes ont changé. Actualisez." }, 409);
        result = state.orders.find((o) => o.id === path[1]);
        if (!result) return json({ error: "Commande introuvable" }, 404);
        if (!["à préparer", "prête", "retirée"].includes(body.status))
          throw Error("Statut invalide");
        result.status = body.status;
      } else return json({ error: "Méthode refusée" }, 405);
      const saved = await store.setJSON(
        "state",
        state,
        old ? { onlyIfMatch: old.etag } : { onlyIfNew: true },
      );
      if (!saved.modified)
        return json(
          {
            error: "Une autre modification a eu lieu. Actualisez et réessayez.",
          },
          409,
        );
      return json(
        {
          ...result,
          revision: saved.etag,
          ...(path[0] === "categories"
            ? { categories: categoryList(), products: state.products }
            : {}),
        },
        method === "POST" ? 201 : 200,
      );
    } catch (e) {
      if (e instanceof SyntaxError)
        return json({ error: "JSON invalide" }, 400);
      if (/Champ|invalide|Stock|Choisissez|requis|Nom|Nombre/.test(e.message))
        return json({ error: e.message }, 400);
      console.error("Herblay API:", e.message);
      return json(
        { error: "Service indisponible. Réessayez dans un instant." },
        503,
      );
    }
  };
}
export default createHandler();
