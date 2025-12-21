import { useEffect, useState } from "react";

export function useAsyncResource<T>(factory: () => Promise<T & Disposable>) {
  const [resource, setResource] = useState<T & Disposable | undefined>(undefined);
  const [error, setError] = useState<unknown | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let instance: T & Disposable | undefined;

    (async () => {
      try {
        instance = await factory();
        if (active) setResource(instance);
        else instance?.[Symbol.dispose]?.();
      } catch (err) {
        if (active) setError(err);
      }
    })();

    return () => {
      active = false;
      instance?.[Symbol.dispose]?.();
    };
  }, [factory]);

  return { resource, error };
}