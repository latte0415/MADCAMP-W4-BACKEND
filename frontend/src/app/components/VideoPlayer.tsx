import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Play } from 'lucide-react';

interface VideoPlayerProps {
  videoUrl?: string;
  isPlaying: boolean;
  onPlayPause: () => void;
  onTimeUpdate: (time: number) => void;
  currentTime: number;
  onDuration?: (duration: number) => void;
  muted?: boolean;
}

export interface VideoPlayerHandle {
  seek: (time: number) => void;
  getCurrentTime: () => number;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ videoUrl, isPlaying, onPlayPause, onTimeUpdate, currentTime, onDuration, muted = true }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const rafRef = useRef<number | null>(null);
    const vfcRef = useRef<number | null>(null);
    const isPlayingRef = useRef(isPlaying);

    useImperativeHandle(ref, () => ({
      seek: (time: number) => {
        if (videoRef.current) {
          videoRef.current.currentTime = time;
        }
      },
      getCurrentTime: () => {
        return videoRef.current?.currentTime || 0;
      },
    }));

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      isPlayingRef.current = isPlaying;
      if (isPlaying) {
        video.play();
      } else {
        video.pause();
      }
    }, [isPlaying]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      video.muted = muted;
      video.volume = muted ? 0 : 1;
    }, [muted]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const cancelLoop = () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (vfcRef.current !== null && typeof (video as any).cancelVideoFrameCallback === 'function') {
          (video as any).cancelVideoFrameCallback(vfcRef.current);
          vfcRef.current = null;
        }
      };

      const tickRaf = () => {
        if (!video || !isPlayingRef.current) return;
        onTimeUpdate(video.currentTime);
        rafRef.current = requestAnimationFrame(tickRaf);
      };

      const tickVideoFrame = (_now: number, metadata: { mediaTime?: number }) => {
        if (!video || !isPlayingRef.current) return;
        const t = Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime! : video.currentTime;
        onTimeUpdate(t);
        vfcRef.current = (video as any).requestVideoFrameCallback(tickVideoFrame);
      };

      const startLoop = () => {
        cancelLoop();
        if (!isPlayingRef.current) return;
        if (typeof (video as any).requestVideoFrameCallback === 'function') {
          vfcRef.current = (video as any).requestVideoFrameCallback(tickVideoFrame);
        } else {
          rafRef.current = requestAnimationFrame(tickRaf);
        }
      };

      const handleSeeking = () => {
        onTimeUpdate(video.currentTime);
      };

      const handleTimeUpdate = () => {
        onTimeUpdate(video.currentTime);
      };
      const handleLoadedMetadata = () => {
        if (Number.isFinite(video.duration)) {
          onDuration?.(video.duration);
        }
      };
      const handlePlay = () => {
        isPlayingRef.current = true;
        startLoop();
      };
      const handlePause = () => {
        isPlayingRef.current = false;
        cancelLoop();
      };

      startLoop();
      video.addEventListener('timeupdate', handleTimeUpdate);
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      video.addEventListener('seeking', handleSeeking);
      video.addEventListener('play', handlePlay);
      video.addEventListener('pause', handlePause);
      return () => {
        cancelLoop();
        video.removeEventListener('timeupdate', handleTimeUpdate);
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('seeking', handleSeeking);
        video.removeEventListener('play', handlePlay);
        video.removeEventListener('pause', handlePause);
      };
    }, [onTimeUpdate]);

    return (
      <div className="relative bg-neutral-950/80 rounded border border-neutral-800 overflow-hidden">
        {videoUrl ? (
          <div className="relative aspect-video bg-black flex items-center justify-center">
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              src={videoUrl}
              muted={muted}
            />
          </div>
        ) : (
          <div className="aspect-video bg-neutral-950/80 flex items-center justify-center">
            <div className="text-center text-neutral-500">
              <div className="size-16 mx-auto mb-3 rounded-full bg-neutral-900 flex items-center justify-center border border-neutral-800">
                <Play className="size-8" />
              </div>
              <p>No video loaded</p>
            </div>
          </div>
        )}
      </div>
    );
  }
);

VideoPlayer.displayName = 'VideoPlayer';
