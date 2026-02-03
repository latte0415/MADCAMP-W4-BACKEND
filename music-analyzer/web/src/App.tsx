import { useCallback, useState } from "react";
import { AudioUploader } from "./components/AudioUploader";
import { JsonUploader } from "./components/JsonUploader";
import { WaveformWithOverlay } from "./components/WaveformWithOverlay";
import { Tab04EnergyView } from "./components/Tab04EnergyView";
import { TabEnergyBarView } from "./components/TabEnergyBarView";
import { DrumBandEnergyBarView } from "./components/DrumBandEnergyBarView";
import { Tab05ClarityView } from "./components/Tab05ClarityView";
import { Tab06TemporalView } from "./components/Tab06TemporalView";
import { Tab07SpectralView } from "./components/Tab07SpectralView";
import { Tab08ContextView } from "./components/Tab08ContextView";
import { Tab09LayerView } from "./components/Tab09LayerView";
import { StreamsSectionsView } from "./components/StreamsSectionsView";
import { Tab13DrumKeypointsView } from "./components/Tab13DrumKeypointsView";
import { LayerFilterPanel } from "./components/LayerFilterPanel";
import type { EventPoint } from "./types/event";
import type { EnergyJsonData } from "./types/energyEvent";
import type { ClarityJsonData } from "./types/clarityEvent";
import type { TemporalJsonData } from "./types/temporalEvent";
import type { SpectralJsonData } from "./types/spectralEvent";
import type { ContextJsonData } from "./types/contextEvent";
import type { StreamsSectionsData } from "./types/streamsSections";
import type { DrumBandEnergyJsonData } from "./types/drumBandEnergy";
import "./App.css";

type MainMode = "final" | "test";
type TabId = "01" | "03" | "04" | "04b" | "04c" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12" | "13" | "streams";

/** 최종본: 메인 파이프라인 결과만 (드럼 키포인트 + 기존 분석 탭) */
const TABS_FINAL: { id: TabId; label: string; samplePath: string }[] = [
  { id: "13", label: "드럼 키포인트", samplePath: "/streams_sections_cnn.json" },
  { id: "04", label: "04 Energy", samplePath: "/onset_events_energy.json" },
  { id: "05", label: "05 Clarity", samplePath: "/onset_events_clarity.json" },
  { id: "06", label: "06 Temporal", samplePath: "/onset_events_temporal.json" },
  { id: "07", label: "07 Spectral", samplePath: "/onset_events_spectral.json" },
  { id: "08", label: "08 Context", samplePath: "/onset_events_context.json" },
  { id: "09", label: "09 Layer (P0/P1/P2)", samplePath: "/onset_events_layered.json" },
];

/** 테스트·실험: 레거시·실험용 뷰 */
const TABS_TEST: { id: TabId; label: string; samplePath: string }[] = [
  { id: "01", label: "01 Explore", samplePath: "/onset_beats.json" },
  { id: "03", label: "03 Visualize", samplePath: "/onset_events.json" },
  { id: "04b", label: "04b Energy Bar (테스트)", samplePath: "/onset_events_energy.json" },
  { id: "04c", label: "04c Drum Band Energy", samplePath: "/drum_band_energy.json" },
  { id: "10", label: "10 Madmom Drum Band", samplePath: "/drum_band_madmom.json" },
  { id: "11", label: "11 CNN Band Onsets", samplePath: "/cnn_band_onsets.json" },
  { id: "12", label: "12 CNN Streams/Layers", samplePath: "/streams_sections_cnn.json" },
  { id: "streams", label: "스트림·파트 (레거시)", samplePath: "/streams_sections.json" },
];

function getUniqueLayers(events: EventPoint[]): string[] {
  const set = new Set(events.map((e) => e.layer));
  return Array.from(set);
}

const TABS_BY_MODE: Record<MainMode, typeof TABS_FINAL> = {
  final: TABS_FINAL,
  test: TABS_TEST,
};

