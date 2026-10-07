import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Marker, NavigationControl, Popup } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import './App.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const EARTHQUAKE_FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';
const DATA_REFRESH_INTERVAL = 5 * 60 * 1000;
const AUTO_RESUME_DELAY = 5000;
const SINGLE_CLICK_HIDE_DELAY = 1000;

// Small control styles live here to preserve custom App.css edits.
const PANEL_FOLD_STYLES = `
  .app-shell .panel-fold-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  }
  .app-shell .panel-fold-header h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .app-shell .panel-fold-button {
    display: inline-grid;
    place-items: center;
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    cursor: pointer;
  }
  .app-shell .panel-fold-button:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.6);
  }
  .app-shell .panel-fold-button:focus-visible {
    outline: 2px solid #75f0a7;
    outline-offset: 3px;
  }
  .app-shell .panel-folded {
    height: fit-content;
    min-height: 0;
    max-height: none;
  }
  .app-shell .panel-folded .panel-fold-header {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: 0;
  }
  .app-shell .fullscreen-icon-button {
    display: inline-grid;
    place-items: center;
    flex: 0 0 32px;
    width: 32px;
    height: 30px;
    min-height: 30px;
    padding: 0;
    border-radius: 8px;
    cursor: pointer;
  }
  .app-shell .fullscreen-icon-button:focus-visible {
    outline: 2px solid #75f0a7;
    outline-offset: 3px;
  }
  @media (max-width: 767px) {
    .app-shell .desktop-panel-title.panel-fold-header { display: none; }
    .app-shell .mobile-command-panel .control-grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) 36px;
      align-items: end;
    }
    .app-shell .mobile-command-panel .fullscreen-icon-button {
      grid-column: auto;
      width: 36px;
      height: 36px;
      min-height: 36px;
      padding: 0;
      border-radius: 10px;
    }
    .app-shell .restore-button.fullscreen-icon-button {
      width: 38px;
      height: 38px;
      min-height: 38px;
      padding: 0;
    }
  }
`;

