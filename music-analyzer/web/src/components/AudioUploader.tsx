import { useRef } from "react";

/** streams_sections_cnn.json과 같은 소스(sample_animal_spirits_3_45) 드럼 스템 */
const SAMPLE_AUDIO_PATH = "/sample_drums.wav";

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
    e.target.value = "";
  };

  const loadSample = () => {
    onAudioLoaded(SAMPLE_AUDIO_PATH);
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
      <button type="button" onClick={loadSample}>
        샘플 오디오 로드
      </button>
    </div>
  );
}
