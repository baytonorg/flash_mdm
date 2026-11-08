import { useEffect } from 'react';

const NO_INDEX_DIRECTIVE = 'noindex, nofollow, noarchive';

let activeConsumers = 0;
let managedMeta: HTMLMetaElement | null = null;
let createdMeta = false;
let previousContent: string | null = null;

export function useNoIndexRobots(): void {
  useEffect(() => {
    if (activeConsumers === 0) {
      const existing = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
      managedMeta = existing ?? document.createElement('meta');
      createdMeta = !existing;
      previousContent = existing?.getAttribute('content') ?? null;
      if (!existing) {
        managedMeta.name = 'robots';
        document.head.appendChild(managedMeta);
      }
    }
    activeConsumers += 1;
    managedMeta?.setAttribute('content', NO_INDEX_DIRECTIVE);

    return () => {
      activeConsumers = Math.max(0, activeConsumers - 1);
      if (activeConsumers > 0 || !managedMeta) return;

      if (createdMeta) {
        managedMeta.remove();
      } else if (previousContent === null) {
        managedMeta.removeAttribute('content');
      } else {
        managedMeta.setAttribute('content', previousContent);
      }
      managedMeta = null;
      createdMeta = false;
      previousContent = null;
    };
  }, []);
}
