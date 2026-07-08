import { getCollection } from "astro:content";
import type { APIRoute } from "astro";

type TSitemapEntry = {
  path: string;
  changefreq: "weekly" | "monthly";
  priority: string;
};

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const GET: APIRoute = async ({ site }) => {
  const siteUrl = site ?? new URL("https://vibecanvas.dev");
  const docs = await getCollection("docs");
  const entries: TSitemapEntry[] = [
    { path: "/", changefreq: "weekly", priority: "1.0" },
    { path: "/docs", changefreq: "monthly", priority: "0.8" },
    ...docs.map((entry) => ({
      path: `/docs/${entry.slug}`,
      changefreq: "monthly" as const,
      priority: "0.7",
    })),
  ];

  const urls = entries
    .map((entry) => {
      const loc = new URL(entry.path, siteUrl).toString();

      return [
        "  <url>",
        `    <loc>${escapeXml(loc)}</loc>`,
        `    <changefreq>${entry.changefreq}</changefreq>`,
        `    <priority>${entry.priority}</priority>`,
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
};
