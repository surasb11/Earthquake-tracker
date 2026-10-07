import { useEffect, useRef, useState } from 'react';
import earthImage from './assets/intro-earth.jpg';
import { createIntroGlobe } from './introGlobe';
import './TrackerIntro.css';

const INTRO_DURATION = 3600;
const FADE_DURATION = 700;

export default function TrackerIntro({ earthquakes, onComplete }) {
  const overlayRef = useRef(null);
  const canvasRef = useRef(null);
  const markersRef = useRef(null);
  const earthquakesRef = useRef(earthquakes);
  const finishRef = useRef(null);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => { earthquakesRef.current = earthquakes; }, [earthquakes]);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const overlay = overlayRef.current;
    let frame;
    let introTimer;
    let fadeTimer;
    let renderer;
    let observer;
    let leaving = false;
    let finished = false;
    const complete = (restoreFocus) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(introTimer);
      clearTimeout(fadeTimer);
      observer?.disconnect();
      renderer?.destroy();
      onComplete(restoreFocus);
    };
    const reveal = (immediate = false) => {
      if (finished) return;
      const restoreFocus = overlay.contains(document.activeElement);
      if (immediate) { complete(restoreFocus); return; }
      if (leaving) return;
      leaving = true;
      clearTimeout(introTimer);
      setIsLeaving(true);
      // Leave the real tracker mounted and the intro absorbing input until the
      // crossfade completes, so a Skip click cannot select a marker beneath it.
      fadeTimer = setTimeout(() => complete(restoreFocus), FADE_DURATION);
    };
    finishRef.current = () => reveal();
    const onReducedMotionChange = () => { if (reducedMotion.matches) reveal(true); };
    const onKeyDown = (event) => { if (event.key === 'Escape') reveal(); };
    reducedMotion.addEventListener('change', onReducedMotionChange);
    document.addEventListener('keydown', onKeyDown);

    if (reducedMotion.matches) {
      reveal(true);
    } else {
      try {
        renderer = createIntroGlobe(canvasRef.current, markersRef.current, earthImage, () => reveal(true));
        observer = new ResizeObserver(() => renderer.resize(overlay.clientWidth, overlay.clientHeight));
        observer.observe(overlay);
        renderer.resize(overlay.clientWidth, overlay.clientHeight);
        const start = performance.now();
        const draw = (now) => {
          if (finished) return;
          const progress = Math.min(1, (now - start) / INTRO_DURATION);
          renderer.draw(progress, earthquakesRef.current);
          overlay.style.setProperty('--intro-closing', Math.max(0, (progress - 0.81) / 0.19));
          overlay.style.setProperty('--intro-signal-offset', 220 * (1 - Math.min(1, progress / 0.65)));
          frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        introTimer = setTimeout(() => reveal(), INTRO_DURATION);
      } catch {
        // A failed intro must never prevent access to the actual tracker.
        reveal(true);
      }
    }

    return () => {
      finished = true;
      finishRef.current = null;
      cancelAnimationFrame(frame);
      clearTimeout(introTimer);
      clearTimeout(fadeTimer);
      observer?.disconnect();
      renderer?.destroy();
      reducedMotion.removeEventListener('change', onReducedMotionChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onComplete]);

  return (
    <section ref={overlayRef} className={`tracker-intro${isLeaving ? ' tracker-intro-leaving' : ''}`} aria-label="Earthquake Tracker introduction">
      <div className="intro-stars" aria-hidden="true" />
      <canvas ref={canvasRef} className="intro-globe" role="img" aria-label="Satellite Earth rotating toward the Americas" />
      <canvas ref={markersRef} className="intro-markers" aria-hidden="true" />
      <div className="intro-title">
        <div className="intro-eyebrow">Global seismic activity</div>
        <h1>Earthquake Tracker</h1>
        <p>Explore the Earth's latest movements.</p>
        <svg className="intro-signal" viewBox="0 0 180 25" aria-hidden="true">
          <defs><linearGradient id="intro-seismic-color"><stop offset="0" stopColor="#f4d03f" /><stop offset=".5" stopColor="#f39c12" /><stop offset="1" stopColor="#c0392b" /></linearGradient></defs>
          <path d="M0 12 H50 L59 9 L65 18 L72 2 L80 23 L88 7 L97 15 L106 12 H180" />
        </svg>
      </div>
      <span className="intro-status">USGS · M2.5+ · Yesterday + today</span>
      <div className="intro-controls"><button type="button" onClick={() => finishRef.current?.()}>Skip intro</button></div>
    </section>
  );
}
