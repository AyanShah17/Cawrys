// apps/web/lib/brand.ts
// White-label settings, read from the environment at runtime (no rebuild needed to re-brand).

export type Brand = {
  name: string;
  tagline: string;
  company: string;
  primary: string; // #rrggbb
  rgb: string; // "r g b" for CSS variables
  logoUrl: string | null;
  supportEmail: string | null;
};

export type BrandConfig = Brand;

const DEFAULT_PRIMARY = "#6366f1";

function toRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const h = m ? m[1] : DEFAULT_PRIMARY.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
}

function cleanUrl(v: string | undefined): string | null {
  if (!v) return null;
  return /^(https:\/\/|\/)/.test(v.trim()) ? v.trim() : null; // https or same-origin only
}

export function getBrand(): Brand {
  const name = (process.env.BRAND_NAME || "Cawrys").trim().slice(0, 40);
  const primary = /^#[0-9a-f]{6}$/i.test(process.env.BRAND_PRIMARY_COLOR || "")
    ? process.env.BRAND_PRIMARY_COLOR!
    : DEFAULT_PRIMARY;
  return {
    name,
    tagline: (process.env.BRAND_TAGLINE || "AI operations for your business").trim().slice(0, 120),
    company: (process.env.BRAND_COMPANY || name).trim().slice(0, 80),
    primary,
    rgb: toRgb(primary),
    logoUrl: cleanUrl(process.env.BRAND_LOGO_URL),
    supportEmail: (process.env.BRAND_SUPPORT_EMAIL || "").trim() || null,
  };
}
