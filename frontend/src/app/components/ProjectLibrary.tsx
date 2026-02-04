import { Project } from '../types';
import { Header } from './Header';
import { Video, Music2, Plus, Clock, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from './ui/button';

interface ProjectLibraryProps {
  projects: Project[];
  onSelectProject: (project: Project) => void;
  onNewProject: () => void;
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function ProjectLibrary({ projects, onSelectProject, onNewProject, userName = '게스트', onLogin, onLogout }: ProjectLibraryProps) {
  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusIcon = (status: Project['status']) => {
    switch (status) {
      case 'done':
        return <CheckCircle2 className="size-4 text-green-500" />;
      case 'running':
        return <Loader2 className="size-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="size-4 text-zinc-500" />;
    }
  };

  const getStatusText = (status: Project['status']) => {
    switch (status) {
      case 'done':
        return 'Completed';
      case 'running':
        return 'Analyzing...';
      default:
        return 'Draft';
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      <Header userName={userName} onLogin={onLogin} onLogout={onLogout} />
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Projects</h1>
            <p className="text-zinc-400">
              Manage your motion sync analysis projects
            </p>
          </div>
          <Button
            onClick={onNewProject}
            className="gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500"
          >
            <Plus className="size-4" />
            New Project
          </Button>
        </div>

        {/* Projects grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(project => (
            <div
              key={project.id}
              onClick={() => project.status === 'done' && onSelectProject(project)}
              className={`group relative bg-zinc-900/50 rounded-lg border border-white/10 overflow-hidden transition-all ${
                project.status === 'done'
                  ? 'cursor-pointer hover:border-white/20 hover:bg-zinc-900/70'
                  : 'opacity-60 cursor-not-allowed'
              }`}
            >
              {/* Thumbnail */}
              <div className="aspect-video bg-zinc-950 flex items-center justify-center border-b border-white/5">
                <div className="relative size-16 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-600/20 flex items-center justify-center">
                  {project.mode === 'dance' ? (
                    <Video className="size-8 text-blue-400" />
                  ) : (
                    <Music2 className="size-8 text-purple-400" />
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors line-clamp-1">
                    {project.title}
                  </h3>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    {getStatusIcon(project.status)}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between text-zinc-500">
                    <span>Mode</span>
                    <span className="capitalize text-zinc-400">{project.mode}</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-500">
                    <span>Duration</span>
                    <span className="text-zinc-400">{formatDuration(project.duration)}</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-500">
                    <span>Status</span>
                    <span className="text-zinc-400">{getStatusText(project.status)}</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-500">
                    <span>Created</span>
                    <span className="text-zinc-400">{formatDate(project.createdAt)}</span>
                  </div>
                </div>

                {/* Stats */}
                <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-4 text-xs">
                  <div className="text-zinc-500">
                    <span className="text-zinc-400 font-medium">
                      {project.musicKeypoints.length}
                    </span>{' '}
                    music points
                  </div>
                  <div className="text-zinc-500">
                    <span className="text-zinc-400 font-medium">
                      {project.motionKeypoints.length}
                    </span>{' '}
                    motion points
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
