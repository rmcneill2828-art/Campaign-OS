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

  // Applies one action against `state`, returning the next state, the action's
  // resulting description (or null if nothing worth describing happened -- e.g. an
  // unresolved token name), and whether that description is already sitting in
  // state.log (attack() logs its own message internally; appending it again there
  // would double it up, but callers that want the full text regardless -- like the
  // session transcript -- still need it back).
  function applyAction(state, action) {
    switch (action.type) {
      case "spawn_monster": {
        // spawnMonster itself isn't part of CampaignOS's public API (see encounter.js) --
        // parseCommand's natural-language spawn phrasing is the supported entry point,
        // and it already produces the right stat block, naming, and log message.
        const result = window.CampaignOS.parseCommand(state, `spawn ${action.count} ${action.monster}`);
        return { state: result.state, message: result.message, alreadyLogged: false };
      }
      case "attack": {
        const attacker = findTokenByName(state, action.attacker);
        const target = findTokenByName(state, action.target);
        if (!attacker || !target) {
          return {
            state,
            message: `(DM assistant) could not resolve "${action.attacker}" attacking "${action.target}".`,
            alreadyLogged: false
          };
        }
        const result = window.CampaignOS.attack(state, attacker.id, target.id);
        return { state: result.state, message: result.message, alreadyLogged: true };
      }
      case "apply_damage": {
        const target = findTokenByName(state, action.target);
        if (!target) return { state, message: `(DM assistant) could not find "${action.target}" to damage.`, alreadyLogged: false };
        return {
          state: window.CampaignOS.applyDamage(state, target.id, action.amount),
          message: `${target.name} takes ${action.amount} damage.`,
          alreadyLogged: false
        };
      }
      case "apply_healing": {
        const target = findTokenByName(state, action.target);
        if (!target) return { state, message: `(DM assistant) could not find "${action.target}" to heal.`, alreadyLogged: false };
        return {
          state: window.CampaignOS.applyHealing(state, target.id, action.amount),
          message: `${target.name} heals ${action.amount} HP.`,
          alreadyLogged: false
        };
      }
      case "toggle_condition": {
        const target = findTokenByName(state, action.target);
        if (!target) return { state, message: `(DM assistant) could not find "${action.target}".`, alreadyLogged: false };
        const hadCondition = target.conditions.includes(action.condition);
        return {
          state: window.CampaignOS.toggleCondition(state, target.id, action.condition),
          message: `${target.name} is ${hadCondition ? "no longer" : "now"} ${action.condition}.`,
          alreadyLogged: false
        };
      }
      case "move_token": {
        const target = findTokenByName(state, action.target);
        if (!target) return { state, message: `(DM assistant) could not find "${action.target}" to move.`, alreadyLogged: false };
        const grid = window.CampaignOS.currentGrid(state);
        const x = Math.min(Math.max(Math.round(Number(action.x)), 1), grid.columns);
        const y = Math.min(Math.max(Math.round(Number(action.y)), 1), grid.rows);
        const nextState = window.CampaignOS.setTokenPosition(state, target.id, x, y);
        const moved = window.CampaignOS.tokensOnCurrentMap(nextState).find((token) => token.id === target.id);
        const didMove = Boolean(moved && moved.x === x && moved.y === y);
        return {
          state: nextState,
          message: didMove
            ? `${target.name} moves to (${x}, ${y}).`
            : `${target.name} could not move to (${x}, ${y}) -- tile occupied.`,
          alreadyLogged: false
        };
      }
      default:
        return { state, message: null, alreadyLogged: false };
    }
  }

  // Applies a whole actions array in order -- sequential application (re-resolving
  // token names against the *current* state after each step) matters because a
  // spawn_monster action is routinely followed by attack actions targeting the
  // monsters it just created (e.g. "Goblin 1" doesn't exist until spawn runs).
  // Returns every action's description in `messages`, in order, regardless of
  // whether it's also in state.log -- callers building a longer-lived record (the
  // session transcript) need the full list, not just what fits in the 12-entry cap.
  function applyActions(state, actions) {
    let nextState = state;
    const messages = [];
    (actions || []).forEach((action) => {
      const result = applyAction(nextState, action);
      if (result.message) {
        messages.push(result.message);
        nextState = result.alreadyLogged ? result.state : appendLog(result.state, result.message);
      } else {
        nextState = result.state;
      }
    });
    return { state: nextState, messages };
  }

  window.CampaignOSDMBridge = {
    applyActions,
    findTokenByName
  };
})();
