import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Item, Slide } from "./model";
import "./viewer.css";

interface StageProps {
  slide: Slide;
  selected?: string;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
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
  selected,
  onSelect,
  onMove,
  onResize,
}: StageProps) {
  const host = useRef<HTMLDivElement>(null);
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
    e.currentTarget.setPointerCapture(e.pointerId);
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
      const maxW = 1280 - item.x;
      const maxH = 720 - item.y;
      if (item.type === "image") {
        const ratio = item.w / item.h;
        const target =
          Math.abs(dx) >= Math.abs(dy) ? item.w + dx : (item.h + dy) * ratio;
        const w = Math.min(
          maxW,
          maxH * ratio,
          Math.max(1, Math.min(24, item.w), target),
        );
        onResize?.(item.id, w, w / ratio);
      } else {
        onResize?.(
          item.id,
          Math.min(maxW, Math.max(24, item.w + dx)),
          Math.min(maxH, Math.max(24, item.h + dy)),
        );
      }
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
        {slide.items.map((item) => (
          <div
            key={item.id}
            className={
              "atlas-item" + (selected === item.id ? " atlas-selected" : "")
            }
            style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
            onPointerDown={(e) => start(e, item)}
          >
            {item.type === "image" ? (
              <SlideImage src={item.src} />
            ) : (
              <div
                className="atlas-slide-text"
                style={{
                  color: item.color,
                  fontSize: item.size,
                  textAlign: item.align,
                }}
              >
                {item.text}
              </div>
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
