export type MediaPermissionKind = 'microphone' | 'camera';

export interface MediaBlockDiagnosis {
  isBlocked: boolean;
  isIframeBlocked: boolean;
  isUnsupported: boolean;
  title: string;
  message: string;
}

export function isEmbeddedIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export async function queryMediaPermissionState(
  kind: MediaPermissionKind
): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'unknown';
  }
  try {
    const result = await navigator.permissions.query({
      name: kind as PermissionName,
    });
    return result.state;
  } catch {
    return 'unknown';
  }
}

export async function diagnoseMediaAccessFailure(
  kind: MediaPermissionKind,
  err: any
): Promise<MediaBlockDiagnosis> {
  const label = kind === 'microphone' ? 'Microphone' : 'Camera';
  const errName = String(err?.name || '');
  const errMsg = String(err?.message || '');
  const lower = errMsg.toLowerCase();

  if (
    errMsg === 'UNSUPPORTED_MEDIA' ||
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    return {
      isBlocked: false,
      isIframeBlocked: isEmbeddedIframe(),
      isUnsupported: true,
      title: `${label} Unavailable`,
      message: `Live ${label.toLowerCase()} capture is unavailable in this browser context. Open in a full HTTPS browser tab or upload a file directly.`,
    };
  }

  const permissionState = await queryMediaPermissionState(kind);
  const inIframe = isEmbeddedIframe();
  const isDeniedError =
    errName === 'NotAllowedError' ||
    errName === 'PermissionDeniedError' ||
    errName === 'SecurityError' ||
    lower.includes('denied') ||
    lower.includes('permission') ||
    lower.includes('not allowed');

  if (isDeniedError) {
    // When browser reports permission granted/prompt or frame blocks getUserMedia, the host iframe Permissions-Policy is blocking hardware delegation
    const likelyIframeRestriction =
      inIframe && (permissionState === 'granted' || lower.includes('policy') || lower.includes('disallowed'));

    if (likelyIframeRestriction || inIframe) {
      return {
        isBlocked: true,
        isIframeBlocked: true,
        isUnsupported: false,
        title: `${label} Blocked by Preview Frame`,
        message:
          permissionState === 'granted'
            ? `Your browser allows ${label.toLowerCase()} access, but the embedded preview container blocks hardware streams. Click "Open in Full Tab" below for direct access, or use file upload.`
            : `${label} access is restricted inside this embedded frame. Click "Open in Full Tab" below or allow ${label.toLowerCase()} access in your browser bar.`,
      };
    }

    return {
      isBlocked: true,
      isIframeBlocked: false,
      isUnsupported: false,
      title: `${label} Access Blocked`,
      message: `Your browser blocked ${label.toLowerCase()} access for this site. Click the site-info icon beside the URL, set ${label} to Allow, and retry.`,
    };
  }

  if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError' || errName === 'OverconstrainedError') {
    return {
      isBlocked: false,
      isIframeBlocked: false,
      isUnsupported: false,
      title: `No ${label} Detected`,
      message: `No active ${label.toLowerCase()} input device was detected on your device. Check hardware connections or use file upload below.`,
    };
  }

  if (errName === 'NotReadableError' || errName === 'TrackStartError') {
    return {
      isBlocked: false,
      isIframeBlocked: false,
      isUnsupported: false,
      title: `${label} Busy`,
      message: `Another application or browser tab is currently holding exclusive access to your ${label.toLowerCase()}.`,
    };
  }

  return {
    isBlocked: false,
    isIframeBlocked: false,
    isUnsupported: false,
    title: `${label} Setup Failed`,
    message: errMsg || `Unable to initialize ${label.toLowerCase()} hardware cleanly.`,
  };
}
