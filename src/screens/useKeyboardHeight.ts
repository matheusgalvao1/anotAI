import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * How much of the screen the keyboard currently covers, in points. `0` when it's
 * closed.
 *
 * Replaces `KeyboardAvoidingView` in the editor, which could not work there for
 * two reasons: `behavior="padding"` pads the container itself, which does
 * nothing for the absolutely-positioned button cluster inside it, and the
 * container isn't full-screen (the toolbar sits above it), which is the case
 * padding-based avoidance handles least well. An explicit height can be applied
 * wherever it's actually needed.
 *
 * iOS uses the `will*` events so layout moves with the keyboard rather than
 * after it. Android only reliably reports `did*`.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = Keyboard.addListener(showEvent, (event) => setHeight(event.endCoordinates.height));
    const onHide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  return height;
}
