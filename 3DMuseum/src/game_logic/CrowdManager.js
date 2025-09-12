import { Crowd } from 'recast-navigation';

let crowd = null;
const agents = new Map();

export function initCrowd(navMesh, maxAgents = 16, maxAgentRadius = 1.0) {
  if (!navMesh) {
    console.error("initCrowd: navMesh is required");
    return null;
  }
  try {
    crowd = new Crowd(navMesh, { maxAgents, maxAgentRadius });
    console.log("✅ Crowd initialized with", { maxAgents, maxAgentRadius });
    return crowd;
  } catch (e) {
    console.error("❌ initCrowd failed:", e);
    return null;
  }
}

export function addAgent(position, agentParams = {}, userData = {}) {
  if (!crowd) {
    console.error("addAgent: crowd not initialized");
    return null;
  }

  const pos = { x: position.x, y: position.y, z: position.z };

  const params = {
    radius: agentParams.radius ?? 0.5,
    height: agentParams.height ?? 2.0,
    maxAcceleration: agentParams.maxAcceleration ?? 8.0,
    maxSpeed: agentParams.maxSpeed ?? 3.5,
    collisionQueryRange: agentParams.collisionQueryRange ?? 10.0,
    pathOptimizationRange: agentParams.pathOptimizationRange ?? 30.0,
    separationWeight: agentParams.separationWeight ?? 2.0,
  };

  const agent = crowd.addAgent(pos, params);

  if (!agent) {
    console.error("❌ addAgent failed at pos", pos, "params:", params);
    return null;
  }

  agents.set(agent, { agent, userData });
  console.log("✅ Agent added:", agent, "at", pos);
  return agent;
}

// CrowdManager.js — replace / update setAgentTarget
// CrowdManager.js
export function setAgentTarget(agentId, targetPosition, navQuery, options = {}) {
  if (!crowd || !navQuery || !agentId || !targetPosition) return;
  const { entry = null, requestedGait = null, pathLength = null } = options;

  // snap to navmesh
  const closest = navQuery.findClosestPoint(targetPosition);
  if (!closest?.point) {
    console.warn('setAgentTarget: clicked point not on navmesh', targetPosition);
    return;
  }

  try {
    // resolve agent handle
    let agentHandle = null;
    if (typeof agentId === 'number') agentHandle = crowd.getAgent(agentId);
    else agentHandle = agentId; // assume agent object

    if (!agentHandle) {
      const stored = Array.from(agents.values()).find(a => a.agent === agentId || a.model === agentId);
      if (stored) agentHandle = stored.agent;
    }
    if (!agentHandle) {
      console.warn('setAgentTarget: agent handle not found for', agentId);
      return;
    }

    // request move
    if (typeof agentHandle.requestMoveTarget === 'function') {
      agentHandle.requestMoveTarget(closest.point);
    } else if (typeof agentId === 'number') {
      const a = crowd.getAgent(agentId);
      if (a && typeof a.requestMoveTarget === 'function') a.requestMoveTarget(closest.point);
    }

    // record gait state
    if (entry) {
      entry.state = entry.state || {};
      if (requestedGait) {
        entry.state.requestedGait = requestedGait;
      } else if (pathLength != null) {
        entry.state.requestedGait = pathLength >= 4.0 ? 'run' : 'walk';
      }
    }

    console.log('🎯 Agent target set to', closest.point);
  } catch (e) {
    console.warn('setAgentTarget failed:', e);
  }
}



// CrowdManager.js - replace existing updateCrowd
export function updateCrowd(dt, timeSinceLastFrame = undefined, maxSubSteps = undefined) {
  if (!crowd) return;
  try {
    if (timeSinceLastFrame !== undefined && maxSubSteps !== undefined) {
      // fixed time stepping with interpolation if crowd supports it
      if (typeof crowd.update === 'function') {
        crowd.update(dt, timeSinceLastFrame, maxSubSteps);
      }
    } else if (typeof crowd.update === 'function') {
      crowd.update(dt);
    }
  } catch (e) {
    console.warn('updateCrowd error:', e);
  }
}

export function getAgents() {
  return agents;
}

export function removeAgent(agent) {
  if (!crowd) return;
  crowd.removeAgent(agent);
  agents.delete(agent);
}
