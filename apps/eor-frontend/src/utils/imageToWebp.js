/**
 * Convierte y optimiza cualquier archivo de imagen (JPG, PNG, WebP, AVIF, HEIC, etc.)
 * a formato WebP normalizado en proporción 3:4 (384x512 px) centrado.
 *
 * @param {File|Blob} file - Archivo de imagen seleccionado por el usuario.
 * @param {Object} [options]
 * @param {number} [options.maxWidth=384] - Ancho final en píxeles.
 * @param {number} [options.maxHeight=512] - Alto final en píxeles.
 * @param {number} [options.quality=0.82] - Calidad de compresión WebP (0 a 1).
 * @returns {Promise<{blob: Blob, previewUrl: string, width: number, height: number, sizeOriginal: number, sizeWebp: number}>}
 */
export async function convertImageToWebP(file, { maxWidth = 384, maxHeight = 512, quality = 0.82 } = {}) {
  if (!file) throw new Error('No se proporcionó ningún archivo de imagen.');

  let source;
  try {
    // createImageBitmap procesa la orientación EXIF automáticamente en navegadores modernos
    source = await createImageBitmap(file);
  } catch {
    // Fallback a elemento HTMLImageElement
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Formato de imagen no soportado o archivo corrupto.'));
      };
      img.src = url;
    });
  }

  const srcW = source.width;
  const srcH = source.height;
  if (!srcW || !srcH) {
    if (source.close) source.close();
    throw new Error('Dimensiones de imagen inválidas.');
  }

  // Proporción objetivo 3:4 (0.75) con recorte centrado (cover)
  const targetRatio = maxWidth / maxHeight;
  const sourceRatio = srcW / srcH;

  let sx = 0;
  let sy = 0;
  let sWidth = srcW;
  let sHeight = srcH;

  if (sourceRatio > targetRatio) {
    // La imagen es más ancha que 3:4 -> recortar excedente horizontal simétricamente
    sWidth = srcH * targetRatio;
    sx = (srcW - sWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    // La imagen es más alta que 3:4 -> recortar excedente vertical simétricamente
    sHeight = srcW / targetRatio;
    sy = (srcH - sHeight) / 2;
  }

  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
  canvas.height = maxHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if (source.close) source.close();
    throw new Error('No se pudo inicializar el contexto de Canvas 2D.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sWidth, sHeight, 0, 0, maxWidth, maxHeight);

  if (source.close) source.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          // Fallback a toDataURL si toBlob no genera resultado
          try {
            const dataUrl = canvas.toDataURL('image/webp', quality);
            const byteString = atob(dataUrl.split(',')[1]);
            const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            const fallbackBlob = new Blob([ab], { type: mimeString });
            return resolve({
              blob: fallbackBlob,
              previewUrl: URL.createObjectURL(fallbackBlob),
              width: maxWidth,
              height: maxHeight,
              sizeOriginal: file.size,
              sizeWebp: fallbackBlob.size
            });
          } catch (fallbackErr) {
            return reject(new Error('Error al generar blob WebP: ' + fallbackErr.message));
          }
        }

        resolve({
          blob,
          previewUrl: URL.createObjectURL(blob),
          width: maxWidth,
          height: maxHeight,
          sizeOriginal: file.size,
          sizeWebp: blob.size
        });
      },
      'image/webp',
      quality
    );
  });
}
