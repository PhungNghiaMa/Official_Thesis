// src/game_logic/AnimController.js
import { AnimationMixer } from 'three';

export function createAnimController(model, characterGLTF) {
  const mixer = new AnimationMixer(model);
  const actions = {};
  // map likely clip names to action references
  if (characterGLTF?.animations?.length) {
    characterGLTF.animations.forEach((clip) => {
      // clone clip so we can safely filter tracks
      const safeClip = clip.clone();
      safeClip.tracks = safeClip.tracks.filter(track => !track.name.endsWith('.position'));
      const action = mixer.clipAction(safeClip);
      actions[safeClip.name] = action;
    });
    // start idle if available
    if (actions.Idle) {
      actions.Idle.play();
    }
  }

  // small helper to crossfade/play actions (compatible with existing ThirdPersonPlayer.playAction)
  let currentAction = actions.Idle ?? null;
  function playAction(action, opts = {}) {
    if (!action) return;
    const fadeDuration = (opts.fadeDuration !== undefined) ? opts.fadeDuration : 0.6; // default 0.5 for smoothness
    action.enabled = true;
    action.paused = false;
    if (currentAction === action) return;
    if (currentAction) {
      // crossFadeTo supports small fade durations for quick switches
      currentAction.crossFadeTo(action, fadeDuration, false);
    }
    action.reset().play();
    currentAction = action;
  }

  // extracted decision logic (similar to ThirdPersonPlayer.updateAnimationState)
  function updateAnimationState(speed, opts = {}) {
    const left = !!opts.left;
    const right = !!opts.right;
    const run = !!opts.run;
    const hasIdle = !!actions.Idle;
    const hasWalk = !!actions.WalkForward;
    const hasRun = !!actions.Running;
    const hasLeft = !!actions.LeftTurn;
    const hasRight = !!actions.RightTurn;

    if (speed < 0.05) {
      if (hasIdle) { playAction(actions.Idle); if (currentAction) currentAction.timeScale = 1.0; }
      return;
    }

    if (run && hasRun) {
      actions.Running.timeScale = 1.5;
      playAction(actions.Running);
      if (currentAction) currentAction.timeScale = 1.5;
    } else if (hasWalk) {
      playAction(actions.WalkForward);
      if (currentAction) currentAction.timeScale = 1.0;
    }

    if (speed < 0.2) {
      if (left && hasLeft) { playAction(actions.LeftTurn); if (currentAction) currentAction.timeScale = 1.3; }
      else if (right && hasRight) { playAction(actions.RightTurn); if (currentAction) currentAction.timeScale = 1.0; }
    }
  }

  return {
    mixer,
    // expose actions under conventional names used elsewhere
    idleAction: actions.Idle,
    walkAction: actions.WalkForward,
    runningAction: actions.Running,
    leftTurnAction: actions.LeftTurn,
    rightTurnAction: actions.RightTurn,
    playAction,
    setNPCAnimationState: updateAnimationState,
  };
}
