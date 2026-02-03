interface HeightRangeSliderProps {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
  disabled?: boolean;
}

const SLIDER_MIN = 0;
const SLIDER_MAX = 1;
const STEP = 0.01;

export function HeightRangeSlider({
  min,
  max,
  onChange,
  disabled,
}: HeightRangeSliderProps) {
  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    onChange(v, Math.max(v, max));
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    onChange(Math.min(v, min), v);
  };

  return (
    <div className="height-range-slider">
      <label className="height-range-label">높이(질감) 범위</label>
      <div className="height-range-inputs">
        <input
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={STEP}
          value={min}
          onChange={handleMinChange}
          disabled={disabled}
          className="height-range-min"
        />
        <input
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={STEP}
          value={max}
          onChange={handleMaxChange}
          disabled={disabled}
          className="height-range-max"
        />
      </div>
      <span className="height-range-value">
        {min.toFixed(2)} ~ {max.toFixed(2)}
      </span>
    </div>
  );
}
