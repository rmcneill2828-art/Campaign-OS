(function () {
  // Translates the structured actions the dm-bridge watcher's Claude call returns
  // (see dm-bridge/watch.js) into real CampaignOS engine calls. Kept separate from
  // encounter.js/campaign.js since this is glue for one specific input source
  // (the bridge), not core encounter or campaign-import logic.

  function findTokenByName(state, name) {
    const normalized = String(name || "").trim().toLowerCase();
    return window.CampaignOS.tokensOnCurrentMap(state).find((token) => token.name.toLowerCase() === normalized);
  }

  function appendLog(state, message) {
    if (!message) return state;
    return { ...state, log: [message, ...(state.log || [])].slice(0, 12) };
  }

  // Applies one action against `state`, returning the next state and a log line
  // (or null if nothing worth logging happened -- e.g. an unresolved token name).
  function applyAction(state, action) {
    switch (action.type) {
      case "spawn_monster": {
        // spawnMonster itself isn't part of CampaignOS's public API (see encounter.js) --
        // parseCommand's natural-language spawn phrasing is the supported entry point,
        // and it already produces the right stat block, naming, and log message.
        const result = window.CampaignOS.parseCommand(state, `spawn ${action.count} ${action.monster}`);
        return { state: result.state, message: result.message };
      }
      case "attack": {
        const attacker = findTokenByName(state, action.attacker);
        const target = findTokenByName(state, action.target);
        if (!attacker || !target) {
          return { state, message: `(DM assistant) could not resolve "${action.attacker}" attacking "${action.target}".` };
        }
        // attack() already appends its own message via addLogEntry -- returning it here
        // too would double-log every attack.
        const result = window.CampaignOS.attack(state, attacker.id, target.id);
        return { state: result.state, message: null };
      }
      case "apply_damage": {
        const target = findTokenByName(state, action.target);
        if (!target) return { state, message: `(DM assistant) could not find "${action.target}" to damage.` };
        return {
          state: window.CampaignOS.applyDamage(state, target.id, action.amount),
          message: `${target.name} takes ${action.amount} damage.`
        };
      }
      case "apply_healing": {
        const target = findTokenByName(state, action.target);
        if (!target) return { state, message: `(DM assistant) could not find "${action.target}" to heal.` };
        return {
          state: window.CampaignOS.applyHealing(state, target.id, action.amount),
          message: `${target.name} heals ${action.amount} HP.`
        };
      }
      case "toggle_condition": {
        const target = findTokenByName(state, action.target);
        if (!target) return { state, message: `(DM assistant) could not find "${action.target}".` };
        const hadCondition = target.conditions.includes(action.condition);
        return {
          state: window.CampaignOS.toggleCondition(state, target.id, action.condition),
          message: `${target.name} is ${hadCondition ? "no longer" : "now"} ${action.condition}.`
        };
      }
      default:
        return { state, message: null };
    }
  }

  // Applies a whole actions array in order -- sequential application (re-resolving
  // token names against the *current* state after each step) matters because a
  // spawn_monster action is routinely followed by attack actions targeting the
  // monsters it just created (e.g. "Goblin 1" doesn't exist until spawn runs).
  function applyActions(state, actions) {
    let nextState = state;
    (actions || []).forEach((action) => {
      const result = applyAction(nextState, action);
      nextState = result.message ? appendLog(result.state, result.message) : result.state;
    });
    return nextState;
  }

  window.CampaignOSDMBridge = {
    applyActions,
    findTokenByName
  };
})();
