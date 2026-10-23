import type { KitServerRoute } from '../pwa/kit-server.js';

// Product availability is external catalog data: the main build can fetch a
// different catalog from the checked-in preview. These two positive acceptance
// journeys require one known product and still use the real loader, renderer,
// affiliate policy, service-worker cache and offline launches.
const catalog = {
  slots: {},
  products: {
    '_internal.lightDevices': [{
      key: 'mitochondriak-pulse', name: 'Mitochondriak Pulse',
      vendor: 'Mitochondriak', vendorKey: 'mitochondriak', regions: ['INTL'],
      url: 'https://www.mitochondriak.com/pulse',
    }],
  },
  vendors: { mitochondriak: { name: 'Mitochondriak', homepage: 'https://www.mitochondriak.com' } },
};

export const lightDeviceCatalogRoute: KitServerRoute = async (request, response) => {
  if (new URL(request.url || '/', 'http://localhost').pathname !== '/data/recommendations.json') return false;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(catalog));
  return true;
};
