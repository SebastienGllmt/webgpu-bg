import { Surface as BaseSurface } from './gfx.js';

/**
 * Create a Surface where the canvas is forced to be in the background
 * This is needed to render the "background" actually in the background
 * note: we can't rely on z-index, as that would block pointer tracking for BGs that leverage that
 */
export class Surface extends BaseSurface {
  /**
   * https://github.com/WebAssembly/wasi-gfx/issues/61
   */
  static firstSurface = false;
  constructor(desc) {
    super(desc);
    if (!Surface.firstSurface) {
      // remove element most recently added to the body
      // as it represents the canvas added by the `BaseSurface` class
      const canvasElement = document.body.lastElementChild;
      if (canvasElement) {
        canvasElement.remove();
      }
      // instead, add it to the "background" element
      const backgroundElement = document.getElementById('background');
      if (backgroundElement) {
        backgroundElement.appendChild(this.canvas);
      }
      Surface.firstSurface = true;
    }
  }
}