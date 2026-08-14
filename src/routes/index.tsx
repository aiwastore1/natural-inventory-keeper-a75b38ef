import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Natural Cosmetics Inventory — Offline Stock & Sales" },
      {
        name: "description",
        content:
          "Offline-first inventory management for natural cosmetics and Moroccan beauty products: stock, batches, FEFO expiry, purchases, sales and reports.",
      },
      { property: "og:title", content: "Natural Cosmetics Inventory" },
      {
        property: "og:description",
        content: "Manage products, batches, FEFO expiry, purchases, sales and reports fully offline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/pos/index.html"
      title="Natural Cosmetics Inventory"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0 }}
    />
  );
}
