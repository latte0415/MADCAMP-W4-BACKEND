import { useRef } from "react";

interface AudioUploaderProps {
  onAudioLoaded: (url: string) => void;
}

export function AudioUploader({ onAudioLoaded }: AudioUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onAudioLoaded(url);
  };

  return (
    <div className="uploader">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={handleChange}
        style={{ display: "none" }}
      />
      <button type="button" onClick={() => inputRef.current?.click()}>
        오디오 파일 업로드
      </button>
    </div>
  );
}
