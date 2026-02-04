import { useState, useRef } from 'react';
import { Project } from '../types';
import { Header } from './Header';
import { VideoPlayer, VideoPlayerHandle } from './VideoPlayer';
import { Timeline } from './Timeline';
import { Calendar, Clock, Activity } from 'lucide-react';

interface ProjectDetailProps {
  project: Project;
  onBack: () => void;
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function ProjectDetail({ project, onBack, userName = '게스트', onLogin, onLogout }: ProjectDetailProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);

  const handlePlayPause = () => {
    setIsPlaying(prev => !prev);
  };

  const handleTimeUpdate = (time: number) => {
    setCurrentTime(time);
  };

  const handleSeek = (time: number) => {
    videoPlayerRef.current?.seek(time);
    setCurrentTime(time);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Header onBack={onBack} showBack userName={userName} onLogin={onLogin} onLogout={onLogout} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Project meta */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white mb-3">{project.title}</h1>
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2 text-zinc-400">
                <Calendar className="size-4" />
                <span>Created {formatDate(project.createdAt)}</span>
              </div>
              {project.completedAt && (
                <div className="flex items-center gap-2 text-zinc-400">
                  <Clock className="size-4" />
                  <span>Completed {formatDate(project.completedAt)}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-zinc-400">
                <Activity className="size-4" />
                <span className="capitalize">{project.mode} Mode</span>
              </div>
            </div>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-zinc-900/50 rounded-lg border border-white/10 p-4">
              <div className="text-zinc-500 text-sm mb-1">Duration</div>
              <div className="text-white text-xl font-semibold">
                {formatDuration(project.duration)}
              </div>
            </div>
            <div className="bg-zinc-900/50 rounded-lg border border-white/10 p-4">
              <div className="text-zinc-500 text-sm mb-1">Music Keypoints</div>
              <div className="text-white text-xl font-semibold">
                {project.musicKeypoints.length}
              </div>
              <div className="text-xs text-zinc-600 mt-1">
                Low: {project.musicKeypoints.filter(k => k.frequency === 'low').length} | 
                Mid: {project.musicKeypoints.filter(k => k.frequency === 'mid').length} | 
                High: {project.musicKeypoints.filter(k => k.frequency === 'high').length}
              </div>
            </div>
            <div className="bg-zinc-900/50 rounded-lg border border-white/10 p-4">
              <div className="text-zinc-500 text-sm mb-1">Motion Keypoints</div>
              <div className="text-white text-xl font-semibold">
                {project.motionKeypoints.length}
              </div>
              <div className="text-xs text-zinc-600 mt-1">
                Hit: {project.motionKeypoints.filter(k => k.type === 'hit').length} | 
                Hold: {project.motionKeypoints.filter(k => k.type === 'hold').length} | 
                Appear: {project.motionKeypoints.filter(k => k.type === 'appear').length} | 
                Vanish: {project.motionKeypoints.filter(k => k.type === 'vanish').length}
              </div>
            </div>
          </div>

          {/* Video player */}
          <div className="mb-6">
            <VideoPlayer
              ref={videoPlayerRef}
              videoUrl={project.videoUrl}
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              onTimeUpdate={handleTimeUpdate}
              currentTime={currentTime}
            />
          </div>

          {/* Timeline */}
          <Timeline
            duration={project.duration}
            currentTime={currentTime}
            musicKeypoints={project.musicKeypoints}
            motionKeypoints={project.motionKeypoints}
            onSeek={handleSeek}
          />

          {/* Analysis insights */}
          <div className="mt-6 bg-zinc-900/50 rounded-lg border border-white/10 p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Analysis Insights</h3>
            <div className="space-y-2 text-sm text-zinc-400">
              <p>
                • Detected {project.musicKeypoints.length} musical keypoints across low, mid, and high frequencies
              </p>
              <p>
                • Identified {project.motionKeypoints.filter(k => k.type === 'hit').length} hit movements,{' '}
                {project.motionKeypoints.filter(k => k.type === 'hold').length} hold segments,{' '}
                {project.motionKeypoints.filter(k => k.type === 'appear').length} appear events, and{' '}
                {project.motionKeypoints.filter(k => k.type === 'vanish').length} vanish events
              </p>
              <p>
                • Average sync accuracy is optimal for {project.mode} performances
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
