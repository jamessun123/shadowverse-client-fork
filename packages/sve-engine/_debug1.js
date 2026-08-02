const { createInitialGameState, createCardInstance } = require("./dist/state/factory.js");
const { applyAction } = require("./dist/actions/applyAction.js");

function setup() {
  let state = createInitialGameState(0);
  state.phase = "main";
  state.pendingChoices = null;
  state.players[0].pp = 10;
  state.players[0].maxPp = 10;
  state.players[1].pp = 10;
  state.players[1].maxPp = 10;
  return state;
}

let state = setup();
const homare = createCardInstance("Homare", 0, 0);
homare.onFieldSinceTurnStart = true;
state.players[0].zones.field.push(homare);
const yuiEvo = createCardInstance("Yui Evolved", 0, 0);
yuiEvo.onFieldSinceTurnStart = true;
state.players[0].zones.field.push(yuiEvo);
const enemy = createCardInstance("Kokkoro", 1, 1);
state.players[1].zones.field.push(enemy);

let res = applyAction(state, 0, { type: "ACTIVATE", fieldInstanceId: homare.instanceId });
console.log("ok:", res.ok, "error:", res.error);
console.log("pendingChoices:", JSON.stringify(res.state.pendingChoices, null, 2));
console.log("pendingTriggers:", JSON.stringify(res.state.pendingTriggers, null, 2));
console.log("leaderDef:", res.state.players[0].leaderDef);
console.log("field engaged:", res.state.players[0].zones.field.map((c) => [c.name, c.engaged]));
