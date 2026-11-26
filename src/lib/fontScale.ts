/**
 * Text size for this device, as a percentage of the browser default. Every
 * font size in the app is in rem, so scaling the root scales all text while
 * spacing stays put. Kept per device: the shop PC and a tablet want different sizes.
 */
const KEY = 'fontScale';
export const FONT_SCALE_DEFAULT = 100;

export function readFontScale(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return value >= 50 && value <= 200 ? value : FONT_SCALE_DEFAULT;
  } catch {
    return FONT_SCALE_DEFAULT;
  }
}

export function applyFontScale(percent: number): void {
  document.documentElement.style.fontSize = `${percent}%`;
  try {
    if (percent === FONT_SCALE_DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(percent));
  } catch {
    /* storage unavailable: the size just isn't remembered */
  }
}
