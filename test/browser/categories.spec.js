import { test, expect } from "@playwright/test";
test("catégories : ajout, renommage, ordre, protection et suppression synchronisés", async ({
  browser,
}) => {
  const a = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await a.newPage();
  await page.goto("/#gestion");
  await page.getByLabel("Code administrateur").fill("e2e-only-admin-code");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByLabel("Nouvelle catégorie").fill("Test catégorie");
  await page
    .getByRole("button", { name: "Ajouter la catégorie", exact: true })
    .click();
  let row = page.locator(".category-row").filter({ hasText: "Test catégorie" });
  await expect(row).toContainText("0 produit(s)");
  const b = await browser.newContext();
  const shop = await b.newPage();
  await shop.goto("/");
  await expect(
    shop.getByRole("button", { name: "Test catégorie", exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept("Test renommée"));
  await row.getByRole("button", { name: "Renommer", exact: true }).click();
  row = page.locator(".category-row").filter({ hasText: "Test renommée" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Monter", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Ajouter un produit", exact: true })
    .click();
  await page.getByLabel("Nom du produit").fill("Produit catégorie");
  await page.locator("#family-select").selectOption("Test renommée");
  await page.getByLabel("Prix d’achat").fill("1");
  await page.getByLabel("Prix de vente").fill("3");
  await page.getByLabel("Stock (").fill("9");
  await page
    .getByRole("button", { name: "Enregistrer le produit", exact: true })
    .click();
  await expect(row).toContainText("1 produit(s)");
  await row
    .getByRole("button", { name: "Supprimer la catégorie", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("Déplacez d’abord");
  const card = page
    .locator("#admin-products .product-card")
    .filter({ hasText: "Produit catégorie" });
  await card.getByRole("button", { name: "Modifier", exact: true }).click();
  await page.locator("#family-select").selectOption("fruits");
  await page
    .getByRole("button", { name: "Enregistrer le produit", exact: true })
    .click();
  await expect(row).toContainText("0 produit(s)");
  page.once("dialog", (d) => d.accept());
  await row
    .getByRole("button", { name: "Supprimer la catégorie", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await shop.reload();
  await expect(
    shop.getByRole("button", { name: "Test renommée", exact: true }),
  ).toHaveCount(0);
  await expect(shop.locator("#products")).toContainText("Produit catégorie");
  await expect(card).toContainText("9 en stock");
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(card).toHaveCount(0);
  await a.close();
  await b.close();
});
