import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Crop and resize a local photo with NO new native module, so it ships over
 * the air: the app has no image manipulator in its binary, but it does have
 * react-native-webview and expo-file-system. The photo is read as base64,
 * drawn onto a canvas in an invisible WebView, exported as a JPEG data URL and
 * written to the cache directory. The result is a file:// URI that the normal
 * upload path (fetch → blob → Storage) takes as is.
 *
 * `onResult(null)` on any failure (unreadable file, a format the WebView can't
 * decode, a timeout); the caller keeps the original photo then.
 */

export type CropJob = {
  uri: string;
  mimeType: string;
  /** The slice to keep, as fractions (0..1) of the image's width and height. */
  rect: { x: number; y: number; width: number; height: number };
  /** Output size in pixels (up to 1280x1600 for a flyer, 800x800 for a logo). */
  output: { width: number; height: number };
};

const TIMEOUT_MS = 25_000;
const JPEG_QUALITY = 0.9;

function pageFor(job: CropJob): string {
  const params = JSON.stringify({ rect: job.rect, output: job.output, quality: JPEG_QUALITY });
  // The image data arrives through injectJavaScript once the page is up, so
  // this markup stays small.
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(function () {
  var P = ${params};
  function send(m) { window.ReactNativeWebView.postMessage(m); }
  window.__crop = function (src) {
    var img = new Image();
    img.onload = function () {
      try {
        var W = img.naturalWidth, H = img.naturalHeight;
        var sx = Math.max(0, Math.round(P.rect.x * W));
        var sy = Math.max(0, Math.round(P.rect.y * H));
        var sw = Math.min(W - sx, Math.max(1, Math.round(P.rect.width * W)));
        var sh = Math.min(H - sy, Math.max(1, Math.round(P.rect.height * H)));
        var c = document.createElement('canvas');
        c.width = P.output.width; c.height = P.output.height;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        send(c.toDataURL('image/jpeg', P.quality));
      } catch (e) { send('ERR'); }
    };
    img.onerror = function () { send('ERR'); };
    img.src = src;
  };
  send('READY');
})();
</script></body></html>`;
}

export function CanvasCropper({ job, onResult }: { job: CropJob; onResult: (uri: string | null) => void }) {
  const webRef = useRef<WebView>(null);
  const settled = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const html = useMemo(() => pageFor(job), [job]);

  const finish = (uri: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onResultRef.current(uri);
  };

  useEffect(() => {
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMessage = async (e: WebViewMessageEvent) => {
    const data = e.nativeEvent.data || '';
    if (data === 'READY') {
      try {
        const b64 = await FileSystem.readAsStringAsync(job.uri, { encoding: 'base64' });
        const mime = /^image\/[\w.+-]+$/.test(job.mimeType) ? job.mimeType : 'image/jpeg';
        webRef.current?.injectJavaScript(`window.__crop(${JSON.stringify(`data:${mime};base64,${b64}`)});true;`);
      } catch {
        finish(null);
      }
      return;
    }
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(data);
    if (!m) return finish(null);
    try {
      const out = `${FileSystem.cacheDirectory}crop-${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(out, m[1], { encoding: 'base64' });
      finish(out);
    } catch {
      finish(null);
    }
  };

  return (
    <View pointerEvents="none" style={styles.hidden}>
      <WebView
        ref={webRef}
        source={{ html }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={onMessage}
        onError={() => finish(null)}
        // A big photo can take the WebView's renderer down. Unhandled on
        // Android that kills the whole app (a restart onto the dashboard);
        // handled, the original photo is kept instead.
        onRenderProcessGone={() => finish(null)}
        onContentProcessDidTerminate={() => finish(null)}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Off screen but laid out, so the WebView actually loads on both platforms.
  hidden: { position: 'absolute', left: -10, top: -10, width: 2, height: 2, opacity: 0 },
  web: { width: 2, height: 2, backgroundColor: 'transparent' },
});
