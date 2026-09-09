// Shared by the Worker (/catalog) and the Vite dev middleware so both stay identical.

export const SIGLS = {
  console: 'f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e',
  pc: 'fdd9e2a7-0fee-49f6-ad69-4354098401ff',
  eaPlay: 'b8900d09-a491-44cc-916e-32b5acae621b',
};

const MARKET = 'US';
const LANGUAGE = 'en-us';
const BATCH = 50;

const COOP_FLAGS = ['XblLocalCoop', 'XblOnlineCoop', 'XblCrossPlatformCoop'];
const VERSUS_FLAGS = ['XblOnlineMultiPlayer', 'XblLocalMultiPlayer', 'XblCrossPlatformMultiPlayer'];

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

function pickImage(images = []) {
  for (const purpose of ['BoxArt', 'Poster', 'TitledHeroArt', 'SuperHeroArt', 'BrandedKeyArt', 'Logo']) {
    const hit = images.find((i) => i.ImagePurpose === purpose);
    if (hit?.Uri) return hit.Uri.startsWith('//') ? `https:${hit.Uri}` : hit.Uri;
  }
  return '';
}

// Editions and bundles carry genre on `Category` (singular) with `Categories` null.
// Without this fallback ~13% of the catalog is invisible to vetoes.
function readCategories(props = {}) {
  const list = Array.isArray(props.Categories) ? props.Categories.filter(Boolean) : [];
  if (list.length) return list;
  return props.Category ? [props.Category] : [];
}

function readPlayModes(props = {}) {
  const names = new Set((props.Attributes || []).map((a) => a.Name));
  return {
    coop: COOP_FLAGS.some((f) => names.has(f)),
    versus: VERSUS_FLAGS.some((f) => names.has(f)),
    solo: names.has('SinglePlayer'),
  };
}

export async function buildCatalog(fetchImpl = fetch) {
  const tiersById = new Map();

  for (const [tier, siglId] of Object.entries(SIGLS)) {
    const res = await fetchImpl(
      `https://catalog.gamepass.com/sigls/v2?id=${siglId}&language=${LANGUAGE}&market=${MARKET}`
    );
    if (!res.ok) continue;
    for (const entry of await res.json()) {
      if (!entry?.id) continue;
      if (!tiersById.has(entry.id)) tiersById.set(entry.id, []);
      tiersById.get(entry.id).push(tier);
    }
  }

  const games = [];
  for (const group of chunk([...tiersById.keys()], BATCH)) {
    const res = await fetchImpl(
      `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${group.join(',')}&market=${MARKET}&languages=${LANGUAGE}`
    );
    if (!res.ok) continue;
    const data = await res.json();

    for (const product of data.Products || []) {
      const lp = product.LocalizedProperties?.[0];
      if (!lp?.ProductTitle) continue;
      const props = product.Properties || {};

      games.push({
        id: product.ProductId,
        title: lp.ProductTitle,
        dev: lp.DeveloperName || lp.PublisherName || '',
        blurb: (lp.ShortDescription || lp.ProductDescription || '').slice(0, 320),
        cats: readCategories(props),
        sub: props.Subcategory || '',
        play: readPlayModes(props),
        img: pickImage(lp.Images),
        released: product.MarketProperties?.[0]?.OriginalReleaseDate || '',
        tiers: tiersById.get(product.ProductId) || [],
      });
    }
  }

  return { builtAt: new Date().toISOString(), count: games.length, games };
}
