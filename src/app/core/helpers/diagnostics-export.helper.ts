/** The few members of `navigator` the export touches, so a spec can hand over a stand-in. */
export interface DiagnosticsExportNavigator {
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

export type DiagnosticsExportOutcome =
  /** It went where it was asked to go. */
  | 'done'
  /** The person closed the share sheet. Not a failure. */
  | 'cancelled'
  /** This browser has no way to do it. */
  | 'unsupported'
  | 'failed';

const MIME = 'text/plain;charset=utf-8';

/**
 * Gets the report off the device by whichever route the browser offers: the clipboard, the share
 * sheet, a download. Pure routing, and nothing here builds the text: it is handed a finished
 * string, because Safari only honours `share()` and `writeText()` while the tap that asked for
 * them is still the current user gesture, so any `await` between the tap and the call (building
 * the header takes several) would silently turn them into a `NotAllowedError`.
 *
 * The share sheet gets a `.txt` file where the browser can take one, not a long string: a few
 * hundred KB of text in the share sheet's `text` field is slow on iOS and arrives in some
 * targets truncated, whereas a file is attached whole.
 */
export class DiagnosticsExportHelper {

  static canShare(nav: DiagnosticsExportNavigator): boolean {
    return typeof nav.share === 'function';
  }

  static async share(nav: DiagnosticsExportNavigator, text: string, fileName: string): Promise<DiagnosticsExportOutcome> {
    if (!DiagnosticsExportHelper.canShare(nav)) return 'unsupported';

    try {
      const file = DiagnosticsExportHelper.file(text, fileName);
      if (file && nav.canShare?.({ files: [file] })) {
        await nav.share!({ files: [file], title: 'Diagnóstico do Elifoot 98' });
      } else {
        await nav.share!({ title: 'Diagnóstico do Elifoot 98', text });
      }
      return 'done';
    } catch (error) {
      // The sheet being dismissed is how most people answer it; anything else is a real failure.
      return (error as { name?: string } | null)?.name === 'AbortError' ? 'cancelled' : 'failed';
    }
  }

  /**
   * The clipboard API where there is one and the page is allowed to use it (a secure context),
   * otherwise the old `execCommand('copy')` on a hidden textarea.
   */
  static async copy(nav: DiagnosticsExportNavigator, doc: Document, text: string): Promise<DiagnosticsExportOutcome> {
    if (typeof nav.clipboard?.writeText === 'function') {
      try {
        await nav.clipboard.writeText(text);
        return 'done';
      } catch {
        // Refused (permissions, a non-secure context, the gesture lapsed): try the old way.
      }
    }
    return DiagnosticsExportHelper.copyWithSelection(doc, text) ? 'done' : 'failed';
  }

  /** Start a download of `text` as a file. The object URL outlives the click: Safari needs it for the save. */
  static download(doc: Document, text: string, fileName: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: MIME }));
    const link = doc.createElement('a');
    link.href = url;
    link.download = fileName;
    doc.body.appendChild(link);
    link.click();
    doc.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  private static file(text: string, fileName: string): File | null {
    try {
      return new File([text], fileName, { type: MIME });
    } catch {
      return null;
    }
  }

  private static copyWithSelection(doc: Document, text: string): boolean {
    const field = doc.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    // Off screen rather than display:none, which cannot be selected. 16px keeps iOS from zooming.
    field.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px';
    doc.body.appendChild(field);
    try {
      field.select();
      field.setSelectionRange(0, text.length);
      return doc.execCommand('copy');
    } catch {
      return false;
    } finally {
      doc.body.removeChild(field);
    }
  }
}