function PanelFoldButton({ expanded, onClick, label, controls }) {
  return (
    <button
      className="panel-fold-button"
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
      title={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d={expanded ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function FullscreenIcon({ exit = false }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={exit ? 'M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3' : 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const MAP_STYLES = [
  { label: 'Telemetry', value: 'mapbox://styles/mapbox/dark-v11' },
  { label: 'Satellite', value: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { label: 'Ocean / Terrain', value: 'mapbox://styles/mapbox/outdoors-v12' },
  { label: 'Street', value: 'mapbox://styles/mapbox/streets-v12' },
];

const MAGNITUDE_LEGEND = [
  { label: '2.5 - 3.9', min: 2.5, max: 4, color: '#f4d03f' },
  { label: '4.0 - 4.9', min: 4, max: 5, color: '#f39c12' },
  { label: '5.0 - 5.9', min: 5, max: 6, color: '#e67e22' },
  { label: '6.0+', min: 6, max: Infinity, color: '#c0392b' },
];

function MagnitudeLegend() {
  return (
    <div className="legend-strip">
      {MAGNITUDE_LEGEND.map((item) => (
        <div className="legend-row" key={item.label}>
          <span className="legend-dot" style={{ backgroundColor: item.color, boxShadow: `0 0 10px ${item.color}` }} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// Calendar days follow the viewer's local timezone, matching popup dates.
function filterYesterdayAndToday(features, now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);

  return features.filter((quake) => {
    const time = quake.properties?.time;
    const magnitude = quake.properties?.mag;
    return Number.isFinite(time) && time >= start.getTime() && time <= now.getTime()
      && Number.isFinite(magnitude) && magnitude >= 2.5;
  });
}

function App() {
  const mapRef = useRef(null);
  const animationRef = useRef(null);
  const hideTimerRef = useRef(null);
  const autoRotateTimerRef = useRef(null);

  const [earthquakes, setEarthquakes] = useState([]);
  const earthquakeDataRef = useRef([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  const [rotationMode, setRotationMode] = useState(() => (window.innerWidth < 768 ? 'off' : 'auto'));
  const [isAutoPaused, setIsAutoPaused] = useState(false);
  const [isPointerOverMap, setIsPointerOverMap] = useState(false);
  const [isHoldingMap, setIsHoldingMap] = useState(false);

  const [mapStyle, setMapStyle] = useState(MAP_STYLES[1].value);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFeedOpen, setIsFeedOpen] = useState(() => window.innerWidth >= 768);
  const [isStatusOpen, setIsStatusOpen] = useState(() => window.innerWidth >= 768);
  const [isAnomalyFeedExpanded, setIsAnomalyFeedExpanded] = useState(true);

  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [stuckId, setStuckId] = useState(null);

  const rotationIsActive =
    rotationMode === 'on'
      ? !isHoldingMap
      : rotationMode === 'auto' && !isMobile && !isAutoPaused;

  useEffect(() => {
    earthquakeDataRef.current = earthquakes;
  }, [earthquakes]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return undefined;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(context.registerTool({
        name: 'read_recent_earthquakes',
        title: 'Read recent earthquakes',
        description: 'Read the earthquakes currently displayed on the globe for yesterday and today in the viewer local timezone. This does not change the map.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
            throw new Error('Expected an empty object.');
          }
          const events = earthquakeDataRef.current;
          return {
            source: 'USGS',
            count: events.length,
            earthquakes: events.map((quake) => ({
              id: quake.id,
              magnitude: quake.properties.mag,
              place: quake.properties.place,
              time: new Date(quake.properties.time).toISOString(),
              longitude: quake.geometry.coordinates[0],
              latitude: quake.geometry.coordinates[1],
            })),
          };
        },
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch {
      // Tool registration is optional; the normal map always remains usable.
    }
    return () => lifecycle.abort();
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const clearAllLabels = useCallback(() => {
    clearHideTimer();
    setHoveredId(null);
    setSelectedId(null);
    setStuckId(null);
  }, [clearHideTimer]);

  const clearAutoResumeTimer = useCallback(() => {
    if (autoRotateTimerRef.current) {
      clearTimeout(autoRotateTimerRef.current);
      autoRotateTimerRef.current = null;
    }
  }, []);

  const pauseAutoRotation = useCallback(() => {
    if (rotationMode !== 'auto' || isMobile) return;

    clearAutoResumeTimer();
    clearAllLabels();
    setIsAutoPaused(true);
  }, [clearAllLabels, clearAutoResumeTimer, isMobile, rotationMode]);

  const scheduleAutoRotationResume = useCallback(() => {
    if (rotationMode !== 'auto' || isMobile) return;

    clearAutoResumeTimer();
    autoRotateTimerRef.current = setTimeout(() => {
      clearAllLabels();
      setIsAutoPaused(false);
    }, AUTO_RESUME_DELAY);
  }, [clearAllLabels, clearAutoResumeTimer, isMobile, rotationMode]);

  useEffect(() => {
    let previousIsMobile = window.innerWidth < 768;
    const handleResize = () => {
      const nextIsMobile = window.innerWidth < 768;
      // Safari toolbar height changes should not reset the mobile panels.
      if (nextIsMobile && previousIsMobile) return;
      previousIsMobile = nextIsMobile;

      setIsMobile(nextIsMobile);
      setIsPointerOverMap(false);
      setIsHoldingMap(false);
      setIsAutoPaused(false);
      clearAutoResumeTimer();

      if (nextIsMobile) {
        setRotationMode((currentMode) => (currentMode === 'auto' ? 'off' : currentMode));
        setIsFeedOpen(false);
      } else {
        setIsFeedOpen(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clearAutoResumeTimer]);

  useEffect(() => {
    const controller = new AbortController();
    let requestInProgress = false;
    let midnightTimer;

    async function fetchEarthquakes() {
      if (controller.signal.aborted || requestInProgress) return;
      requestInProgress = true;

      // Remove expired events even if the network refresh fails.
      setEarthquakes((current) => filterYesterdayAndToday(current));
      try {
        setDataError('');

        const response = await fetch(EARTHQUAKE_FEED_URL, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`USGS request failed: ${response.status}`);
        }

        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.features)) {
          throw new Error('USGS returned an invalid earthquake feed.');
        }
        setEarthquakes(filterYesterdayAndToday(data.features));
      } catch (error) {
        if (error.name !== 'AbortError') {
          setDataError(error.message || 'Could not load earthquake data.');
        }
      } finally {
        requestInProgress = false;
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    function scheduleMidnightUpdate() {
      const nextMidnight = new Date();
      nextMidnight.setHours(24, 0, 0, 0);
      midnightTimer = setTimeout(() => {
        setEarthquakes((current) => filterYesterdayAndToday(current));
        fetchEarthquakes();
        scheduleMidnightUpdate();
      }, nextMidnight.getTime() - Date.now());
    }

    fetchEarthquakes();
    const refreshTimer = setInterval(fetchEarthquakes, DATA_REFRESH_INTERVAL);
    scheduleMidnightUpdate();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setEarthquakes((current) => filterYesterdayAndToday(current));
        fetchEarthquakes();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      controller.abort();
      clearInterval(refreshTimer);
      clearTimeout(midnightTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!rotationIsActive) return undefined;

    const rotateMap = () => {
      const map = mapRef.current?.getMap();
      if (!map) return;

      const currentCenter = map.getCenter();
      currentCenter.lng -= 0.08;
      map.jumpTo({ center: currentCenter, zoom: map.getZoom() });
      animationRef.current = requestAnimationFrame(rotateMap);
    };

    animationRef.current = requestAnimationFrame(rotateMap);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [rotationIsActive]);

  useEffect(() => {
    return () => {
      clearHideTimer();
      clearAutoResumeTimer();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [clearAutoResumeTimer, clearHideTimer]);

  const changeRotation = useCallback((mode) => {
    const nextMode = isMobile && mode === 'auto' ? 'off' : mode;

    clearAutoResumeTimer();
    clearAllLabels();
    setIsHoldingMap(false);
    setRotationMode(nextMode);

    if (nextMode === 'auto' && !isMobile && isPointerOverMap) {
      setIsAutoPaused(true);
    } else {
      setIsAutoPaused(false);
    }
  }, [clearAllLabels, clearAutoResumeTimer, isMobile, isPointerOverMap]);

  const handleMapMouseEnter = useCallback(() => {
    setIsPointerOverMap(true);

    if (rotationMode === 'auto' && !isMobile) {
      pauseAutoRotation();
    }
  }, [isMobile, pauseAutoRotation, rotationMode]);

  const handleMapMouseLeave = useCallback(() => {
    setIsPointerOverMap(false);
    setIsHoldingMap(false);

    if (rotationMode === 'auto' && !isMobile) {
      scheduleAutoRotationResume();
    }
  }, [isMobile, rotationMode, scheduleAutoRotationResume]);

  const handleMapMouseDown = useCallback(() => {
    clearAllLabels();

    if (rotationMode === 'on') {
      setIsHoldingMap(true);
      return;
    }

    if (rotationMode === 'auto' && !isMobile) {
      pauseAutoRotation();
    }
  }, [clearAllLabels, isMobile, pauseAutoRotation, rotationMode]);

  const handleMapMouseUp = useCallback(() => {
    if (rotationMode === 'on') {
      setIsHoldingMap(false);
    }
  }, [rotationMode]);

  const handleMapNavigationStart = useCallback(() => {
    clearAllLabels();

    if (rotationMode === 'auto' && !isMobile) {
      pauseAutoRotation();
    }
  }, [clearAllLabels, isMobile, pauseAutoRotation, rotationMode]);

  const handleMapNavigationEnd = useCallback(() => {
    if (rotationMode === 'auto' && !isMobile && !isPointerOverMap) {
      scheduleAutoRotationResume();
    }
  }, [isMobile, isPointerOverMap, rotationMode, scheduleAutoRotationResume]);

  const getUSGSMagColor = useCallback((magnitude) => {
    if (magnitude >= 6) return '#c0392b';
    if (magnitude >= 5) return '#e67e22';
    if (magnitude >= 4) return '#f39c12';
    return '#f4d03f';
  }, []);

  const getMarkerSize = useCallback((magnitude) => {
    return Math.max(10, Math.min(44, 7 + magnitude * magnitude * 0.85));
  }, []);

  const recentQuakes = useMemo(() => {
    return [...earthquakes]
      .sort((a, b) => b.properties.time - a.properties.time)
      .slice(0, 20);
  }, [earthquakes]);

  const strongestQuake = useMemo(() => {
    if (!earthquakes.length) return null;
    return earthquakes.reduce((strongest, quake) => {
      const strongestMag = Number(strongest.properties.mag ?? -Infinity);
      const quakeMag = Number(quake.properties.mag ?? -Infinity);
      return quakeMag > strongestMag ? quake : strongest;
    }, earthquakes[0]);
  }, [earthquakes]);

  const mapIsBlocked = !MAPBOX_TOKEN;
  const statusLabel = isLoading ? 'Loading' : dataError ? 'Error' : 'Live';

  const controlsMarkup = (
    <div className="control-grid">
      <label className="control-field">
        <span>Rotation</span>
        <select value={rotationMode} onChange={(event) => changeRotation(event.target.value)}>
          {!isMobile && <option value="auto">Auto</option>}
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>

      <label className="control-field">
        <span>Layer</span>
        <select value={mapStyle} onChange={(event) => setMapStyle(event.target.value)}>
          {MAP_STYLES.map((style) => (
            <option key={style.value} value={style.value}>{style.label}</option>
          ))}
        </select>
      </label>

      <button
        className="fullscreen-button fullscreen-icon-button"
        type="button"
        onClick={() => setIsFullscreen(true)}
        aria-label="Fullscreen"
        title="Fullscreen"
      >
        <FullscreenIcon />
      </button>
    </div>
  );

  return (
    <div className="app-shell">
      <style>{PANEL_FOLD_STYLES}</style>
      {mapIsBlocked ? (
        <div className="missing-token-panel">
          <h1>Missing Mapbox token</h1>
          <p>Create <code>.env.local</code> in the project root and add:</p>
          <pre>VITE_MAPBOX_TOKEN=your_mapbox_token_here</pre>
          <p>Then restart <code>npm run dev</code>.</p>
        </div>
      ) : (
        <Map
          ref={mapRef}
          initialViewState={{ longitude: -80.1, latitude: 25.8, zoom: isMobile ? 0.8 : 1.45 }}
          mapStyle={mapStyle}
          mapboxAccessToken={MAPBOX_TOKEN}
          projection="globe"
          doubleClickZoom={false}
          onMouseEnter={handleMapMouseEnter}
          onMouseLeave={handleMapMouseLeave}
          onMouseDown={handleMapMouseDown}
          onMouseUp={handleMapMouseUp}
          onDragStart={handleMapNavigationStart}
          onZoomStart={handleMapNavigationStart}
          onRotateStart={handleMapNavigationStart}
          onPitchStart={handleMapNavigationStart}
          onDragEnd={handleMapNavigationEnd}
          onZoomEnd={handleMapNavigationEnd}
          onRotateEnd={handleMapNavigationEnd}
          onPitchEnd={handleMapNavigationEnd}
          onClick={clearAllLabels}
        >
          <NavigationControl position="bottom-right" showCompass={!isFullscreen} />

          {earthquakes.map((quake) => {
            const id = quake.id;
            const magnitude = Number(quake.properties.mag ?? 0);
            const [longitude, latitude] = quake.geometry.coordinates;
            const color = getUSGSMagColor(magnitude);
            const size = getMarkerSize(magnitude);
            const labelIsVisible = !rotationIsActive && (hoveredId === id || selectedId === id || stuckId === id);

            return (
              <Fragment key={id}>
                <Marker longitude={longitude} latitude={latitude} anchor="center">
                  <button
                    type="button"
                    className="quake-marker"
                    aria-label={`${magnitude.toFixed(1)} magnitude earthquake, ${quake.properties.place}`}
                    style={{
                      width: size,
                      height: size,
                      borderColor: color,
                      backgroundColor: `${color}66`,
                      boxShadow: `0 0 ${Math.max(8, size / 2)}px ${color}99`,
                    }}
                    onMouseEnter={() => {
                      if (rotationIsActive) return;
                      clearHideTimer();
                      setHoveredId(id);
                    }}
                    onMouseLeave={() => {
                      setHoveredId(null);
                      if (selectedId === id && stuckId !== id) {
                        hideTimerRef.current = setTimeout(() => {
                          setSelectedId((currentId) => (currentId === id ? null : currentId));
                        }, SINGLE_CLICK_HIDE_DELAY);
                      }
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (rotationIsActive) return;
                      clearHideTimer();
                      setSelectedId(id);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (rotationIsActive) return;
                      clearHideTimer();
                      setSelectedId(null);
                      setStuckId(id);
                    }}
                  />
                </Marker>

                {labelIsVisible && (
                  <Popup
                    longitude={longitude}
                    latitude={latitude}
                    closeButton={false}
                    closeOnClick={false}
                    anchor="bottom"
                    offset={size / 2 + 6}
                    className="quake-popup"
                  >
                    <div className="quake-popup-card" style={{ borderColor: color }}>
                      <strong style={{ color }}>{magnitude.toFixed(1)} M</strong>
                      <span>{quake.properties.place}</span>
                      <small>{new Date(quake.properties.time).toLocaleString()}</small>
                    </div>
                  </Popup>
                )}
              </Fragment>
            );
          })}
        </Map>
      )}

      {isFullscreen ? (
        <button
          className="restore-button fullscreen-icon-button"
          type="button"
          onClick={() => setIsFullscreen(false)}
          aria-label="Exit Fullscreen"
          title="Exit Fullscreen"
        >
          <FullscreenIcon exit />
        </button>
      ) : (
        <>
          {!isMobile && (
            <section className="control-panel top-panel" aria-label="Map controls">
              {controlsMarkup}
            </section>
          )}

          <aside className={`hud-panel status-panel ${isMobile ? 'mobile-command-panel' : ''} ${!isStatusOpen ? 'panel-folded' : ''} ${isMobile && !isStatusOpen ? 'mobile-command-panel-collapsed' : ''}`}>
            {isMobile && (
              <div className="mobile-info-bar">
                <div className="mobile-info-legend" role="group" aria-label="Magnitude scale">
                  <MagnitudeLegend />
                </div>
                {!isFeedOpen && (
                  <button
                    className="mobile-feed-button"
                    type="button"
                    onClick={() => setIsFeedOpen(true)}
                    aria-label="Show anomaly feed"
                    aria-controls="global-feed-panel"
                    aria-expanded={isFeedOpen}
                  >
                    Feed
                  </button>
                )}
              </div>
            )}
            <button
              className="mobile-panel-header"
              type="button"
              onClick={() => setIsStatusOpen((currentValue) => !currentValue)}
              aria-expanded={isStatusOpen}
              aria-controls="system-status-content"
            >
              <span className="panel-title">System</span>
              <span className="panel-live-dot" />
              <span className="panel-mini-stat">{earthquakes.length || '—'} signals</span>
              <span className="panel-chevron">{isStatusOpen ? '⌃' : '⌄'}</span>
            </button>

            <div className="desktop-panel-title panel-fold-header">
              <h2>System Status</h2>
              <PanelFoldButton
                expanded={isStatusOpen}
                onClick={() => setIsStatusOpen((currentValue) => !currentValue)}
                label="System Status"
                controls="system-status-content"
              />
            </div>

            {isStatusOpen && (
              <div id="system-status-content">
                {isMobile && controlsMarkup}

                <div className="metric-grid">
                  <div className="metric-card"><span>Signals</span><strong>{earthquakes.length}</strong></div>
                  <div className="metric-card"><span>Source</span><strong>USGS</strong></div>
                  <div className="metric-card"><span>Feed</span><strong>M2.5+ / Yesterday + Today</strong></div>
                  <div className="metric-card"><span>Status</span><strong>{statusLabel}</strong></div>
                </div>

                {strongestQuake && (
                  <div className="strongest-card">
                    <span>Strongest</span>
                    <strong>{Number(strongestQuake.properties.mag ?? 0).toFixed(1)} M</strong>
                    <small>{strongestQuake.properties.place}</small>
                  </div>
                )}
                {dataError && <p className="error-text">{dataError}</p>}
              </div>
            )}
          </aside>

          {!isMobile && (
            <aside className="hud-panel legend-panel" aria-label="Magnitude scale">
              <h2>Magnitude</h2>
              <MagnitudeLegend />
            </aside>
          )}

          <aside id="global-feed-panel" className={`hud-panel feed-panel ${!isAnomalyFeedExpanded ? 'panel-folded' : ''} ${isMobile && !isFeedOpen ? 'feed-panel-closed' : ''}`}>
            <div className="feed-header panel-fold-header">
              <h2>Global Feed</h2>
              <PanelFoldButton
                expanded={isAnomalyFeedExpanded}
                onClick={() => setIsAnomalyFeedExpanded((currentValue) => !currentValue)}
                label="Global Feed"
                controls="anomaly-feed-content"
              />
              {isMobile && (
                <button className="feed-close-button" type="button" onClick={() => setIsFeedOpen(false)} aria-label="Close anomaly feed">
                  ×
                </button>
              )}
            </div>
            {isAnomalyFeedExpanded && <div className="feed-list" id="anomaly-feed-content">
              {recentQuakes.map((quake) => {
                const magnitude = Number(quake.properties.mag ?? 0);
                const color = getUSGSMagColor(magnitude);

                return (
                  <button
                    className="feed-entry"
                    key={quake.id}
                    type="button"
                    style={{ borderLeftColor: color }}
                    onClick={() => {
                      const map = mapRef.current?.getMap();
                      const [longitude, latitude] = quake.geometry.coordinates;
                      clearAllLabels();
                      changeRotation('off');
                      setSelectedId(quake.id);
                      map?.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 3), duration: 900 });
                    }}
                  >
                    <strong style={{ color }}>{magnitude.toFixed(1)} M</strong>
                    <span>{quake.properties.place}</span>
                    <small>{new Date(quake.properties.time).toLocaleString()}</small>
                  </button>
                );
              })}
            </div>}
          </aside>

        </>
      )}
    </div>
  );
}

export default App;
