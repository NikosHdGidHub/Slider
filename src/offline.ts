let registration: Promise<ServiceWorkerRegistration> | undefined;

function register(): Promise<ServiceWorkerRegistration> {
  if (!import.meta.env.PROD)
    throw new Error(
      "Офлайн-показ доступен в production-сборке. Запустите npm run build и npm run preview.",
    );
  if (!("serviceWorker" in navigator))
    throw new Error(
      "Для офлайн-показа нужен браузер с Service Worker и HTTPS или localhost.",
    );
  // Relative URLs keep independent installations isolated on GitHub Pages.
  const url = new URL("./sw.js", document.baseURI);
  if (!registration) {
    registration = navigator.serviceWorker
      .register(url, { updateViaCache: "none" })
      .catch((error) => {
        registration = undefined;
        throw error;
      });
  }
  return registration;
}

export function registerShell(): void {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void register().catch(() => {
      /* ensureShell reports a failed installation on explicit preparation. */
    });
  }
}

export async function ensureShell(): Promise<void> {
  const registered = await register();
  await new Promise<void>((resolve, reject) => {
    let channel: MessageChannel | undefined;
    const timer = window.setTimeout(() => finish(false), 60000);
    let finished = false;
    function finish(ok: boolean) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      channel?.port1.close();
      if (ok) resolve();
      else
        reject(
          new Error(
            "Не удалось проверить кеш приложения. Подключитесь к интернету и повторите подготовку.",
          ),
        );
    }
    navigator.serviceWorker.ready
      .then((ready) => {
        if (finished) return;
        if (ready.scope !== registered.scope || !ready.active)
          return finish(false);
        channel = new MessageChannel();
        channel.port1.onmessage = (event) => finish(event.data === true);
        ready.active.postMessage("atlas-check-shell", [channel.port2]);
      })
      .catch(() => finish(false));
  });
}
