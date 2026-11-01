import { test, expect } from "@playwright/test";

test("révisions : opérations consécutives, lecture retardée, conflit réel et Actualiser", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/#gestion");
  await page.getByLabel("Code administrateur").fill("e2e-only-admin-code");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator(".category-row").first()).toBeVisible();
  const initial = await (await context.request.get("/api/products")).json();
  const writes = [];
  page.on("response", async (response) => {
    if (
      response.url().includes("/api/categories") &&
      response.request().method() !== "GET"
    )
      writes.push({
        status: response.status(),
        match: response.request().headers()["if-match"],
        data: await response.json(),
      });
  });
  const row = (id) =>
    page
      .locator(".category-row")
      .filter({ has: page.locator(`[data-category-rename="${id}"]`) });
  const rename = async (id, name) => {
    page.once("dialog", (d) => d.accept(name));
    await row(id)
      .getByRole("button", { name: "Renommer", exact: true })
      .click();
    await expect(row(id).locator("strong")).toHaveText(name);
  };
  // Hold a pre-write poll until after the first successful write.
  let release, intercepted;
  const held = new Promise((r) => (intercepted = r));
  await page.route(
    "**/api/products",
    async (route) => {
      const response = await route.fetch();
      intercepted();
      await new Promise((r) => (release = r));
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await held;
  await rename(initial.categories[0].id, "Révision fruits");
  release();
  await rename(initial.categories[1].id, "Révision légumes");
  await page.getByLabel("Nouvelle catégorie").fill("Révision temporaire");
  await page
    .getByRole("button", { name: "Ajouter la catégorie", exact: true })
    .click();
  const temp = page
    .locator(".category-row")
    .filter({ hasText: "Révision temporaire" });
  await expect(temp).toBeVisible();
  await temp.getByRole("button", { name: "Monter", exact: true }).click();
  await expect(
    page.locator(".category-row").nth(initial.categories.length - 1),
  ).toContainText("Révision temporaire");
  await temp.getByRole("button", { name: "Descendre", exact: true }).click();
  await expect(page.locator(".category-row").last()).toContainText(
    "Révision temporaire",
  );
  page.once("dialog", (d) => d.accept());
  await temp
    .getByRole("button", { name: "Supprimer la catégorie", exact: true })
    .click();
  await expect(temp).toHaveCount(0);
  await expect.poll(() => writes.length).toBe(6);
  expect(writes.map((w) => w.status)).toEqual([200, 200, 201, 200, 200, 200]);
  for (let i = 1; i < writes.length; i++)
    expect(writes[i].match).toBe(writes[i - 1].data.revision);
  const current = await (await context.request.get("/api/products")).json();
  expect(current.products).toEqual(initial.products);
  // A second device writes after the first device's snapshot.
  const other = await browser.newContext();
  await other.request.post("/api/session", {
    data: { code: "e2e-only-admin-code" },
  });
  const changed = await other.request.put(
    "/api/categories/" + initial.categories[2].id,
    {
      headers: { "If-Match": current.revision },
      data: { name: "Autre appareil" },
    },
  );
  expect(changed.status()).toBe(200);
  const latest = await changed.json();
  page.once("dialog", (d) => d.accept("Conflit refusé"));
  await row(initial.categories[2].id)
    .getByRole("button", { name: "Renommer", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("Le catalogue a changé");
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(row(initial.categories[2].id)).toContainText("Autre appareil");
  await rename(initial.categories[2].id, "Après actualisation");
  await expect.poll(() => writes.length).toBe(8);
  expect(writes[6].status).toBe(409);
  expect(writes[7].match).toBe(latest.revision);
  expect(writes[7].status).toBe(200);
  // Restore names in this isolated test store for the remaining browser scenarios.
  for (const c of initial.categories.slice(0, 3)) await rename(c.id, c.name);
  await context.close();
  await other.close();
});
