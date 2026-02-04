import { useRef, useState } from "react";
import type { EventPoint } from "../types/event";
import type { EnergyJsonData } from "../types/energyEvent";
import type { ClarityJsonData } from "../types/clarityEvent";
import type { TemporalJsonData } from "../types/temporalEvent";
import type { SpectralJsonData } from "../types/spectralEvent";
import type { ContextJsonData } from "../types/contextEvent";
import type { StreamsSectionsData } from "../types/streamsSections";
import type { DrumBandEnergyJsonData } from "../types/drumBandEnergy";
import { parseEventsFromJson, parseEnergyJson, parseClarityJson, parseTemporalJson, parseSpectralJson, parseContextJson, parseStreamsSectionsJson, parseDrumBandEnergyJson } from "../utils/parseEvents";

interface JsonUploaderProps {
  onJsonLoaded: (events: EventPoint[]) => void;
  onEnergyLoaded?: (data: EnergyJsonData | null) => void;
  onClarityLoaded?: (data: ClarityJsonData | null) => void;
  onTemporalLoaded?: (data: TemporalJsonData | null) => void;
  onSpectralLoaded?: (data: SpectralJsonData | null) => void;
  onContextLoaded?: (data: ContextJsonData | null) => void;
  onStreamsSectionsLoaded?: (data: StreamsSectionsData | null) => void;
  onDrumBandEnergyLoaded?: (data: DrumBandEnergyJsonData | null) => void;
  samplePath: string;
  sampleLabel: string;
}

function processLoadedData(
  data: unknown,
  onJsonLoaded: (events: EventPoint[]) => void,
  onEnergyLoaded?: (data: EnergyJsonData | null) => void,
  onClarityLoaded?: (data: ClarityJsonData | null) => void,
  onTemporalLoaded?: (data: TemporalJsonData | null) => void,
  onSpectralLoaded?: (data: SpectralJsonData | null) => void,
  onContextLoaded?: (data: ContextJsonData | null) => void,
  onStreamsSectionsLoaded?: (data: StreamsSectionsData | null) => void,
  onDrumBandEnergyLoaded?: (data: DrumBandEnergyJsonData | null) => void
) {
  const events = parseEventsFromJson(data);
  onJsonLoaded(events);
  const energy = parseEnergyJson(data);
  onEnergyLoaded?.(energy ?? null);
  const clarity = parseClarityJson(data);
  onClarityLoaded?.(clarity ?? null);
  const temporal = parseTemporalJson(data);
  onTemporalLoaded?.(temporal ?? null);
  const spectral = parseSpectralJson(data);
  onSpectralLoaded?.(spectral ?? null);
  const context = parseContextJson(data);
  onContextLoaded?.(context ?? null);
  const streamsSections = parseStreamsSectionsJson(data);
  onStreamsSectionsLoaded?.(streamsSections ?? null);
  const drumBandEnergy = parseDrumBandEnergyJson(data);
  onDrumBandEnergyLoaded?.(drumBandEnergy ?? null);
}

export function JsonUploader({
  onJsonLoaded,
  onEnergyLoaded,
  onClarityLoaded,
  onTemporalLoaded,
  onSpectralLoaded,
  onContextLoaded,
  onStreamsSectionsLoaded,
  onDrumBandEnergyLoaded,
  samplePath,
  sampleLabel,
}: JsonUploaderProps) {
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [loadedInfo, setLoadedInfo] = useState<{ source: string; eventCount: number } | null>(null);
  const inputId = `json-upload-${samplePath.replace(/\W/g, "_")}`;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSampleError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        const events = parseEventsFromJson(data);
        processLoadedData(data, onJsonLoaded, onEnergyLoaded, onClarityLoaded, onTemporalLoaded, onSpectralLoaded, onContextLoaded, onStreamsSectionsLoaded, onDrumBandEnergyLoaded);
        setLoadedInfo({ source: file.name, eventCount: events.length });
      } catch (err) {
        console.error("JSON 파싱/처리 실패:", err);
        setSampleError(err instanceof Error ? err.message : "JSON 처리 실패");
        setLoadedInfo(null);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const loadSample = () => {
    setSampleError(null);
    fetch(samplePath)
      .then((res) => {
        if (!res.ok) throw new Error("파일 없음 (해당 노트북에서 JSON 생성 후 public 복사 필요)");
        return res.json();
      })
      .then((data) => {
        try {
          const events = parseEventsFromJson(data);
          processLoadedData(data, onJsonLoaded, onEnergyLoaded, onClarityLoaded, onTemporalLoaded, onSpectralLoaded, onContextLoaded, onStreamsSectionsLoaded, onDrumBandEnergyLoaded);
          setLoadedInfo({ source: `샘플 (${samplePath.replace(/^\//, "")})`, eventCount: events.length });
        } catch (err) {
          console.error("샘플 데이터 처리 실패:", err);
          setSampleError(err instanceof Error ? err.message : "데이터 처리 실패");
          setLoadedInfo(null);
        }
      })
      .catch((err) => {
        setSampleError(err instanceof Error ? err.message : "로드 실패");
        setLoadedInfo(null);
      });
  };

  return (
    <div className="uploader">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleChange}
        style={{ display: "none" }}
        id={inputId}
        aria-label="JSON 파일 선택"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
      >
        분석 JSON 업로드
      </button>
      <button type="button" onClick={loadSample} title={`${samplePath} 샘플`}>
        {sampleLabel}
      </button>
      {sampleError && <span className="uploader-error">{sampleError}</span>}
      {loadedInfo && (
        <span className="uploader-loaded">
          ✓ {loadedInfo.source} ({loadedInfo.eventCount}개 이벤트) 로드됨
        </span>
      )}
    </div>
  );
}
