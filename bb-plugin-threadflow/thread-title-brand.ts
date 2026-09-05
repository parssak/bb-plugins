export type ThreadTitleBrand = "bb" | "bogi";

export type BrandedThreadTitle = {
  brand: ThreadTitleBrand | null;
  title: string;
};

export function parseThreadTitleBrand(title: string): BrandedThreadTitle {
  const match = /^\[(bb|bogi)\][ \t]*/i.exec(title);
  if (match === null) return { brand: null, title };
  return {
    brand: match[1]!.toLowerCase() as ThreadTitleBrand,
    title: title.slice(match[0].length),
  };
}
