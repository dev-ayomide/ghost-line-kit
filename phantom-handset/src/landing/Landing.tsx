import { handsetConfig } from '../config/handset-config';
import { useReducedMotion } from '../state/useReducedMotion';
import { Stage } from '../ui/Stage';
import { Graveyard } from './Graveyard';

const { copy } = handsetConfig;
const land = copy.landing;

/** Decorative sky: moon, fog, LCD glow, ghost pixels and a skyline of masts. All aria-hidden. */
function Atmosphere() {
  return (
    <div className="hero__atmosphere" aria-hidden="true">
      <div className="hero__glow" />
      <div className="hero__moon-glow" />
      <svg className="hero__moon" viewBox="0 0 120 120" focusable="false" aria-hidden="true">
        <defs>
          <radialGradient id="moon-fill" cx="38%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#f4efd8" />
            <stop offset="100%" stopColor="#bdb596" />
          </radialGradient>
        </defs>
        <circle cx="60" cy="60" r="52" fill="url(#moon-fill)" />
        <circle cx="42" cy="46" r="9" fill="#a79f82" opacity="0.55" />
        <circle cx="76" cy="70" r="12" fill="#a79f82" opacity="0.45" />
        <circle cx="64" cy="34" r="5" fill="#a79f82" opacity="0.5" />
      </svg>
      <span className="pixel pixel--1" />
      <span className="pixel pixel--2" />
      <span className="pixel pixel--3" />
      <span className="pixel pixel--4" />
      <span className="pixel pixel--5" />
      <svg
        className="hero__skyline"
        viewBox="0 0 1200 170"
        preserveAspectRatio="xMidYMax slice"
        focusable="false"
        aria-hidden="true"
      >
        <g className="skyline__shape">
          <polygon points="0,170 0,150 90,142 170,150 260,138 380,148 520,140 640,150 760,141 900,150 1020,140 1120,148 1200,142 1200,170" />
          {/* lattice tower */}
          <polygon points="180,150 196,40 204,40 220,150 212,150 200,64 188,150" />
          <rect x="188" y="76" width="24" height="3" />
          <rect x="190" y="104" width="20" height="3" />
          <rect x="192" y="128" width="16" height="3" />
          <rect x="198" y="26" width="4" height="16" />
          {/* mast with panels */}
          <rect x="468" y="48" width="5" height="100" />
          <rect x="456" y="58" width="9" height="22" />
          <rect x="476" y="58" width="9" height="22" />
          <rect x="456" y="90" width="9" height="22" />
          <rect x="476" y="90" width="9" height="22" />
          {/* tall tower */}
          <polygon points="760,150 776,20 784,20 800,150 792,150 780,50 768,150" />
          <rect x="768" y="70" width="24" height="3" />
          <rect x="770" y="100" width="20" height="3" />
          <rect x="772" y="126" width="16" height="3" />
          <rect x="778" y="8" width="4" height="14" />
          {/* small mast */}
          <rect x="1010" y="78" width="4" height="70" />
          <rect x="1000" y="84" width="8" height="16" />
          <rect x="1016" y="84" width="8" height="16" />
          {/* roofs */}
          <rect x="300" y="128" width="46" height="24" />
          <polygon points="296,128 323,112 350,128" />
          <rect x="610" y="132" width="60" height="20" />
          <rect x="880" y="126" width="40" height="26" />
          <polygon points="876,126 900,110 924,126" />
        </g>
        <circle className="skyline__beacon" cx="200" cy="26" r="3" />
        <circle className="skyline__beacon" cx="780" cy="8" r="3" />
        <circle className="skyline__beacon skyline__beacon--b" cx="470" cy="48" r="3" />
      </svg>
      <div className="fog fog--a" />
      <div className="fog fog--b" />
    </div>
  );
}

function Stat() {
  const s = land.stats;
  return (
    <figure className="stat">
      <div className="stat__rows">
        <div className="stat__row">
          <p className="stat__label">
            <span className="stat__num">{s.ownPercent}%</span> {s.ownLabel}
          </p>
          <div className="stat__track" aria-hidden="true">
            <div className="stat__fill stat__fill--own" style={{ width: `${s.ownPercent}%` }} />
          </div>
        </div>
        <div className="stat__row">
          <p className="stat__label">
            <span className="stat__num">{s.usePercent}%</span> {s.useLabel}
          </p>
          <div className="stat__track" aria-hidden="true">
            <div className="stat__fill stat__fill--use" style={{ width: `${s.usePercent}%` }} />
          </div>
        </div>
      </div>
      <figcaption className="stat__caption">
        <span className="stat__text">{s.text}</span>{' '}
        <span className="stat__source">
          {s.sourceLabel}: {s.source}
        </span>
      </figcaption>
    </figure>
  );
}

/** The whole first screen: hero, stage on a graveyard ground, why, footer. */
export function Landing() {
  const reduced = useReducedMotion();

  const tryIt = (): void => {
    const phone = document.getElementById('phone');
    const stage = document.getElementById('phone-stage');
    stage?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    phone?.focus({ preventScroll: true });
  };

  return (
    <div className="landing">
      <header className="hero">
        <Atmosphere />
        <div className="hero__content">
          <p className="hero__label">{copy.demoLabel}</p>
          <h1 className="hero__h1">
            <span className="hero__title">{land.title}</span>
            <span className="hero__pitch">{land.pitch}</span>
          </h1>
          <p className="hero__sub">{land.subPitch}</p>
          <button type="button" className="hero__cta" onClick={tryIt}>
            {land.tryIt}
          </button>
        </div>
      </header>

      <main className="landing__main">
        <section className="ground" aria-labelledby="graveyard-title">
          <div className="ground__head">
            <h2 id="graveyard-title" className="section-title">
              {land.graveyardTitle}
            </h2>
            <p className="ground__intro">{land.graveyardIntro}</p>
          </div>
          <div className="ground__grid">
            <Graveyard side="left" />
            <div className="ground__stage">
              <Stage />
            </div>
            <Graveyard side="right" />
          </div>
          <div className="ground__fog" aria-hidden="true" />
        </section>

        <section className="why" aria-labelledby="why-title">
          <h2 id="why-title" className="section-title">
            {land.whyTitle}
          </h2>
          <Stat />
          <ul className="cards">
            {land.cards.map((card) => (
              <li key={card.id} className="card">
                <h3 className="card__title">{card.title}</h3>
                <p className="card__text">{card.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="foot">
        <nav aria-label={land.footer.repoLabel}>
          <ul className="foot__links">
            <li>
              <a href={land.footer.repoUrl}>{land.footer.repoLabel}</a>
            </li>
            <li>
              <a href={land.footer.quickStartUrl}>{land.footer.quickStartLabel}</a>
            </li>
          </ul>
        </nav>
        <p className="foot__note">{land.footer.licenseNote}</p>
        <p className="foot__label">{copy.demoLabel}</p>
      </footer>
    </div>
  );
}
