export type PortraitCapture = {
  stream: MediaStream;
  stop: () => void;
};

export function createPortraitCapture(video: HTMLVideoElement, source: MediaStream): PortraitCapture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const context = canvas.getContext("2d");
  const stream = canvas.captureStream?.(30);
  if (!context || !stream) return null;

  let frame = 0;
  const draw = () => {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (sourceWidth && sourceHeight) {
      const targetRatio = canvas.width / canvas.height;
      const sourceRatio = sourceWidth / sourceHeight;
      const cropWidth = sourceRatio > targetRatio ? sourceHeight * targetRatio : sourceWidth;
      const cropHeight = sourceRatio > targetRatio ? sourceHeight : sourceWidth / targetRatio;
      const cropX = (sourceWidth - cropWidth) / 2;
      const cropY = (sourceHeight - cropHeight) / 2;
      context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    }
    frame = window.requestAnimationFrame(draw);
  };
  draw();
  source.getAudioTracks().forEach((track) => stream.addTrack(track));

  return {
    stream,
    stop: () => {
      window.cancelAnimationFrame(frame);
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
