import 'server-only';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { sameWebsiteHost } from './supplier-evidence';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !address.toLowerCase().startsWith('2001:db8:');
  return false;
}

/** Pin each connection to a public address; follow only bounded same-site redirects. */
export async function readSupplierHtml(rawUrl: string, redirectsRemaining = 2, allowXml = false): Promise<string> {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) return '';
  const target = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      agent: false,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [target]);
        else callback(null, target.address, target.family);
      },
      headers: { 'User-Agent': 'ARAT Supplier Research Bot/1.0', Accept: 'text/html,application/xhtml+xml' },
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirectsRemaining > 0) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        if (!sameWebsiteHost(nextUrl, hostname)) { resolve(''); return; }
        void readSupplierHtml(nextUrl, redirectsRemaining - 1, allowXml).then(resolve, reject);
        return;
      }
      const contentType = response.headers['content-type'] ?? '';
      if (response.statusCode !== 200 || !(/text\/html|application\/xhtml\+xml/i.test(contentType) || (allowXml && /(?:text|application)\/xml/i.test(contentType)))) {
        response.resume(); resolve(''); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 512 * 1024) { request.destroy(); resolve(''); }
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    const timeout = setTimeout(() => request.destroy(new Error('Supplier page timed out')), 8000);
    request.on('close', () => clearTimeout(timeout));
    request.on('error', reject);
    request.end();
  });
}
