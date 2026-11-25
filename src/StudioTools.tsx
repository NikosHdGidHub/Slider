import { useEffect, useRef, useState, type MouseEvent } from "react";
export type Action = { name: string; run: () => void; key?: string };
function typing(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      "input,textarea,select,[contenteditable=true],[contenteditable=plaintext-only]",
    )
  );
}
export function useHistory<T>(value: T, write: (v: T) => void, key?: string) {
  const current = useRef(value);
  current.current = value;
  const stacks = useRef({ past: [] as T[], future: [] as T[] }),
    gesture = useRef(false),
    recorded = useRef(false);
  const scope = useRef(key);
  if (scope.current !== key) {
    scope.current = key;
    stacks.current = { past: [], future: [] };
    recorded.current = false;
  }
  useEffect(() => {
    const start = () => {
      gesture.current = true;
      recorded.current = false;
    },
      end = () => {
        gesture.current = false;
      };
    window.addEventListener("pointerdown", start, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    return () => {
      window.removeEventListener("pointerdown", start, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
    };
  }, []);
  const { past, future } = stacks.current;
  function set(next: T) {
    if (next === current.current) return;
    if (!gesture.current || !recorded.current) {
      past.push(current.current);
      if (past.length > 60) past.shift();
      recorded.current = true;
    }
    future.length = 0;
    current.current = next;
    write(next);
  }
  function step(redo: boolean) {
    const from = redo ? future : past,
      to = redo ? past : future;
    if (from.length) {
      to.push(value);
      write(from.pop()!);
    }
  }
  const actions: Action[] = [
    ...(past.length
      ? [{ name: "Отменить", key: "z", run: () => step(false) }]
      : []),
    ...(future.length
      ? [{ name: "Повторить", key: "shift+z", run: () => step(true) }]
      : []),
  ];
  return {
    set,
    update: (fn: (v: T) => T) => set(fn(current.current)),
    actions,
  };
}
export function useCommands(actions: Action[]) {
  const [point, show] = useState<{
    x: number;
    y: number;
    actions: Action[];
  } | null>(null);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        show(null);
        return;
      }
      if (typing(e.target) || !(e.ctrlKey || e.metaKey)) return;
      const action = actions.find(
        (a) => a.key === (e.shiftKey ? "shift+" : "") + e.key.toLowerCase(),
      );
      if (action) {
        e.preventDefault();
        action.run();
      }
    }
    function close(e: PointerEvent) {
      if (!(e.target as Element).closest(".studio-menu")) show(null);
    }
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", close);
    };
  }, [actions]);
  return {
    open: (e: MouseEvent, list: Action[]) => {
      e.preventDefault();
      e.stopPropagation();
      show({
        x: Math.max(0, Math.min(e.clientX, innerWidth - 215)),
        y: Math.max(
          0,
          Math.min(
            e.clientY,
            innerHeight - Math.min(innerHeight, list.length * 40 + 12),
          ),
        ),
        actions: list,
      });
    },
    menu: point && (
      <div
        role="menu"
        className="studio-menu"
        style={{ left: point.x, top: point.y }}
      >
        {point.actions.map((a) => (
          <button
            role="menuitem"
            key={a.name}
            onClick={() => {
              show(null);
              a.run();
            }}
          >
            {a.name}
          </button>
        ))}
      </div>
    ),
  };
}

export type HistoryControls = Pick<
  ReturnType<typeof useHistory>,
  "actions"
>;
