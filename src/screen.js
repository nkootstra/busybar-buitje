// The two displays as the bar has them: what is on show there, and so what has to be sent to change it.
// The app and the benchmark both make their frames here, so that the benchmark times what the app does.
import { backElements, backKey } from "./back.js";
import { bitmap } from "./bar.js";
import { toXpm } from "./canvas.js";
import { createFront, drawFront } from "./front.js";

/**
 * @returns {{
 *   changes: (show: object, settled: boolean, resend: boolean) => object[],
 *   forget: () => void,
 * }}
 *   `changes` paints `show`, a description from show.js, and returns the elements that differ from what the
 *   displays show; none when nothing changed. The back display is left as it is until `settled`: while the
 *   window slides the front comes first, and the back follows once, however many clicks the wheel made.
 *   `resend` sends the front even when it has not changed, for a frame that must go out.
 *   `forget` is for when the bar refused a frame: the next one is then sent whole.
 */
export function createScreen() {
  const front = createFront();
  let shownFront = null;
  let shownBack = null;
  return {
    changes(show, settled, resend) {
      const elements = [];
      drawFront(front, show);
      const xpm = toXpm(front);
      if (xpm !== shownFront || resend) {
        shownFront = xpm;
        elements.push(bitmap("front", xpm, 0, 0, "front"));
      }
      if (settled) {
        const key = backKey(show);
        if (key !== shownBack) {
          shownBack = key;
          const back = backElements(show);
          for (let i = 0; i < back.length; i++) elements.push(back[i]);
        }
      }
      return elements;
    },
    forget() {
      shownFront = shownBack = null;
    },
  };
}
