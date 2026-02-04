import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Play, Pause } from 'lucide-react';
import { Button } from './ui/button';

interface VideoPlayerProps {
  videoUrl?: string;
  isPlaying: boolean;
  onPlayPause: () => void;
  onTimeUpdate: (time: number) => void;
  currentTime: number;
}

export interface VideoPlayerHandle {
  seek: (time: number) => void;
  getCurrentTime: () => number;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ videoUrl, isPlaying, onPlayPause, onTimeUpdate, currentTime }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);

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

      if (isPlaying) {
        video.play();
      } else {
        video.pause();
      }
    }, [isPlaying]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const handleTimeUpdate = () => {
        onTimeUpdate(video.currentTime);
      };

      video.addEventListener('timeupdate', handleTimeUpdate);
      return () => video.removeEventListener('timeupdate', handleTimeUpdate);
    }, [onTimeUpdate]);

    const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
      <div className="relative bg-neutral-950/80 rounded border border-neutral-800 overflow-hidden">
        {videoUrl ? (
          <div className="relative aspect-video bg-black flex items-center justify-center">
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              src={videoUrl}
            />
            
            {/* Custom overlay controls */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity">
              <div className="absolute bottom-0 left-0 right-0 p-6 flex items-center justify-between">
                <Button
                  onClick={onPlayPause}
                  size="lg"
                  className="rounded-full bg-amber-500/20 hover:bg-amber-500/30 backdrop-blur-md border border-amber-500/30"
                >
                  {isPlaying ? (
                    <Pause className="size-6 text-white" />
                  ) : (
                    <Play className="size-6 text-white ml-0.5" />
                  )}
                </Button>
                
                <div className="text-white font-medium text-xs uppercase tracking-widest bg-black/50 px-3 py-1.5 rounded-full backdrop-blur-md">
                  {formatTime(currentTime)}
                </div>
              </div>
            </div>
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
