import { useRef, useEffect, useState, useCallback } from "react";

// Blob URLs are created in an effect; bump `urlReady` so the UI re-renders when ready.
export function useObjectUrls(items) {
  const urlsRef = useRef(new Map());
  const [urlReady, setUrlReady] = useState(0);

  useEffect(() => {
    const urls = urlsRef.current;
    const ids = new Set(items.map((i) => i.id));
    let changed = false;
    for (const [id, url] of urls) {
      if (!ids.has(id)) {
        URL.revokeObjectURL(url);
        urls.delete(id);
        changed = true;
      }
    }
    for (const item of items) {
      if (!urls.has(item.id)) {
        urls.set(item.id, URL.createObjectURL(item.blob));
        changed = true;
      }
    }
    if (changed) setUrlReady((n) => n + 1);
  }, [items]);

  useEffect(() => () => {
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current.clear();
  }, []);

  const getUrl = useCallback((id) => urlsRef.current.get(id), [urlReady]);

  return { getUrl, urlReady };
}
