import { readSupplierHtml } from '../supplier-page';
import { sameWebsiteHost } from '../supplier-evidence';
import { mapResearchQueries } from './queries';
import { exactModelResults } from './model-evidence';

/** Bounded same-site sitemap traversal; a URL match is a lead, not stock evidence. */
export async function supplierCatalogModels(sourceUrls: string[], models: string[]) {
  const origins = [...new Set(sourceUrls.flatMap(raw => {
    try {
      const url = new URL(raw);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.port ? [url.origin] : [];
    } catch { return []; }
  }))].slice(0, 24);
  const batches = await mapResearchQueries(origins, async origin => {
    const queue = [origin + '/sitemap.xml', origin + '/wp-sitemap.xml'];
    const visited = new Set<string>();
    const matches = new Set<string>();
    while (queue.length && visited.size < 6) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      let xml = '';
      try { xml = await readSupplierHtml(url, 2, true); } catch { continue; }
      // Parse locations as text only: never evaluate XML entities or external DTDs.
      const locations = [...xml.matchAll(/<loc\b[^>]*>\s*(?:<!\[CDATA\[)?([^<]+?)(?:\]\]>)?\s*<\/loc>/gi)]
        .map(match => match[1].replace(/&amp;/g, '&').trim())
        .filter(location => sameWebsiteHost(location, new URL(origin).hostname));
      for (const location of locations) {
        if (models.some(model => exactModelResults([{ source_url: location }], [model], '').length)) matches.add(location);
      }
      // Product sitemaps precede blog/category sitemaps within the request budget.
      const children = locations.filter(location => /sitemap/i.test(new URL(location).pathname) && !visited.has(location));
      children.sort((a, b) => Number(/product|urun|catalog/i.test(b)) - Number(/product|urun|catalog/i.test(a)));
      queue.unshift(...children);
    }
    return [...matches].map(url => ({ origin, url }));
  }, 4);
  return batches.flat();
}
