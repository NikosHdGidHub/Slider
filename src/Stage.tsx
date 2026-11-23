import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Item, Slide, Deck } from "./model";
import "./viewer.css";
import { PathHandles } from "./PathHandles";
import { TextBlock, VectorShape, useFonts } from "./Artwork";

interface StageProps {
  slide: Slide;
  deck?: Deck;
  onText?: (id: string, fields: Partial<Item>) => void;
  onNodes?: (id: string, nodes: NonNullable<Item["nodes"]>) => void;
  onEditText?: (id: string) => void;
  diagnostics?: boolean;
  selected?: string;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number, x: number, y: number) => void;
}

function SlideImage({
  src,
  background = false,
}: {
  src: string;
  background?: boolean;
}) {
  const [failed, setFailed] = useState("");
  if (failed === src) {
    return (
      <span
        className={background ? "atlas-background-error" : "atlas-media-error"}
      >
        {background ? "Фон недоступен" : "Изображение недоступно"}
      </span>
    );
  }
  return (
    <img
      draggable={false}
      className={background ? "atlas-background-image" : "atlas-object-image"}
      src={src}
      onError={() => setFailed(src)}
      alt={background ? "" : "Изображение слайда"}
    />
  );
}

export function Stage({
  slide,
  deck,
  onEditText,
  diagnostics,
  onNodes,
  onText,
  selected,
  onSelect,
  onMove,
  onResize,
}: StageProps) {
  const host = useRef<HTMLDivElement>(null);
  const fontError = useFonts(host, deck);
  const [scale, setScale] = useState(0);
  const drag = useRef<{
    item: Item;
    x: number;
    y: number;
    scale: number;
    pointer: number;
    resize: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setScale(el.getBoundingClientRect().width / 1280);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function start(
    e: ReactPointerEvent<HTMLDivElement | HTMLSpanElement>,
    item: Item,
    resize = false,
  ) {
    if (!onSelect || e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(item.id);
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = {
      item,
      x: e.clientX,
      y: e.clientY,
      scale: host.current!.getBoundingClientRect().width / 1280,
      pointer: e.pointerId,
      resize,
    };
  }
  function move(e: ReactPointerEvent) {
    const run = drag.current;
    if (!run || run.pointer !== e.pointerId) return;
    const dx = (e.clientX - run.x) / run.scale;
    const dy = (e.clientY - run.y) / run.scale;
    const item = run.item;
    if (run.resize) {
      const angle = ((item.rotation ?? 0) * Math.PI) / 180,
        c = Math.cos(angle),
        s = Math.sin(angle);
      const fx = item.flipX ? -1 : 1,
        fy = item.flipY ? -1 : 1;
      const localX = (c * dx + s * dy) * fx,
        localY = (-s * dx + c * dy) * fy;
      const transformed = !!(item.rotation || item.flipX || item.flipY);
      const maxW = transformed ? 8192 : Math.max(1, 1280 - item.x),
        maxH = transformed ? 8192 : Math.max(1, 720 - item.y);
      let w = Math.min(maxW, Math.max(Math.min(24, item.w), item.w + localX));
      let h = Math.min(maxH, Math.max(Math.min(24, item.h), item.h + localY));
      if (item.type === "image") {
        const ratio = item.w / item.h,
          target = Math.abs(localX) >= Math.abs(localY) ? w : h * ratio;
        w = Math.min(maxW, maxH * ratio, target);
        h = w / ratio;
      }
      const dw = w - item.w,
        dh = h - item.h;
      onResize?.(
        item.id,
        w,
        h,
        item.x + (dw * fx * c - dh * fy * s - dw) / 2,
        item.y + (dw * fx * s + dh * fy * c - dh) / 2,
      );
    } else {
      onMove?.(
        item.id,
        Math.round(Math.max(0, Math.min(1280 - item.w, item.x + dx))),
        Math.round(Math.max(0, Math.min(720 - item.h, item.y + dy))),
      );
    }
  }
  function end(e: ReactPointerEvent) {
    if (drag.current?.pointer === e.pointerId) drag.current = null;
  }
  return (
    <div
      ref={host}
      className={"atlas-stage" + (onSelect ? " atlas-editable" : "")}
      onPointerMove={move}
      onPointerCancel={end}
      onPointerUp={end}
      onLostPointerCapture={end}
      onPointerDown={() => onSelect?.("")}
    >
      <div
        className="atlas-stage-space"
        style={{
          backgroundColor: slide.color,
          transform: "scale(" + scale + ")",
        }}
      >
        {slide.background && <SlideImage src={slide.background} background />}
        {fontError && <span className="overflow-badge">{fontError}</span>}
        {slide.items.map((item) => (
          <div
            key={item.id}
            className={
              "atlas-item" + (selected === item.id ? " atlas-selected" : "")
            }
            style={{
              left: item.x,
              top: item.y,
              width: item.w,
              height: item.h,
              opacity: item.opacity,
              transform: `rotate(${item.rotation ?? 0}deg) scale(${item.flipX ? -1 : 1},${item.flipY ? -1 : 1})`,
              filter: item.shadow
                ? `drop-shadow(${item.shadow.x}px ${item.shadow.y}px ${item.shadow.blur}px ${item.shadow.color})`
                : undefined,
            }}
            onDoubleClick={() => item.type !== "image" && onEditText?.(item.id)}
            onPointerDown={(e) => start(e, item)}
          >
            {item.type === "image" ? (
              <SlideImage src={item.src} />
            ) : (
              <>
                {item.type === "shape" && <VectorShape item={item} />}
                {(item.type === "text" || item.text || item.paragraphs) && (
                  <TextBlock
                    onText={
                      onText ? (fields) => onText(item.id, fields) : undefined
                    }
                    item={item}
                    deck={deck}
                    editing={!!onSelect || !!diagnostics}
                  />
                )}
              </>
            )}
            {selected === item.id && onNodes && item.nodes && (
              <PathHandles
                item={item}
                change={(nodes) => onNodes(item.id, nodes)}
              />
            )}
            {selected === item.id && onResize && (
              <span
                className="atlas-resize"
                aria-label="Изменить размер"
                onPointerDown={(e) => start(e, item, true)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
