import { Capacitor } from "@capacitor/core";

/**
 * One share entry point for both shells.
 *
 * Native builds go through the iOS share sheet (Messages, Mail, AirDrop);
 * the web falls back to `navigator.share` where it exists. Returning `false`
 * means neither was available and the caller should copy the link instead —
 * a share affordance that silently does nothing is worse than a copy button.
 *
 * A user dismissing the sheet rejects, exactly as `navigator.share` does; the
 * caller treats that as a no-op rather than an error worth showing.
 */

export const SHARE_TITLE = "Tally research";
export const SHARE_DIALOG_TITLE = "Send this research";

/** True inside the Capacitor shell, false in any browser. */
export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

export async function shareLink(url: string): Promise<boolean> {
  if (isNativeShell()) {
    const { Share } = await import("@capacitor/share");
    await Share.share({ title: SHARE_TITLE, url, dialogTitle: SHARE_DIALOG_TITLE });
    return true;
  }
  if (typeof navigator.share === "function") {
    await navigator.share({ title: SHARE_TITLE, url });
    return true;
  }
  return false;
}