function App() {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [mainMode, setMainMode] = useState<MainMode>("final");
  const [activeTab, setActiveTab] = useState<TabId>("13");
  const currentTabs = TABS_BY_MODE[mainMode];
  type TabEvents = Partial<Record<TabId, Array<EventPoint>>>;
  type TabLayers = Partial<Record<TabId, Set<string>>>;
  const [tabEvents, setTabEvents] = useState<TabEvents>({});
  const [tabVisibleLayers, setTabVisibleLayers] = useState<TabLayers>({});
  const [tabEnergyData, setTabEnergyData] = useState<Partial<Record<TabId, EnergyJsonData | null>>>({});
  const [tabClarityData, setTabClarityData] = useState<Partial<Record<TabId, ClarityJsonData | null>>>({});
  const [tabTemporalData, setTabTemporalData] = useState<Partial<Record<TabId, TemporalJsonData | null>>>({});
  const [tabSpectralData, setTabSpectralData] = useState<Partial<Record<TabId, SpectralJsonData | null>>>({});
  const [tabContextData, setTabContextData] = useState<Partial<Record<TabId, ContextJsonData | null>>>({});
  const [tabStreamsSectionsData, setTabStreamsSectionsData] = useState<Partial<Record<TabId, StreamsSectionsData | null>>>({});
  const [tabDrumBandData, setTabDrumBandData] = useState<Partial<Record<TabId, DrumBandEnergyJsonData | null>>>({});

  const handleJsonLoaded = useCallback(
    (newEvents: EventPoint[]) => {
      setTabEvents((prev) => ({ ...prev, [activeTab]: newEvents }));
      setTabVisibleLayers((prev) => ({
        ...prev,
        [activeTab]: new Set(getUniqueLayers(newEvents)),
      }));
    },
    [activeTab]
  );

  const handleEnergyLoaded = useCallback(
    (data: EnergyJsonData | null) => {
      setTabEnergyData((prev) => ({ ...prev, [activeTab]: data }));
    },
    [activeTab]
  );

  const handleClarityLoaded = useCallback(
    (data: ClarityJsonData | null) => {
      setTabClarityData((prev) => ({ ...prev, [activeTab]: data }));
    },
    [activeTab]
  );

  const handleTemporalLoaded = useCallback(
    (data: TemporalJsonData | null) => {
      setTabTemporalData((prev) => ({ ...prev, [activeTab]: data }));
    },
    [activeTab]
  );

  const handleSpectralLoaded = useCallback(
    (data: SpectralJsonData | null) => {
      setTabSpectralData((prev) => ({ ...prev, [activeTab]: data }));
    },
    [activeTab]
  );

  const handleContextLoaded = useCallback(
    (data: ContextJsonData | null) => {
      setTabContextData((prev) => ({ ...prev, [activeTab]: data }));
    },
    [activeTab]
  );

  const handleStreamsSectionsLoadedForTab = useCallback(
    (data: StreamsSectionsData | null) => {
      setTabStreamsSectionsData((prev) => ({ ...prev, [activeTab]: data }));
    },
    [activeTab]
  );

  const handleDrumBandEnergyLoaded = useCallback(
    (data: DrumBandEnergyJsonData | null) => {
      setTabDrumBandData((prev) => ({ ...prev, [activeTab]: data }));
    },
    [activeTab]
  );

  const toggleLayer = useCallback(
    (layer: string) => {
      setTabVisibleLayers((prev) => {
        const current = prev[activeTab] ?? new Set<string>();
        const next = new Set(current);
        if (next.has(layer)) next.delete(layer);
        else next.add(layer);
        return { ...prev, [activeTab]: next };
      });
    },
    [activeTab]
  );

  return (
    <div className="app">
      <h1>측정 가능한 뷰 — MVP</h1>

      <section className="upload-section">
        <AudioUploader onAudioLoaded={setAudioUrl} />
      </section>

      <section className="main-tabs-section">
        <div className="main-tabs-header">
          <button
            type="button"
            className={`main-tab-btn ${mainMode === "final" ? "active" : ""}`}
            onClick={() => {
              setMainMode("final");
              setActiveTab("13");
            }}
          >
            최종본
          </button>
          <button
            type="button"
            className={`main-tab-btn ${mainMode === "test" ? "active" : ""}`}
            onClick={() => {
              setMainMode("test");
              setActiveTab("01");
            }}
          >
            테스트·실험
          </button>
        </div>

        <section className="tabs-section">
          <div className="tabs-header">
            {currentTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {currentTabs.map((tab) =>
          activeTab === tab.id ? (
            <div key={tab.id} className="tab-panel active">
              <div className="tab-upload">
                <JsonUploader
                  onJsonLoaded={handleJsonLoaded}
                  onEnergyLoaded={tab.id === "04" || tab.id === "04b" ? handleEnergyLoaded : undefined}
                  onClarityLoaded={tab.id === "05" ? handleClarityLoaded : undefined}
                  onTemporalLoaded={tab.id === "06" ? handleTemporalLoaded : undefined}
                  onSpectralLoaded={tab.id === "07" ? handleSpectralLoaded : undefined}
                  onContextLoaded={tab.id === "08" ? handleContextLoaded : undefined}
                  onDrumBandEnergyLoaded={tab.id === "04c" || tab.id === "10" || tab.id === "11" ? handleDrumBandEnergyLoaded : undefined}
                  onStreamsSectionsLoaded={tab.id === "12" || tab.id === "13" || tab.id === "streams" ? handleStreamsSectionsLoadedForTab : undefined}
                  samplePath={tab.samplePath}
                  sampleLabel={`${tab.label} 샘플 로드`}
                />
              </div>

              <section className="controls-section">
                {tab.id === "04" ? (
                  <Tab04EnergyView
                    audioUrl={audioUrl}
                    energyData={tabEnergyData["04"] ?? null}
                  />
                ) : tab.id === "04b" ? (
                  <TabEnergyBarView
                    audioUrl={audioUrl}
                    energyData={tabEnergyData["04b"] ?? null}
                  />
                ) : tab.id === "04c" ? (
                  <DrumBandEnergyBarView
                    audioUrl={audioUrl}
                    drumBandData={tabDrumBandData["04c"] ?? null}
                  />
                ) : tab.id === "05" ? (
                  <Tab05ClarityView
                    audioUrl={audioUrl}
                    clarityData={tabClarityData["05"] ?? null}
                  />
                ) : tab.id === "06" ? (
                  <Tab06TemporalView
                    audioUrl={audioUrl}
                    temporalData={tabTemporalData["06"] ?? null}
                  />
                ) : tab.id === "07" ? (
                  <Tab07SpectralView
                    audioUrl={audioUrl}
                    spectralData={tabSpectralData["07"] ?? null}
                  />
                ) : tab.id === "08" ? (
                  <Tab08ContextView
                    audioUrl={audioUrl}
                    contextData={tabContextData["08"] ?? null}
                  />
                ) : tab.id === "09" ? (
                  <Tab09LayerView
                    audioUrl={audioUrl}
                    events={tabEvents["09"] ?? []}
                  />
                ) : tab.id === "10" ? (
                  <DrumBandEnergyBarView
                    audioUrl={audioUrl}
                    drumBandData={tabDrumBandData["10"] ?? null}
                  />
                ) : tab.id === "11" ? (
                  <DrumBandEnergyBarView
                    audioUrl={audioUrl}
                    drumBandData={tabDrumBandData["11"] ?? null}
                  />
                ) : tab.id === "12" ? (
                  <StreamsSectionsView
                    audioUrl={audioUrl}
                    data={tabStreamsSectionsData["12"] ?? null}
                  />
                ) : tab.id === "streams" ? (
                  <StreamsSectionsView
                    audioUrl={audioUrl}
                    data={tabStreamsSectionsData["streams"] ?? null}
                  />
                ) : tab.id === "13" ? (
                  <Tab13DrumKeypointsView
                    audioUrl={audioUrl}
                    data={tabStreamsSectionsData["13"] ?? null}
                  />
                ) : (
                  <>
                    <WaveformWithOverlay
                      audioUrl={audioUrl}
                      events={tabEvents[tab.id] ?? []}
                      visibleLayers={tabVisibleLayers[tab.id] ?? new Set()}
                    />
                    <div className="filter-section">
                      {(tabEvents[tab.id] ?? []).length > 0 && (
                        <p className="events-count">
                          포인트 {(tabEvents[tab.id] ?? []).length}개 로드됨
                        </p>
                      )}
                      <LayerFilterPanel
                        layers={getUniqueLayers(tabEvents[tab.id] ?? [])}
                        visibleLayers={tabVisibleLayers[tab.id] ?? new Set()}
                        onToggle={toggleLayer}
                      />
                    </div>
                  </>
                )}
              </section>
            </div>
          ) : null
        )}
        </section>
      </section>
    </div>
  );
}

export default App;
