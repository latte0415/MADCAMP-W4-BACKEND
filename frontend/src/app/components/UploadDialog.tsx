import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { ProjectMode } from '../types';

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: (data: {
    title: string;
    mode: ProjectMode;
    video?: File;
    audio?: File;
  }) => void;
}

export function UploadDialog({ open, onClose, onUpload }: UploadDialogProps) {
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<ProjectMode>('dance');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      alert('Please enter a project title');
      return;
    }

    onUpload({
      title: title.trim(),
      mode,
      video: videoFile || undefined,
      audio: audioFile || undefined,
    });

    // Reset form
    setTitle('');
    setMode('dance');
    setVideoFile(null);
    setAudioFile(null);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Upload your video and audio files to start analyzing motion sync
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          {/* Project title */}
          <div className="space-y-2">
            <Label htmlFor="title" className="text-zinc-300">
              Project Title
            </Label>
            <Input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Enter project name"
              className="bg-zinc-950 border-white/10 text-white placeholder:text-zinc-600"
            />
          </div>

          {/* Mode selection */}
          <div className="space-y-2">
            <Label htmlFor="mode" className="text-zinc-300">
              Analysis Mode
            </Label>
            <Select value={mode} onValueChange={(value) => setMode(value as ProjectMode)}>
              <SelectTrigger className="bg-zinc-950 border-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10 text-white">
                <SelectItem value="dance">Dance (Hit/Hold based)</SelectItem>
                <SelectItem value="magic">Magic (Appear/Vanish + Hit/Hold)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Video upload */}
          <div className="space-y-2">
            <Label htmlFor="video" className="text-zinc-300">
              Video File
            </Label>
            <div className="relative">
              <Input
                id="video"
                type="file"
                accept="video/*"
                onChange={e => setVideoFile(e.target.files?.[0] || null)}
                className="bg-zinc-950 border-white/10 text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-white/10 file:text-zinc-300 hover:file:bg-white/20"
              />
              {videoFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setVideoFile(null)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
            {videoFile && (
              <p className="text-xs text-zinc-500">
                Selected: {videoFile.name}
              </p>
            )}
          </div>

          {/* Audio upload */}
          <div className="space-y-2">
            <Label htmlFor="audio" className="text-zinc-300">
              Audio File <span className="text-zinc-600">(Optional)</span>
            </Label>
            <div className="relative">
              <Input
                id="audio"
                type="file"
                accept="audio/*"
                onChange={e => setAudioFile(e.target.files?.[0] || null)}
                className="bg-zinc-950 border-white/10 text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-white/10 file:text-zinc-300 hover:file:bg-white/20"
              />
              {audioFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAudioFile(null)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
            {audioFile && (
              <p className="text-xs text-zinc-500">
                Selected: {audioFile.name}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1 bg-transparent border-white/10 hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500"
            >
              <Upload className="size-4" />
              Create Project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
