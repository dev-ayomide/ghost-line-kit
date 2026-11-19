import { handsetConfig } from '../config/handset-config';
import { TracePanel, buildTraceGroups } from '../trace/TracePanel';
import { useAutoplay } from '../state/useAutoplay';
import { useHandset } from '../state/useHandset';
import { useReducedMotion } from '../state/useReducedMotion';
import { AutoplayControls } from './AutoplayControls';
import { PhoneContainer } from './PhoneContainer';
import { SplitView } from './SplitView';
const { copy } = handsetConfig;
/** Self-contained demo stage: phone, Autoplay, trace panel and split layout. */
export function Stage() {
  const handset = useHandset();
  const { state } = handset;
  const reducedMotion = useReducedMotion();
  const autoplay = useAutoplay({
    act: handset.act,
    getState: handset.getState,
    fixtures: handset.fixtures,
    reducedMotion,
  });
  const scripted = state.mode === 'scripted';
  // A scripted Blackout Line reply must never look like a live alert (R12.3).
  const replayFrame = scripted && state.activeApp === 'blackout-line';
  const phone = (
    <div
      className={`replay${replayFrame ? ' replay--on' : ''}`}
      {...(replayFrame ? { role: 'group', 'aria-label': copy.stage.replayFrameLabel } : {})}
    >
      {replayFrame ? <p className="replay__banner">{copy.stage.replayBanner}</p> : null}
      <PhoneContainer handset={handset} />
    </div>
  );
  return (
    <section id="phone-stage" className="stage" aria-label={copy.stage.label}>
      <SplitView
        split={state.splitView}
        onToggle={() => void handset.act({ type: 'toggleSplit' })}
        controls={
          <AutoplayControls
            mode={state.mode}
            autoplay={autoplay}
            fixtures={handset.fixtures}
            activeApp={state.activeApp}
            onSwitchToScripted={() => handset.switchMode('scripted')}
          />
        }
        phone={phone}
        trace={<TracePanel groups={buildTraceGroups(state)} reducedMotion={reducedMotion} />}
      />
    </section>
  );
}
