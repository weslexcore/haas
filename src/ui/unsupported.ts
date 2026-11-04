import { rawUnavailableReason } from "../adapters/raw/raw-decoder";
import { isRawMimeType } from "../core/library/formats";
import type { PhotoRecord } from "../core/state/types";

/**
 * Why a photo shows no image. A RAW file names the missing requirement
 * (usually the cross-origin isolation headers), so the setup can be fixed.
 */
export function unsupportedMessage(photo: PhotoRecord): string {
  const reason = isRawMimeType(photo.mimeType) ? rawUnavailableReason() : null;
  return reason ? `${photo.fileName} is a RAW file, and RAW decoding is unavailable: ${reason}.` : `This browser can't display ${photo.fileName}.`;
}
