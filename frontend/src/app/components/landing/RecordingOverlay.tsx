import { useState, useRef } from 'react';
import { motion } from 'motion/react';

interface RecordingOverlayProps {
  onSubmit: (data: {
    title: string;
    mode: ProjectMode;
    videoFile?: File;
    audioFile?: File;
    extractAudio?: boolean;
  }) => void;
  onCancel: () => void;
}

export function RecordingOverlay({ onSubmit, onCancel }: RecordingOverlayProps) {
  const [title, setTitle] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [extractAudio, setExtractAudio] = useState(true);
  const [dragOver, setDragOver] = useState<'video' | 'audio' | null>(null);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (!title.trim()) return;
    if (!videoFile && !audioFile) return;

    onSubmit({
      title: title.trim(),
      mode: 'dance', // Always use dance mode
      videoFile: videoFile || undefined,
      audioFile: audioFile || undefined,
      extractAudio: videoFile && !audioFile ? extractAudio : undefined,
    });
  };

  const handleDrop = (e: React.DragEvent, type: 'video' | 'audio') => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (type === 'video' && file.type.startsWith('video/')) {
      setVideoFile(file);
    } else if (type === 'audio' && file.type.startsWith('audio/')) {
      setAudioFile(file);
    }
  };

  const isValid = title.trim() && (videoFile || audioFile);

  return (
    <motion.div
      className="absolute overflow-hidden"
      style={{
        width: 450,
        height: 450,
        left: 0,
        top: 50,
        zIndex: 20,
        background: 'rgba(10, 10, 10, 0.95)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '8px 10px 40px rgba(0,0,0,0.7)',
      }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
    >
      {/* Recording indicator */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <motion.div
          className="w-2 h-2 rounded-full bg-red-500"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        <span className="text-red-400 text-[10px] uppercase tracking-wider">Recording</span>
      </div>

      {/* Form content */}
      <div className="p-8 h-full flex flex-col">
        <div className="text-[11px] uppercase tracking-[0.2em] mb-2 text-neutral-500">new project</div>

        {/* Title input */}
        <input
          type="text"
          placeholder="프로젝트 제목"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-transparent border-b border-neutral-700 focus:border-neutral-400 outline-none text-white text-xl font-medium py-2 mb-6 transition-colors"
          autoFocus
        />

        {/* File upload areas */}
        <div className="flex-1 flex flex-col gap-3">
          {/* Video upload */}
          <div
            className="flex-1 border border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all"
            style={{
              borderColor: dragOver === 'video' ? '#d97706' : videoFile ? '#22c55e' : '#333',
              background: dragOver === 'video' ? 'rgba(217, 119, 6, 0.1)' : videoFile ? 'rgba(34, 197, 94, 0.05)' : 'transparent',
            }}
            onClick={() => videoInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver('video'); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, 'video')}
          >
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
            />
            {videoFile ? (
              <>
                <div className="text-green-400 text-sm mb-1">✓ {videoFile.name}</div>
                <div className="text-neutral-500 text-[10px]">{(videoFile.size / 1024 / 1024).toFixed(1)} MB</div>
              </>
            ) : (
              <>
                <div className="text-neutral-400 text-sm mb-1">비디오 파일</div>
                <div className="text-neutral-600 text-[10px]">클릭 또는 드래그</div>
              </>
            )}
          </div>

          {/* Extract audio toggle - only show when video exists and no audio */}
          {videoFile && !audioFile && (
            <div
              className="flex items-center justify-between px-3 py-2 rounded-lg transition-all cursor-pointer"
              style={{
                background: extractAudio ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${extractAudio ? '#22c55e44' : '#333'}`,
              }}
              onClick={() => setExtractAudio(!extractAudio)}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-4 rounded-full relative transition-all"
                  style={{
                    background: extractAudio ? '#22c55e' : '#333',
                  }}
                >
                  <div
                    className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                    style={{
                      left: extractAudio ? 'calc(100% - 14px)' : '2px',
                    }}
                  />
                </div>
                <span className="text-xs" style={{ color: extractAudio ? '#22c55e' : '#666' }}>
                  영상에서 오디오 추출
                </span>
              </div>
              <span className="text-[10px] text-neutral-500">
                {extractAudio ? '음악 분석 포함' : '모션만 분석'}
              </span>
            </div>
          )}

          {/* Audio upload */}
          <div
            className="flex-1 border border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all"
            style={{
              borderColor: dragOver === 'audio' ? '#d97706' : audioFile ? '#22c55e' : '#333',
              background: dragOver === 'audio' ? 'rgba(217, 119, 6, 0.1)' : audioFile ? 'rgba(34, 197, 94, 0.05)' : 'transparent',
              opacity: videoFile && extractAudio && !audioFile ? 0.5 : 1,
            }}
            onClick={() => audioInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver('audio'); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, 'audio')}
          >
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                setAudioFile(e.target.files?.[0] || null);
                if (e.target.files?.[0]) setExtractAudio(false);
              }}
            />
            {audioFile ? (
              <>
                <div className="text-green-400 text-sm mb-1">✓ {audioFile.name}</div>
                <div className="text-neutral-500 text-[10px]">{(audioFile.size / 1024 / 1024).toFixed(1)} MB</div>
              </>
            ) : (
              <>
                <div className="text-neutral-400 text-sm mb-1">
                  {videoFile && extractAudio ? '또는 별도 오디오 파일' : '오디오 파일 (선택)'}
                </div>
                <div className="text-neutral-600 text-[10px]">클릭 또는 드래그</div>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={onCancel}
            className="text-xs text-neutral-500 hover:text-white transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid}
            className="text-xs px-6 py-2 transition-all"
            style={{
              background: isValid ? '#d97706' : 'transparent',
              border: `1px solid ${isValid ? '#d97706' : '#333'}`,
              color: isValid ? '#000' : '#555',
              cursor: isValid ? 'pointer' : 'not-allowed',
            }}
          >
            녹음 완료 →
          </button>
        </div>
      </div>
    </motion.div>
  );
}
