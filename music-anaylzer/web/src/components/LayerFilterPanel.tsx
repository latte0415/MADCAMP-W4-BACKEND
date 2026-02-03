interface LayerFilterPanelProps {
  layers: string[];
  visibleLayers: Set<string>;
  onToggle: (layer: string) => void;
}

export function LayerFilterPanel({
  layers,
  visibleLayers,
  onToggle,
}: LayerFilterPanelProps) {
  if (layers.length === 0) return null;

  return (
    <div className="layer-filter-panel">
      {layers.map((layer) => (
        <label key={layer} className="layer-toggle">
          <input
            type="checkbox"
            checked={visibleLayers.has(layer)}
            onChange={() => onToggle(layer)}
          />
          <span>{layer}</span>
        </label>
      ))}
    </div>
  );
}
