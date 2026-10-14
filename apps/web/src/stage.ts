// Where the framebuffer sits on the canvas, and the one place where pointer positions are turned
// into framebuffer (page) coordinates (docs/PLAN.md §3, "Scaling rules" 4).

/** How the 640×480 framebuffer is drawn into the canvas's backing store. */
export interface StageLayout {
  /** Backing store size in device pixels. */
  readonly backingWidth: number;
  readonly backingHeight: number;
  /** Integer scale: each framebuffer pixel becomes `scale × scale` backing pixels. */
  readonly scale: number;
  /** Where framebuffer (0,0) lands in the backing store (letterboxing). */
  readonly offsetX: number;
  readonly offsetY: number;
}

/** 1×, the framebuffer filling the backing store (until Phase 7 sizes the stage). */
export function nativeLayout(width: number, height: number): StageLayout {
  return { backingWidth: width, backingHeight: height, scale: 1, offsetX: 0, offsetY: 0 };
}

/** The canvas element's box on the page, in CSS pixels (`getBoundingClientRect`). */
export interface ClientBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The framebuffer pixel under a client (CSS pixel) position: client → backing store (the canvas
 * may be shown at any CSS size) → framebuffer through the layout's offset and scale. Points off
 * the framebuffer give coordinates outside 0…639 × 0…479, which the engine treats as nothing.
 */
export function clientToFramebuffer(
  layout: StageLayout,
  box: ClientBox,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const backingX = box.width > 0 ? ((clientX - box.left) * layout.backingWidth) / box.width : 0;
  const backingY = box.height > 0 ? ((clientY - box.top) * layout.backingHeight) / box.height : 0;
  return {
    x: Math.floor((backingX - layout.offsetX) / layout.scale),
    y: Math.floor((backingY - layout.offsetY) / layout.scale),
  };
}
