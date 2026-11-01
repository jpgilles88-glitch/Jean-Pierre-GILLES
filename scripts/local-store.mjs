import { getStore } from "@netlify/blobs";
// The SDK's local Blobs server omits ETags on GET responses (10.7.13).
// Its LIST response includes them. This local-only adapter restores that metadata;
// production uses getStore directly and requires GET's atomic data + ETag response.
export function localStoreFactory(port, siteID = "local-herblay") {
  return (options) => {
    const store = getStore({
      ...options,
      siteID,
      token: "local-emulator-only",
      edgeURL: `http://localhost:${port}`,
      uncachedEdgeURL: `http://localhost:${port}`,
    });
    const read = store.getWithMetadata.bind(store);
    store.getWithMetadata = async (key, opts) => {
      const result = await read(key, opts);
      if (result && !result.etag) {
        const listing = await store.list({ prefix: key });
        result.etag = listing.blobs.find((b) => b.key === key)?.etag;
      }
      return result;
    };
    return store;
  };
}
